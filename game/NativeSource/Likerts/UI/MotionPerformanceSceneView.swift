import SwiftUI
import UIKit

/// Renders validated local data. A choice cue never receives an answer; only
/// the already-locked reveal receives GameSession's comparison.
struct MotionPerformanceSceneView: View {
    let performance: ScenePerformance
    let registry: MotionAssetRegistry
    var resolution: StoryResolution?
    var choice: Int?
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var reducedEffects
    @Environment(\.scenePhase) private var appPhase
    @State private var ambientProgress = 0.0
    @State private var choiceProgress = 0.0
    @State private var revealProgress = 0.0
    @State private var reactionProgress = 0.0
    @State private var reactionActive = false
    @State private var playedReveal = false
    @State private var playedAmbient = false
    @State private var choiceTask: Task<Void, Never>?
    private var still: Bool { reduceMotion || reducedEffects || Feel.testing }
    private var phaseIdentity: String { "\(performance.roundID)-\(resolution != nil)-\(appPhase == .active)" }
    private var reactionCue: MotionCue? {
        // Reduced motion is a synchronous final tableau. It must not wait
        // for an appearance task to expose the scored character reaction.
        guard let resolution, reactionActive || still else { return nil }
        let distance = abs(resolution.guess - resolution.answer)
        return distance == 0 ? performance.reveal.exact : distance == 1 ? performance.reveal.near : performance.reveal.apart
    }
    var body: some View {
        MotionCanvas(performance: performance, registry: registry,
                     ambient: ambientProgress, choice: choiceProgress,
                     reveal: still && resolution != nil ? 1 : revealProgress,
                     reaction: reactionProgress, reactionCue: reactionCue,
                     resolved: resolution != nil, reduced: still && resolution != nil)
            .frame(height: compact ? 144 : 200)
            .clipShape(RoundedRectangle(cornerRadius: 26))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(performance.semanticJustification)
            .accessibilityIdentifier("story.scene.\(performance.roundID)")
            .task(id: phaseIdentity) { await playPhase() }
            .onChange(of: choice) { _, value in
                guard value != nil, resolution == nil, !still, let cue = performance.choice else { return }
                choiceTask?.cancel()
                choiceTask = Task { @MainActor in
                    choiceProgress = 0
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    withAnimation(.linear(duration: cue.timing.total)) { choiceProgress = 1 }
                }
            }
            .onDisappear {
                choiceTask?.cancel()
                #if DEBUG
                if resolution != nil { MotionProbe.shared.cancel(roundID: performance.roundID) }
                #endif
            }
    }
    @MainActor private func playPhase() async {
        guard appPhase == .active else { choiceTask?.cancel(); return }
        if resolution != nil {
            choiceTask?.cancel(); choiceProgress = 0
            if still || playedReveal {
                revealProgress = 1; reactionProgress = 1; reactionActive = true
                return
            }
            playedReveal = true
            #if DEBUG
            MotionProbe.shared.captureReveal(roundID: performance.roundID, seedLabel: "performance-v\(performance.revision)")
            #endif
            let cue = performance.reveal.action
            do {
                // Leave a brief beat for the stable scene/reveal layout to arrive.
                try await Task.sleep(for: .milliseconds(180))
                withAnimation(.linear(duration: cue.timing.total)) { revealProgress = 1 }
                try await Task.sleep(for: .seconds(cue.timing.total))
                guard !Task.isCancelled else { return }
                reactionActive = true
                if let reactionCue {
                    withAnimation(.linear(duration: reactionCue.timing.total)) { reactionProgress = 1 }
                }
            } catch { return }
        } else if !still, !playedAmbient, let cue = performance.ambient {
            playedAmbient = true
            do {
                try await Task.sleep(for: .milliseconds(700))
                withAnimation(.linear(duration: cue.timing.total)) { ambientProgress = 1 }
            } catch { return }
        }
    }
}

