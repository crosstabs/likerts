#if DEBUG
import Foundation
import UIKit
import QuartzCore
import Darwin
import os

/// Opt-in, bounded diagnostics for the actual app process. CADisplayLink
/// callbacks measure main-run-loop cadence, not GPU presentation or video FPS.
/// Call cancel(roundID:) when the profiled reveal leaves the screen.
@MainActor
final class MotionProbe: NSObject {
    static let shared = MotionProbe()
    static let revealSeconds = 1.2
    static let settleGapSeconds = 1.0
    static let restSeconds = 1.2

    private let log = OSLog(subsystem: "studio.likerts.motion", category: "MotionProbe")
    private var capture: Capture?
    private var window: Window?
    private var displayLink: CADisplayLink?
    private var scheduled: Task<Void, Never>?
    private var seen = Set<String>()
    private let maximumCaptures = 8

    var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-motion-profile") }

    /// seedLabel identifies one reveal event, not a nickname or private answer.
    /// Repeated calls for the same ID/label are ignored within this process.
    @discardableResult
    func captureReveal(roundID: Int, seedLabel: String) -> UUID? {
        guard isEnabled else { return nil }
        let label = String(seedLabel.prefix(100))
        let key = "\(roundID)|\(label)"
        guard !seen.contains(key), seen.count < maximumCaptures else { return nil }
        if capture != nil { cancelActive(reason: "superseded-by-another-reveal") }
        seen.insert(key)
        let session = Capture(roundID: roundID, seedLabel: label)
        capture = session
        beginWindow(.reveal, for: session)
        return session.id
    }

    /// Integrate on the reveal container's disappearance, not on the earlier
    /// question view disappearing to make room for that same reveal.
    func cancel(roundID: Int) {
        guard capture?.roundID == roundID else { return }
        cancelActive(reason: "reveal-disappeared-before-profile-completed")
    }

