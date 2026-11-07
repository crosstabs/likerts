import Foundation
import Observation

/// A screen deadline stays responsive even if a model does not promptly
/// acknowledge cancellation. Late completions never replace another request.
@MainActor @Observable final class FreshPackRequest {
    private(set) var result: PackResult?
    private(set) var working = false
    private var generation: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var requestID: UUID?
    private let make: (PackTheme, PackAvailability) async throws -> PackResult
    private let timeoutNanoseconds: UInt64

    init(timeoutNanoseconds: UInt64 = 45_000_000_000,
         make: @escaping (PackTheme, PackAvailability) async throws -> PackResult = { theme, availability in
             try await PromptPackService(generator: OnDevicePackGenerator()).make(theme: theme, availability: availability)
         }) {
        self.make = make; self.timeoutNanoseconds = timeoutNanoseconds
    }
    func generate(theme: PackTheme, availability: PackAvailability) {
        cancel(); result = nil
        let token = UUID(), make = self.make, timeout = timeoutNanoseconds
        requestID = token; working = true
        generation = Task { @MainActor [weak self] in
            do {
                let made = try await make(theme, availability)
                guard !Task.isCancelled, self?.requestID == token else { return }
                self?.finish(made)
            } catch {
                guard !Task.isCancelled, self?.requestID == token else { return }
                self?.finish(PackResult(pack: AuthoredPacks.pack(for: theme), fallbackReason: .generationFailed))
            }
        }
        deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: timeout) } catch { return }
            guard !Task.isCancelled, self?.requestID == token else { return }
            self?.finish(PackResult(pack: AuthoredPacks.pack(for: theme), fallbackReason: .timedOut))
        }
    }
    func useHandpicked(theme: PackTheme) {
        cancel(); result = PackResult(pack: AuthoredPacks.pack(for: theme), fallbackReason: nil)
    }
    func discard() { cancel(); result = nil }
    func cancel() {
        requestID = nil; working = false
        generation?.cancel(); generation = nil
        deadline?.cancel(); deadline = nil
    }
    private func finish(_ value: PackResult) {
        cancel(); result = value
    }
}