private struct MotionCanvas: View, Animatable {
    let performance: ScenePerformance
    let registry: MotionAssetRegistry
    var ambient: Double
    var choice: Double
    var reveal: Double
    var reaction: Double
    var reactionCue: MotionCue?
    let resolved: Bool
    let reduced: Bool
    var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>> {
        get { .init(.init(ambient, choice), .init(reveal, reaction)) }
        set { ambient = newValue.first.first; choice = newValue.first.second; reveal = newValue.second.first; reaction = newValue.second.second }
    }
    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                TotemTone.paper
                ForEach(performance.graph.nodes.sorted(by: { $0.layer.rawValue < $1.layer.rawValue }), id: \.id) { node in
                    if let image = MotionNativeArt.image(node.asset.rawValue) {
                        let state = state(node)
                        let asset = state.assetState ?? node.asset
                        let actualImage = MotionNativeArt.image(asset.rawValue) ?? image
                        let pose = placed(node, state: state.transform, asset: asset, size: size)
                        raster(node, image: actualImage, pose: pose, size: size)
                    }
                }
            }.frame(width: size.width, height: size.height)
        }
    }
    private func state(_ node: MotionNode) -> MotionSample {
        if reduced, let final = performance.reduced.states.first(where: { $0.nodeID == node.id }) {
            // A scored expression is a discrete final pose, not required
            // movement. Preserve it when travel/overshoot is reduced.
            if let track = reactionCue?.tracks.first(where: { $0.nodeID == node.id }),
               let result = track.sample(at: 1) { return result }
            return .init(transform: final.transform, assetState: final.assetState)
        }
        var sample = MotionSample(transform: node.initial, assetState: nil)
        func apply(_ cue: MotionCue?, _ progress: Double) {
            if let track = cue?.tracks.first(where: { $0.nodeID == node.id }), let result = track.sample(at: progress) { sample = result }
        }
        if resolved { apply(performance.reveal.action, reveal); apply(reactionCue, reaction) }
        else { apply(performance.ambient, ambient); apply(performance.choice, choice) }
        return sample
    }
    private struct Placement {
        var center: CGPoint
        var size: CGSize
        var rotation: Double
        var scale: Double
        var opacity: Double
    }
    private func placed(_ node: MotionNode, state: MotionTransform, asset: MotionAssetID, size: CGSize, depth: Int = 0) -> Placement {
        let imageSize = MotionNativeArt.image(asset.rawValue)?.size ?? CGSize(width: 1, height: 1)
        let box = CGSize(width: size.width * node.frame.width, height: size.height * node.frame.height)
        let fit = min(box.width / imageSize.width, box.height / imageSize.height)
        let drawn = CGSize(width: imageSize.width * fit, height: imageSize.height * fit)
        var result = Placement(center: CGPoint(x: size.width * state.x, y: size.height * state.y), size: drawn,
                               rotation: state.rotation, scale: state.scale, opacity: state.opacity)
        if let attachment = node.attachment, depth < 24,
           let parent = performance.graph.nodes.first(where: { $0.id == attachment.parent.nodeID }) {
            let parentState = self.state(parent)
            let parentAsset = parentState.assetState ?? parent.asset
            let parentPlacement = placed(parent, state: parentState.transform, asset: parentAsset, size: size, depth: depth + 1)
            let parentAnchor = registry.assets[parentAsset]?.anchors[attachment.parent.anchor] ?? .init(x: 0.5, y: 0.5)
            let childAnchor = registry.assets[asset]?.anchors[attachment.childAnchor] ?? .init(x: 0.5, y: 0.5)
            let contact = point(parentAnchor, in: parentPlacement)
            if attachment.inheritsRotation { result.rotation += parentPlacement.rotation }
            let childOffset = rotated(CGPoint(x: (childAnchor.x - 0.5) * drawn.width * result.scale,
                                             y: (childAnchor.y - 0.5) * drawn.height * result.scale), degrees: result.rotation)
            result.center = CGPoint(x: contact.x - childOffset.x + attachment.offset.x * size.width,
                                    y: contact.y - childOffset.y + attachment.offset.y * size.height)
        }
        return result
    }
    private func point(_ point: MotionPoint, in p: Placement) -> CGPoint {
        let offset = rotated(CGPoint(x: (point.x - 0.5) * p.size.width * p.scale,
                                     y: (point.y - 0.5) * p.size.height * p.scale), degrees: p.rotation)
        return CGPoint(x: p.center.x + offset.x, y: p.center.y + offset.y)
    }
    private func rotated(_ point: CGPoint, degrees: Double) -> CGPoint {
        let a = degrees * .pi / 180
        return CGPoint(x: point.x * cos(a) - point.y * sin(a), y: point.x * sin(a) + point.y * cos(a))
    }
    @ViewBuilder private func raster(_ node: MotionNode, image: UIImage, pose: Placement, size: CGSize) -> some View {
        if node.asset.rawValue.hasPrefix("scene/") {
            // Integrated original still artwork retains its physical contacts;
            // it is not a movable prop or a claim of articulated animation.
            Image(uiImage: image).resizable().scaledToFill()
                .frame(width: size.width * node.frame.width, height: size.height * node.frame.height,
                       alignment: StoryArt.integratedAlignment(for: node.asset.rawValue)).clipped()
                .opacity(pose.opacity).position(pose.center)
        } else if node.asset.rawValue.hasPrefix("bg/") {
            // The viewport stays fixed; scenery moves *inside* it, never taking
            // the train window or whole screen along for the ride.
            Image(uiImage: image).resizable().scaledToFill()
                .frame(width: size.width * node.frame.width * 1.25, height: size.height * node.frame.height * 1.10)
                .offset(x: (pose.center.x - node.initial.x * size.width), y: (pose.center.y - node.initial.y * size.height))
                .frame(width: size.width * node.frame.width, height: size.height * node.frame.height).clipped()
                .clipShape(RoundedRectangle(cornerRadius: node.role == .backdrop && node.frame.width < 0.9 ? 18 : 0))
                .opacity(pose.opacity).position(x: node.initial.x * size.width, y: node.initial.y * size.height)
        } else {
            let mask = performance.graph.masks.first(where: { $0.foregroundNodeID == node.id })
            let raster = ZStack(alignment: .topLeading) {
                Image(uiImage: image).resizable().scaledToFit()
                ForEach(Array((node.labels ?? []).enumerated()), id: \.offset) { _, label in
                    Text(label.text).font(.system(size: pose.size.width * label.fontScale, weight: .heavy, design: .rounded))
                        .foregroundStyle(node.asset.rawValue == "movies/clapperboard" ? Color.white : Color(red: 0.16, green: 0.13, blue: 0.24))
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .frame(width: pose.size.width * label.frame.width, height: pose.size.height * label.frame.height)
                        .position(x: pose.size.width * label.frame.x, y: pose.size.height * label.frame.y)
                }
            }.frame(width: pose.size.width, height: pose.size.height)
            Group {
                if let mask {
                    raster.mask {
                        Rectangle().frame(width: pose.size.width * mask.region.width, height: pose.size.height * mask.region.height)
                            .position(x: pose.size.width * mask.region.x, y: pose.size.height * mask.region.y)
                    }
                } else {
                    raster
                }
            }.scaleEffect(pose.scale).rotationEffect(.degrees(pose.rotation))
                .opacity(pose.opacity).position(pose.center)
        }
    }
}

@MainActor enum MotionNativeArt {
    static func image(_ reference: String) -> UIImage? {
        if reference.hasPrefix("bg/"), let topic = TopicID(rawValue: String(reference.dropFirst(3))) { return TopicArt.backdrop(topic) }
        return StoryArt.image(ref: reference)
    }
}