    private func beginWindow(_ phase: Phase, for session: Capture) {
        guard capture?.id == session.id else { return }
        let duration = phase == .reveal ? Self.revealSeconds : Self.restSeconds
        let current = Window(phase: phase, requestedSeconds: duration, signpostID: OSSignpostID(log: log))
        window = current
        signpost(.begin, phase: phase, id: current.signpostID, roundID: session.roundID)
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        // Leave the normal frame-rate policy unchanged. The probe reports
        // each callback's offered target period instead of assuming60Hz.
        link.add(to: .main, forMode: .common)
        displayLink = link
        scheduled = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000)) }
            catch { return }
            guard !Task.isCancelled else { return }
            self?.finishWindow(captureID: session.id)
        }
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard let window else { return }
        window.callbackCount += 1
        guard window.samples.count < 1_024 else { window.truncatedSamples += 1; return }
        // Only bounded numeric samples are collected per callback. There is
        // no per-frame memory query, signpost, serialization or file write.
        window.samples.append(FrameSample(callbackUptime: CACurrentMediaTime(),
                                          displayTimestamp: link.timestamp,
                                          targetTimestamp: link.targetTimestamp))
    }

    private func finishWindow(captureID: UUID) {
        guard let session = capture, session.id == captureID, let current = window else { return }
        stopClock()
        let end = Snapshot.read()
        signpost(.end, phase: current.phase, id: current.signpostID, roundID: session.roundID)
        session.windows.append(WindowReport(window: current, end: end, cancelled: false))
        window = nil
        if current.phase == .reveal {
            scheduled = Task { @MainActor [weak self] in
                do { try await Task.sleep(nanoseconds: UInt64(Self.settleGapSeconds * 1_000_000_000)) }
                catch { return }
                guard !Task.isCancelled, let self, self.capture?.id == session.id else { return }
                self.beginWindow(.rest, for: session)
            }
        } else {
            persist(session, status: "complete", cancellationReason: nil)
            capture = nil
        }
    }

    private func cancelActive(reason: String) {
        guard let session = capture else { return }
        stopClock()
        if let current = window {
            let end = Snapshot.read()
            signpost(.end, phase: current.phase, id: current.signpostID, roundID: session.roundID)
            session.windows.append(WindowReport(window: current, end: end, cancelled: true))
        }
        window = nil
        persist(session, status: "cancelled", cancellationReason: reason)
        capture = nil
    }

    private func stopClock() {
        scheduled?.cancel()
        scheduled = nil
        displayLink?.invalidate()
        displayLink = nil
    }

    private func signpost(_ type: OSSignpostType, phase: Phase, id: OSSignpostID, roundID: Int) {
        if phase == .reveal {
            os_signpost(type, log: log, name: "LikertsRevealProfile", signpostID: id, "round=%{public}d", roundID)
        } else {
            os_signpost(type, log: log, name: "LikertsRestProfile", signpostID: id, "round=%{public}d", roundID)
        }
    }

    private func persist(_ session: Capture, status: String, cancellationReason: String?) {
        let report = Report(schemaVersion: 1, id: session.id, roundID: session.roundID,
                            seedLabel: session.seedLabel, startedAt: session.startedAt,
                            status: status, validForComparison: status == "complete" && session.windows.count == 2 && session.windows.allSatisfy(\.valid),
                            cancellationReason: cancellationReason,
                            processID: ProcessInfo.processInfo.processIdentifier,
                            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
                            appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
                            systemVersion: UIDevice.current.systemVersion,
                            simulatorModel: ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"],
                            maximumFramesPerSecond: UIScreen.main.maximumFramesPerSecond,
                            settleGapSeconds: Self.settleGapSeconds, windows: session.windows,
                            limits: [
                                "CADisplayLink measures main-run-loop callback cadence, not GPU presentation FPS or dropped rendered frames.",
                                "Delayed-callback slots are estimates from the offered period; adaptive refresh and scheduling can affect them.",
                                "Process CPU uses getrusage;100 percent represents one fully occupied CPU core and aggregate CPU can exceed100 percent.",
                                "Memory snapshots are process resident/physical-footprint measurements, not a GPU-memory total or a leak diagnosis.",
                                "Rest baseline retains the display-link probe; it is not an uninstrumented idle baseline.",
                                "Simulator, debugger, recorder, XCTest queries and cold image caches can perturb these short windows.",
                                "Caller must cancel when the reveal disappears; cancelled captures are invalid for comparison.",
                                "Probe collects no nickname, answer, question text or third-party data."
                            ])
        do {
            let folder = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true).appendingPathComponent("MotionProfiles", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent("motion-\(session.roundID)-\(session.id.uuidString).json")
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(report).write(to: destination, options: .atomic)
            os_log("Motion profile saved: %{public}@ status=%{public}@", log: log, type: .info,
                   destination.lastPathComponent, status)
        } catch {
            os_log("Motion profile write failed: %{public}@", log: log, type: .error, error.localizedDescription)
        }
    }

    private enum Phase: String, Codable { case reveal, rest }
    private final class Capture {
        let id = UUID()
        let roundID: Int
        let seedLabel: String
        let startedAt = Date()
        var windows: [WindowReport] = []
        init(roundID: Int, seedLabel: String) { self.roundID = roundID; self.seedLabel = seedLabel }
    }
    private final class Window {
        let phase: Phase
        let requestedSeconds: Double
        let signpostID: OSSignpostID
        let start: Snapshot
        var samples: [FrameSample]
        var callbackCount = 0
        var truncatedSamples = 0
        init(phase: Phase, requestedSeconds: Double, signpostID: OSSignpostID) {
            self.phase = phase; self.requestedSeconds = requestedSeconds; self.signpostID = signpostID
            var reserved: [FrameSample] = []; reserved.reserveCapacity(256)
            samples = reserved
            start = Snapshot.read()
        }
    }
    private struct FrameSample: Codable {
        let callbackUptime: Double
        let displayTimestamp: Double
        let targetTimestamp: Double
    }
    private struct CPUSnapshot: Codable {
        let userSeconds: Double
        let systemSeconds: Double
    }
    private struct MemorySnapshot: Codable {
        let residentBytes: UInt64?
        let residentPeakBytes: UInt64?
        let physicalFootprintBytes: UInt64?
        let machResult: Int32
    }
    private struct Snapshot: Codable {
        let uptime: Double
        let cpu: CPUSnapshot?
        let memory: MemorySnapshot
        static func read() -> Snapshot {
            var usage = rusage()
            let usageResult = getrusage(Int32(RUSAGE_SELF), &usage)
            let cpu = usageResult == 0 ? CPUSnapshot(
                userSeconds: Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1_000_000,
                systemSeconds: Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1_000_000) : nil
            var info = task_vm_info_data_t()
            var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
            let capacity = Int(count)
            let result = withUnsafeMutablePointer(to: &info) { pointer in
                pointer.withMemoryRebound(to: integer_t.self, capacity: capacity) {
                    task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
                }
            }
            let memory = MemorySnapshot(residentBytes: result == KERN_SUCCESS ? UInt64(info.resident_size) : nil,
                                        residentPeakBytes: result == KERN_SUCCESS ? UInt64(info.resident_size_peak) : nil,
                                        physicalFootprintBytes: result == KERN_SUCCESS ? UInt64(info.phys_footprint) : nil,
                                        machResult: result)
            return Snapshot(uptime: CACurrentMediaTime(), cpu: cpu, memory: memory)
        }
    }
    private struct Distribution: Codable {
        let mean: Double, median: Double, p95: Double, maximum: Double
        init?(_ values: [Double]) {
            guard !values.isEmpty else { return nil }
            let sorted = values.sorted()
            mean = values.reduce(0, +) / Double(values.count)
            median = sorted[(sorted.count - 1) / 2]
            p95 = sorted[min(sorted.count - 1, max(0, Int(ceil(Double(sorted.count) * 0.95)) - 1))]
            maximum = sorted.last!
        }
    }
    private struct WindowReport: Codable {
        let phase: Phase
        let requestedSeconds: Double
        let actualSeconds: Double
        let valid: Bool
        let cancelled: Bool
        let callbackCount: Int
        let truncatedSamples: Int
        let firstCallbackDelayMs: Double?
        let callbackCadenceHz: Double?
        let callbackIntervalMs: Distribution?
        let offeredPeriodMs: Distribution?
        let displayTimestampIntervalMs: Distribution?
        let gapsOverOneAndHalfOfferedPeriod: Int
        let estimatedDelayedCallbackSlots: Int
        let processCPUUserSeconds: Double?
        let processCPUSystemSeconds: Double?
        let processCPUPercentOfOneCore: Double?
        let start: Snapshot
        let end: Snapshot
        let frames: [FrameSample]

        init(window: Window, end: Snapshot, cancelled: Bool) {
            phase = window.phase; requestedSeconds = window.requestedSeconds
            actualSeconds = max(0, end.uptime - window.start.uptime)
            self.cancelled = cancelled
            start = window.start; self.end = end
            callbackCount = window.callbackCount; truncatedSamples = window.truncatedSamples
            frames = window.samples
            valid = !cancelled && actualSeconds >= requestedSeconds * 0.8 && frames.count >= 3 && truncatedSamples == 0
            firstCallbackDelayMs = frames.first.map { ($0.callbackUptime - window.start.uptime) * 1_000 }
            let callbackGaps = zip(frames.dropFirst(), frames).map { $0.callbackUptime - $1.callbackUptime }
            let displayGaps = zip(frames.dropFirst(), frames).map { $0.displayTimestamp - $1.displayTimestamp }
            let periods = frames.map { $0.targetTimestamp - $0.displayTimestamp }.filter { $0 > 0 }
            callbackIntervalMs = Distribution(callbackGaps.map { $0 * 1_000 })
            offeredPeriodMs = Distribution(periods.map { $0 * 1_000 })
            displayTimestampIntervalMs = Distribution(displayGaps.map { $0 * 1_000 })
            if let first = frames.first, let last = frames.last, last.callbackUptime > first.callbackUptime {
                callbackCadenceHz = Double(frames.count - 1) / (last.callbackUptime - first.callbackUptime)
            } else { callbackCadenceHz = nil }
            var late = 0, slots = 0
            for (gap, frame) in zip(callbackGaps, frames.dropFirst()) {
                let offered = frame.targetTimestamp - frame.displayTimestamp
                guard offered > 0 else { continue }
                if gap > offered * 1.5 { late += 1 }
                slots += max(0, Int((gap / offered).rounded()) - 1)
            }
            gapsOverOneAndHalfOfferedPeriod = late; estimatedDelayedCallbackSlots = slots
            if let beginCPU = start.cpu, let endCPU = end.cpu, actualSeconds > 0 {
                let user = max(0, endCPU.userSeconds - beginCPU.userSeconds)
                let system = max(0, endCPU.systemSeconds - beginCPU.systemSeconds)
                processCPUUserSeconds = user; processCPUSystemSeconds = system
                processCPUPercentOfOneCore = (user + system) / actualSeconds * 100
            } else { processCPUUserSeconds = nil; processCPUSystemSeconds = nil; processCPUPercentOfOneCore = nil }
        }
    }
    private struct Report: Codable {
        let schemaVersion: Int
        let id: UUID
        let roundID: Int
        let seedLabel: String
        let startedAt: Date
        let status: String
        let validForComparison: Bool
        let cancellationReason: String?
        let processID: Int32
        let appVersion: String?
        let appBuild: String?
        let systemVersion: String
        let simulatorModel: String?
        let maximumFramesPerSecond: Int
        let settleGapSeconds: Double
        let windows: [WindowReport]
        let limits: [String]
    }
}
#endif
