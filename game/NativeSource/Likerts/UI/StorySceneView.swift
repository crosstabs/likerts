import SwiftUI
import UIKit

enum StoryPose: String { case hold, peek, celebrate }
struct StoryResolution: Equatable {
    let guess: Int
    let answer: Int
    var exact: Bool { guess == answer }
}

@MainActor enum StoryArt {
    private static let cache = NSCache<NSString, UIImage>()
    private static let sources: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 6
        cache.totalCostLimit = 36 * 1_024 * 1_024
        return cache
    }()
    static func integratedAlignment(for reference: String) -> Alignment {
        // Measured optical framing retains defining details in short viewports.
        switch reference {
        case "scene/highWallClockV22", "scene/birdPerchV30", "scene/birdTiltV30", "scene/mediaHangingHeadphones": return .top
        case "scene/bootsWornV46", "scene/slipperSearchV18", "scene/homeCushionV15", "scene/slipperComparisonV17", "scene/muddyDogAlbumV30", "scene/robotCarriesCaseV46", "scene/benchMapV28", "scene/craftCameraPuzzle", "scene/hobbyClayFingerprints", "scene/hobbyYarnBookmark", "scene/mediaBookStackFlags", "scene/mediaTeaRing", "scene/mediaLargePrintNovel", "scene/booksGlassesCaseCanonical": return .bottom
        default: return .center
        }
    }
    static func image(ref: String) -> UIImage? {
        cache.totalCostLimit = 16 * 1_024 * 1_024
        if let cached = cache.object(forKey: ref as NSString) { return cached }
        let parts = ref.split(separator: "/").map(String.init)
        let sourceName: String
        let rect: CGRect?
        if parts.count == 3, parts[0] == "cast", let value = Int(parts[2]), (1...5).contains(value) {
            switch parts[1] {
            case "celebrate": sourceName = "StoryCastCelebrate"; rect = StoryCastBounds.celebrate[value]
            case "peek": sourceName = "StoryCastPeek"; rect = StoryCastBounds.peek[value]
            default: sourceName = "StoryCastHold"; rect = StoryCastBounds.hold[value]
            }
        } else if parts.count == 2, parts[0] == "scene" {
            if let bounds = StoryPropBounds.homeScenesV15[parts[1]] { sourceName = "StoryHomeScenesV15"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV17[parts[1]] { sourceName = "StoryIntegratedScenesV17"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV18[parts[1]] { sourceName = "StoryIntegratedScenesV18"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV19[parts[1]] { sourceName = "StoryIntegratedScenesV19"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV21[parts[1]] { sourceName = "StoryIntegratedScenesV21"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV25[parts[1]] { sourceName = "StoryIntegratedScenesV25"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV26[parts[1]] { sourceName = "StoryIntegratedScenesV26"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV27[parts[1]] { sourceName = "StoryIntegratedScenesV27"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV28[parts[1]] { sourceName = "StoryIntegratedScenesV28"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV29[parts[1]] { sourceName = "StoryIntegratedScenesV29"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV30[parts[1]] { sourceName = "StoryIntegratedScenesV30"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV31[parts[1]] { sourceName = "StoryIntegratedScenesV31"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV32[parts[1]] { sourceName = "StoryIntegratedScenesV32"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV33[parts[1]] { sourceName = "StoryIntegratedScenesV33"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV36[parts[1]] { sourceName = "StoryIntegratedScenesV36"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV35[parts[1]] { sourceName = "StoryIntegratedScenesV35"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV37[parts[1]] { sourceName = "StoryIntegratedScenesV37"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV43[parts[1]] { sourceName = "StoryIntegratedScenesV43"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV47[parts[1]] { sourceName = "StoryIntegratedScenesV47"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV38[parts[1]] { sourceName = "StoryIntegratedScenesV38"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV39[parts[1]] { sourceName = "StoryIntegratedScenesV39"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV40[parts[1]] { sourceName = "StoryIntegratedScenesV40"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV41[parts[1]] { sourceName = "StoryIntegratedScenesV41"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV44[parts[1]] { sourceName = "StoryIntegratedScenesV44"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV45[parts[1]] { sourceName = "StoryIntegratedScenesV45"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV48[parts[1]] { sourceName = "StoryIntegratedScenesV48"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV46[parts[1]] { sourceName = "StoryIntegratedScenesV46"; rect = bounds }
            else if let bounds = StoryPropBounds.integratedScenesV42[parts[1]] {
                sourceName = parts[1] == "bookFlagV42" ? "StoryBookFlagV42" : "StoryBookScrapV42"; rect = bounds
            }
            else { sourceName = "StoryIntegratedScenesV22"; rect = StoryPropBounds.integratedScenesV22[parts[1]] }
        } else if parts.count == 2, parts[0] == "story" {
            if parts[1] == "pianobench" { sourceName = "StoryPianoBench"; rect = StoryPropBounds.pianoBench }
            else if let bounds = StoryPropBounds.layerV1[parts[1]] { sourceName = "StoryLayerAtlasV1"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV2[parts[1]] { sourceName = "StoryLayerAtlasV2"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV3[parts[1]] { sourceName = "StoryLayerAtlasV3"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV4[parts[1]] { sourceName = "StoryLayerAtlasV4"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV5[parts[1]] { sourceName = "StoryLayerAtlasV5"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV6[parts[1]] { sourceName = "StoryLayerAtlasV6"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV7[parts[1]] { sourceName = "StoryLayerAtlasV7"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV8[parts[1]] { sourceName = "StoryLayerAtlasV8"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV9[parts[1]] { sourceName = "StoryLayerAtlasV9"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV11[parts[1]] { sourceName = "StoryLayerAtlasV11"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV12[parts[1]] { sourceName = "StoryLayerAtlasV12"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV14[parts[1]] { sourceName = "StoryLayerAtlasV14"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV13[parts[1]] { sourceName = "StoryLayerAtlasV13"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV16[parts[1]] { sourceName = "StoryLayerAtlasV16"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV20[parts[1]] { sourceName = "StoryLayerAtlasV20"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV23[parts[1]] { sourceName = "StoryLayerAtlasV23"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV24[parts[1]] { sourceName = "StoryLayerAtlasV24"; rect = bounds }
            else if let bounds = StoryPropBounds.layerV34[parts[1]] { sourceName = "StoryLayerAtlasV34"; rect = bounds }
            else if let bounds = StoryPropBounds.props[parts[1]] { sourceName = "StoryProps"; rect = bounds }
            else { sourceName = "StoryStates"; rect = StoryPropBounds.states[parts[1]] }
        } else if parts.count == 2, parts[0] == "set" {
            sourceName = "StorySets"; rect = StoryPropBounds.sets[parts[1]]
        } else if parts.count == 2, let topic = TopicID(rawValue: parts[0]) {
            return TopicArt.prop(parts[1], topic: topic)
        } else { return nil }
        guard let rect else { return nil }
        let source: UIImage
        if let cached = sources.object(forKey: sourceName as NSString) { source = cached }
        else {
            guard let loaded = UIImage(named: sourceName) else { return nil }
            let cost = loaded.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
            sources.setObject(loaded, forKey: sourceName as NSString, cost: cost)
            source = loaded
        }
        let cropRect = rect.integral
        guard let crop = source.cgImage?.cropping(to: cropRect) else { return nil }
        let presented: CGImage
        if parts.first == "cast", let seed = StoryCastBounds.componentSeeds[parts.dropFirst().joined(separator: "/")] {
            guard let isolated = StoryAtlasExtraction.connectedSprite(crop, seed: CGPoint(x: seed.x - cropRect.minX, y: seed.y - cropRect.minY)) else { return nil }
            presented = isolated
        } else { presented = crop }
        let result = UIImage(cgImage: presented)
        cache.setObject(result, forKey: ref as NSString, cost: presented.bytesPerRow * presented.height)
        return result
    }
}

struct StoryRaster: View {
    let ref: String
    var body: some View {
        if let image = StoryArt.image(ref: ref) { Image(uiImage: image).resizable().scaledToFit().accessibilityHidden(true) }
    }
}

struct StoryCharacter: View {
    let value: Int
    var pose: StoryPose = .hold
    var body: some View {
        if let image = StoryArt.image(ref: "cast/\(pose.rawValue)/\(min(5, max(1, value)))") {
            Image(uiImage: image).resizable().scaledToFit().accessibilityHidden(true)
        } else { TotemRaster(name: "Totem\(min(5, max(1, value)))") }
    }
}

/// Authored scene stories share stable controls, but change framing, contact,
/// foreground depth and the state resolved after a guess is locked.
struct StorySceneView: View {
    let round: TopicRound
    var resolution: StoryResolution? = nil
    var choice: Int? = nil
    var compact = false
    var canonicalCast = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var testEffects
    @State private var settled = false
    @State private var choiceLean = 0.0
    private var spec: VignetteSpec? { VignetteBank.spec(id: round.id) }
    private var performance: ScenePerformance? {
        MotionProductionLibrary.performance(id: round.id) ?? MotionPilotLibrary.performance(id: round.id)
    }
    private var done: Bool { resolution != nil && (settled || reduceMotion || testEffects || Feel.testing) }
    private var character: Int { canonicalCast ? 3 : round.id % 5 + 1 }
    private var pose: StoryPose { done && resolution?.exact == true ? .celebrate : spec?.family == .peek ? .peek : .hold }
    private var height: CGFloat {
        guard !compact else { return 144 }
        switch spec?.family {
        case .tabletop: return 182
        case .wearUse: return 210
        case .journey: return 180
        default: return 200
        }
    }
    var body: some View {
        if round.id == 1001 {
            TradeSnackPerformanceView(resolution: resolution, choice: choice, compact: compact, canonicalCast: canonicalCast)
        } else if let performance, performance.renderer == .layeredGraph, let registry = MotionProductionLibrary.registry {
            MotionPerformanceSceneView(performance: performance, registry: registry, resolution: resolution, choice: choice, compact: compact)
        } else if let spec {
            GeometryReader { geometry in
                let size = geometry.size
                ZStack {
                    backdrop(spec: spec, size: size)
                    switch spec.family {
                    case .tabletop: tabletop(spec, size)
                    case .wearUse: wearUse(spec, size)
                    case .peek: peek(spec, size)
                    case .share: share(spec, size)
                    case .journey: journey(spec, size)
                    case .build: build(spec, size)
                    }
                }.frame(width: size.width, height: size.height)
                    .clipShape(RoundedRectangle(cornerRadius: spec.family == .wearUse ? 40 : 26))
            }.frame(height: height)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(resolution == nil ? spec.summary : spec.revealSummary)
                .accessibilityIdentifier("story.scene.\(round.id)")
                .onAppear {
                    guard resolution != nil else { return }
                    withAnimation(reduceMotion || testEffects || Feel.testing ? nil : .spring(response: 0.45, dampingFraction: 0.80)) { settled = true }
                }
                .task(id: choice) {
                    guard choice != nil, resolution == nil, !reduceMotion, !testEffects, !Feel.testing else { return }
                    // The same attention cue for every value. No private answer
                    // or preference direction enters the scene before Lock.
                    withAnimation(.easeOut(duration: 0.10)) { choiceLean = 1 }
                    do { try await Task.sleep(for: .milliseconds(110)) } catch { return }
                    withAnimation(.easeInOut(duration: 0.16)) { choiceLean = 0 }
                }
        } else { TopicSceneView(round: round, compact: compact, canonicalCast: canonicalCast) }
    }
    private func backdrop(spec: VignetteSpec, size: CGSize) -> some View {
        let outdoor: Set<VignetteAction> = [.snackDetour, .parkWalk, .dogWalk, .dogChoice, .picnicBand, .mapDetour, .rabbitCourse]
        let topic: TopicID = outdoor.contains(spec.action) ? .outdoors : spec.action == .streetDrummer ? .travel : round.topic
        return ZStack {
            TotemTone.paper
            if let image = TopicArt.backdrop(topic) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: size.width, height: size.height).clipped()
                    .opacity(spec.family == .tabletop ? 0.48 : 0.92)
            }
        }
    }
    private func node(_ ref: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ size: CGSize, angle: Double = 0, mirror: Bool = false) -> some View {
        StoryRaster(ref: ref).frame(width: size.width * w, height: size.height * h)
            .scaleEffect(x: mirror ? -1 : 1, y: 1)
            .rotationEffect(.degrees(angle)).position(x: size.width * x, y: size.height * y)
    }
    private func cast(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ size: CGSize, value: Int? = nil, pose: StoryPose? = nil, angle: Double = 0, preservePose: Bool = false) -> some View {
        StoryCharacter(value: value ?? character, pose: done && resolution?.exact == true && !preservePose ? .celebrate : pose ?? self.pose)
            .frame(width: size.width * w, height: size.height * h).rotationEffect(.degrees(angle + choiceLean * 1.6))
            .position(x: size.width * x, y: size.height * y)
    }
    private func fittedCast(value: Int, pose: StoryPose, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, size: CGSize) -> CGRect {
        let imageSize = StoryArt.image(ref: "cast/\(pose.rawValue)/\(value)")?.size ?? CGSize(width: 1, height: 1)
        let scale = min(size.width * w / imageSize.width, size.height * h / imageSize.height)
        let width = imageSize.width * scale, height = imageSize.height * scale
        return CGRect(x: size.width * x - width / 2, y: size.height * y - height / 2, width: width, height: height)
    }
    private func contact(_ point: CGPoint, rect: CGRect, angle: Double = 0) -> CGPoint {
        let dx = (point.x - 0.5) * rect.width, dy = (point.y - 0.5) * rect.height
        let radians = angle * .pi / 180
        return CGPoint(x: rect.midX + dx * cos(radians) - dy * sin(radians), y: rect.midY + dx * sin(radians) + dy * cos(radians))
    }
    private func worn(_ ref: String, kind: String, size: CGSize) -> some View {
        let rect = fittedCast(value: character, pose: pose, x: 0.50, y: 0.54, w: 0.48, h: 0.93, size: size)
        let anchors = StoryCastAnchors.anchor(pose: pose, value: character)
        let face = CGRect(x: rect.minX + anchors.face.minX * rect.width, y: rect.minY + anchors.face.minY * rect.height, width: anchors.face.width * rect.width, height: anchors.face.height * rect.height)
        let mouth = contact(anchors.mouthCenter, rect: rect)
        let crown = contact(anchors.headTop, rect: rect)
        let width: CGFloat, height: CGFloat, center: CGPoint
        switch kind {
        case "headphones":
            width = min(size.width * 0.61, face.width * 1.75); height = min(size.height * 0.74, face.height * 2.3)
            center = CGPoint(x: face.midX, y: face.midY - face.height * 0.43)
        case "hat":
            width = min(size.width * 0.83, rect.width * 1.65); height = size.height * 0.38
            center = CGPoint(x: crown.x, y: max(height / 2, crown.y - height * 0.12))
        default:
            width = min(size.width * 0.43, face.width * 1.40); height = size.height * 0.31
            center = CGPoint(x: mouth.x, y: min(size.height - height / 2 - 2, mouth.y + face.height * 0.80))
        }
        return Group {
            if kind == "headphones" { StoryHeadphones(face: face, headTop: crown) }
            else { StoryRaster(ref: ref).frame(width: width, height: height).position(center) }
        }
    }
    @ViewBuilder private func tabletop(_ spec: VignetteSpec, _ s: CGSize) -> some View {
        node("set/table", 0.53, 0.78, 1.06, 0.76, s)
        cast(0.13, 0.30, 0.22, 0.50, s, pose: .peek, angle: 8)
        switch spec.action {
        case .countDivide:
            ForEach(0..<5) { index in
                let x = index < 3 ? 0.31 + CGFloat(index) * 0.10 : (done ? 0.69 : 0.60) + CGFloat(index - 3) * 0.11
                node("snacks/pretzel", x, index.isMultiple(of: 2) ? 0.49 : 0.64, 0.13, 0.28, s, angle: Double(index * 13 - 15))
            }
            cast(0.91, 0.34, 0.17, 0.42, s, value: 5, angle: -12)
        case .arrangeSnacks:
            node("snacks/bento", 0.56, 0.53, 0.65, 0.67, s)
            node("snacks/cookie", done ? 0.39 : 0.32, 0.48, 0.15, 0.28, s)
            node("snacks/pretzel", 0.55, done ? 0.44 : 0.33, 0.16, 0.30, s)
            node("snacks/fruit", done ? 0.70 : 0.82, 0.55, 0.18, 0.34, s)
        case .petPhoto:
            node("pets/dog", 0.68, 0.50, 0.30, 0.65, s, angle: done ? 14 : -12)
            node("travel/camera", 0.35, 0.68, 0.30, 0.43, s, angle: -8)
            node("pets/cat", 0.88, 0.67, 0.19, 0.44, s, angle: 12)
        case .fishSketch:
            node("hobbies/sketchbook", 0.49, 0.60, 0.38, 0.65, s, angle: -15)
            node("pets/fish", 0.77, 0.40, 0.29, 0.48, s)
            node("hobbies/paintbrush", 0.53, 0.45, 0.25, 0.58, s, angle: done ? -35 : -15)
        case .sortRecords:
            node("music/piano", 0.83, 0.31, 0.31, 0.51, s)
            ForEach(0..<3) { index in node("music/record", 0.33 + CGFloat(index) * 0.19, 0.61 - CGFloat(done ? index : 0) * 0.05, 0.22, 0.43, s, angle: done ? 0 : Double(index * 12 - 12)) }
        case .tuneGuitar:
            node("music/guitar", 0.49, 0.51, 0.43, 0.89, s, angle: -42)
            node("music/drum", 0.85, 0.60, 0.27, 0.45, s)
            cast(0.31, 0.53, 0.27, 0.60, s, pose: .hold)
        case .unfoldMap, .planMap:
            node("travel/map", 0.55, 0.55, done ? 0.76 : 0.66, 0.76, s, angle: -8)
            if spec.action == .planMap {
                cast(0.88, 0.31, 0.22, 0.49, s, value: 4, pose: .hold, angle: -9)
                node("outdoors/compass", 0.76, 0.64, 0.16, 0.31, s)
            } else { node("story/ticket", 0.85, 0.73, 0.20, 0.24, s, angle: 14) }
        default: EmptyView()
        }
    }
    @ViewBuilder private func wearUse(_ spec: VignetteSpec, _ s: CGSize) -> some View {
        if spec.action != .raincoatWalk { cast(0.50, 0.54, 0.48, 0.93, s) }
        switch spec.action {
        case .wearNecklace:
            worn("story/necklace", kind: "necklace", size: s)
            node("story/loosepopcorn", 0.81, 0.79, 0.19, 0.27, s)
        case .napkinPlan:
            node("story/napkin", 0.72, 0.82, 0.24, 0.32, s, angle: 10)
            node("snacks/icecream", 0.77, 0.73, 0.18, 0.37, s, angle: done ? -8 : 9)
        case .raincoatWalk:
            let rect = fittedCast(value: character, pose: pose, x: 0.50, y: 0.54, w: 0.48, h: 0.93, size: s)
            let normalizedFace = StoryCastAnchors.anchor(pose: pose, value: character).face
            let face = CGRect(x: rect.minX + normalizedFace.minX * rect.width, y: rect.minY + normalizedFace.minY * rect.height, width: normalizedFace.width * rect.width, height: normalizedFace.height * rect.height)
            StoryRaincoat(value: character, pose: pose, characterRect: rect, face: face, canvas: s)
            node("pets/dog", 0.85, 0.80, 0.24, 0.39, s, angle: -5)
        case .carryToy:
            node("story/ball", 0.73, 0.82, 0.34, 0.36, s)
            node("pets/dog", 0.17, 0.80, 0.26, 0.39, s)
        case .wearHeadphones, .quietGuitar:
            worn("story/headphones", kind: "headphones", size: s)
            if spec.action == .quietGuitar { node("music/guitar", 0.52, 0.79, 0.43, 0.54, s, angle: -25) }
            else { node("music/record", 0.56, 0.77, 0.28, 0.42, s, angle: done ? -12 : 8); node("story/recordplayer", 0.17, 0.82, 0.27, 0.33, s) }
        case .giantHat:
            worn("travel/sunhat", kind: "hat", size: s)
            node("story/passport", 0.59, 0.79, 0.18, 0.30, s)
        case .rollingCase:
            node("travel/suitcase", 0.77, 0.73, 0.30, 0.61, s, angle: done ? 8 : -7)
            node("story/ticket", 0.53, 0.76, 0.17, 0.25, s)
        default: EmptyView()
        }
    }
    @ViewBuilder private func peek(_ spec: VignetteSpec, _ s: CGSize) -> some View {
        switch spec.action {
        case .catBox, .catOnBook:
            node("set/box", 0.58, 0.68, 0.72, 0.72, s)
            if spec.action == .catOnBook { node("books/novel", 0.59, 0.64, 0.45, 0.35, s, angle: -9) }
            node("pets/cat", 0.58, 0.49, 0.37, 0.73, s, angle: done ? 0 : -5)
            foreground("set/box", x: 0.58, y: 0.68, w: 0.72, h: 0.72, cut: 0.65, s)
            cast(0.15, 0.69, 0.23, 0.63, s, pose: .peek, angle: 9)
        case .suitcaseSpace, .surprisePack:
            node("story/opensuitcase", 0.53, 0.64, 0.79, 0.84, s)
            cast(0.85, 0.35, 0.27, 0.64, s, pose: .peek, angle: -12)
            if spec.action == .surprisePack { node("travel/postcard", 0.51, done ? 0.38 : 0.61, 0.25, 0.41, s, angle: done ? -12 : 0) }
            else { node("story/passport", 0.31, 0.70, 0.22, 0.31, s, angle: -12) }
            foreground("story/opensuitcase", x: 0.53, y: 0.64, w: 0.79, h: 0.84, cut: 0.82, s)
        case .hiddenHeadphones, .guitarHide:
            cast(done ? 0.66 : 0.60, 0.49, 0.26, 0.77, s, pose: .peek, angle: 15)
            if spec.action == .hiddenHeadphones {
                node("story/headphones", done ? 0.80 : 0.64, 0.60, 0.30, 0.52, s, angle: 15)
                node("music/piano", 0.45, 0.70, 0.72, 0.75, s)
            } else {
                node("set/curtain", 0.50, 0.50, 1.10, 1.15, s)
                node("music/guitar", 0.60, 0.57, 0.34, 0.94, s, angle: -4)
                cast(0.17, 0.57, 0.23, 0.63, s, value: 4, pose: .hold)
                node("music/microphone", 0.28, 0.72, 0.14, 0.36, s)
            }
        case .saveCookie:
            node("snacks/cookie", done ? 0.69 : 0.60, 0.43, 0.28, 0.45, s)
            node("snacks/popcorn", 0.52, 0.69, 0.47, 0.69, s)
            cast(0.20, 0.53, 0.29, 0.75, s, pose: .peek, angle: 12)
        case .fruitBottom:
            node("story/bowl", 0.56, 0.69, 0.65, 0.61, s)
            node("snacks/fruit", 0.56, done ? 0.44 : 0.54, 0.37, 0.49, s)
            foreground("story/bowl", x: 0.56, y: 0.69, w: 0.65, h: 0.61, cut: 0.60, s)
            cast(0.15, 0.52, 0.24, 0.69, s, pose: .peek)
        default: EmptyView()
        }
    }
    private func foreground(_ ref: String, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, cut: CGFloat, _ size: CGSize) -> some View {
        StoryRaster(ref: ref).frame(width: size.width * w, height: size.height * h)
            .mask(alignment: .bottom) { Rectangle().frame(height: size.height * h * (1 - cut)) }
            .position(x: size.width * x, y: size.height * y)
    }
    @ViewBuilder private func share(_ spec: VignetteSpec, _ s: CGSize) -> some View {
        if spec.action == .catLap || spec.action == .catConversation {
            node("story/cushion", 0.48, 0.85, 0.63, 0.32, s)
            cast(0.42, 0.48, 0.38, 0.88, s)
            node("pets/cat", spec.action == .catLap ? 0.45 : 0.73, 0.76, 0.38, 0.48, s, angle: done ? -7 : 0)
            if spec.action == .catConversation { node("social/conversation", 0.73, 0.24, 0.24, 0.32, s) }
        } else if spec.action == .trainFriends {
            node("story/trainseat", 0.25, 0.71, 0.46, 0.85, s)
            node("story/trainseat", 0.75, 0.71, 0.46, 0.85, s, mirror: true)
            cast(0.27, 0.48, 0.30, 0.76, s)
            cast(0.73, 0.48, 0.30, 0.76, s, value: canonicalCast ? 5 : (character % 5) + 1)
            node("story/ticket", 0.51, 0.78, 0.20, 0.28, s)
        } else {
            node("set/bench", 0.50, 0.85, 0.96, 0.42, s)
            cast(0.25, 0.49, 0.31, 0.86, s, pose: spec.action == .offerBite ? .hold : nil, angle: done ? 5 : 0)
            cast(0.76, 0.49, 0.31, 0.86, s, value: canonicalCast ? 5 : (character % 5) + 1, pose: spec.action == .offerBite ? .hold : nil, angle: done ? -5 : 0, preservePose: spec.action == .offerBite)
            let giving: String = spec.action == .offerBite ? "snacks/icecream" : spec.action == .shareMic ? "music/microphone" : spec.action == .lendHeadphones ? "story/headphones" : spec.action == .lendHat ? "travel/sunhat" : spec.primaryAsset
            if spec.action == .offerBite {
                offeredCone(s)
            } else { node(giving, done ? 0.59 : 0.44, 0.65, 0.30, 0.49, s, angle: done ? 9 : -8) }
            if spec.action == .tradeSnack { node("snacks/popcorn", done ? 0.41 : 0.64, 0.73, 0.26, 0.43, s) }
        }
    }
    private func offeredCone(_ s: CGSize) -> some View {
        let value = done ? (canonicalCast ? 5 : (character % 5) + 1) : character
        let heldPose: StoryPose = .hold
        let angle: Double = done ? -5 : 0
        let rect = fittedCast(value: value, pose: heldPose, x: done ? 0.76 : 0.25, y: 0.49, w: 0.31, h: 0.86, size: s)
        let anchors = StoryCastAnchors.anchor(pose: heldPose, value: value)
        let grip = contact(done ? anchors.leftHand : anchors.rightHand, rect: rect, angle: angle)
        let mouth = contact(anchors.mouthCenter, rect: rect, angle: angle)
        let height = min(s.height * 0.40, max(s.height * 0.20, abs(grip.y - mouth.y) * 2))
        let image = StoryArt.image(ref: "snacks/icecream")
        let width = height * ((image?.size.width ?? 1) / (image?.size.height ?? 1))
        return StoryRaster(ref: "snacks/icecream").frame(width: width, height: height)
            .rotationEffect(.degrees(done ? 5 : -7)).position(x: grip.x, y: grip.y - height * 0.27)
    }
    @ViewBuilder private func journey(_ spec: VignetteSpec, _ s: CGSize) -> some View {
        if spec.action == .trainWindow {
            trainWindow(s)
        } else {
            if spec.action == .dogChoice {
                node("set/path", 0.59, 0.80, 0.86, 0.51, s, angle: 12)
                node("set/path", 0.67, 0.57, 0.71, 0.45, s, angle: -36, mirror: true)
            } else { node("set/path", 0.50, 0.80, 1.14, 0.65, s) }
            cast(done ? 0.55 : 0.37, 0.55, 0.30, 0.85, s, angle: done ? 5 : -5)
            switch spec.action {
            case .snackDetour:
                node("snacks/fruit", done ? 0.57 : 0.39, 0.77, 0.20, 0.31, s)
                node("snacks/pretzel", 0.80, 0.63, 0.23, 0.39, s)
            case .parkWalk: node("snacks/bento", done ? 0.62 : 0.43, 0.76, 0.27, 0.39, s)
            case .dogWalk, .dogChoice:
                node("pets/dog", done ? 0.77 : 0.60, 0.70, 0.30, 0.51, s, angle: -3)
                if spec.action == .dogChoice { node("outdoors/tree", 0.88, 0.32, 0.24, 0.58, s); node("tinyadventures/pebble", 0.17, 0.85, 0.12, 0.20, s) }
            case .picnicBand:
                node("music/guitar", done ? 0.61 : 0.43, 0.66, 0.27, 0.68, s, angle: -22)
                node("music/drum", 0.80, 0.73, 0.24, 0.39, s)
                cast(0.82, 0.38, 0.22, 0.59, s, value: 5)
            case .streetDrummer:
                node("story/headphones", done ? 0.55 : 0.37, 0.28, 0.27, 0.43, s)
                node("music/drum", 0.79, 0.74, 0.27, 0.41, s)
                cast(0.83, 0.41, 0.23, 0.59, s, value: 4)
            case .mapDetour: node("travel/map", done ? 0.74 : 0.56, 0.84, 0.28, 0.25, s, angle: -9)
            default: EmptyView()
            }
        }
    }
    @ViewBuilder private func build(_ spec: VignetteSpec, _ s: CGSize) -> some View {
        cast(0.14, 0.56, 0.24, 0.67, s, pose: done && resolution?.exact == true ? .celebrate : .hold, angle: 7)
        switch spec.action {
        case .bridgeBowl:
            node("story/icecreambowl", 0.59, 0.70, 0.66, 0.60, s)
            node("snacks/cookie", 0.43, 0.59, 0.24, 0.32, s, angle: -16)
            node("snacks/cookie", 0.75, 0.59, 0.24, 0.32, s, angle: 16)
            node("snacks/cookie", done ? 0.59 : 0.89, done ? 0.45 : 0.18, 0.27, 0.38, s)
            foreground("story/icecreambowl", x: 0.59, y: 0.70, w: 0.66, h: 0.60, cut: 0.55, s)
        case .fruitFace:
            node("story/bowl", 0.59, 0.72, 0.66, 0.52, s)
            node(done ? "story/fruitface" : "snacks/fruit", 0.59, 0.48, 0.61, 0.70, s)
        case .rabbitPalace:
            node("making/cardboard", 0.50, 0.69, 0.35, 0.52, s)
            node("making/cardboard", 0.78, 0.56, 0.28, 0.72, s)
            node("making/cardboard", done ? 0.51 : 0.90, done ? 0.33 : 0.19, 0.30, 0.37, s)
            node("pets/rabbit", 0.57, 0.83, 0.25, 0.39, s)
        case .rabbitCourse:
            node("set/path", 0.58, 0.78, 0.83, 0.54, s)
            ForEach(0..<3) { index in node("making/cardboard", 0.37 + CGFloat(index) * 0.23, 0.70, 0.16, 0.27, s) }
            node("pets/rabbit", done ? 0.87 : 0.32, 0.48, 0.24, 0.51, s, angle: done ? 7 : -9)
        case .pretendStage:
            node("story/pianobench", 0.60, 0.75, 0.66, 0.45, s)
            cast(0.59, 0.35, 0.25, 0.55, s)
            node("music/microphone", 0.80, 0.45, 0.16, 0.48, s)
        case .radioStack:
            node("set/recordrack", 0.61, 0.74, 0.65, 0.55, s)
            node("story/recordsleeves", 0.49, 0.49, 0.40, 0.68, s, angle: done ? 0 : -8)
            node("music/microphone", 0.81, 0.51, 0.20, 0.65, s)
        case .postcardWall:
            ForEach(0..<4) { index in
                node("travel/postcard", 0.47 + CGFloat(index % 2) * 0.28, 0.25 + CGFloat(index / 2) * 0.37, 0.25, 0.33, s, angle: done ? 0 : Double(index * 8 - 12))
            }
            node("travel/camera", 0.84, 0.84, 0.22, 0.27, s)
        case .packingPuzzle:
            node("story/opensuitcase", 0.62, 0.70, 0.72, 0.70, s)
            node("story/passport", done ? 0.47 : 0.35, 0.61, 0.22, 0.33, s, angle: done ? 0 : -9)
            node("travel/sunhat", 0.71, done ? 0.51 : 0.22, 0.39, 0.38, s, angle: 12)
            node("travel/camera", 0.78, 0.70, 0.25, 0.32, s)
            foreground("story/opensuitcase", x: 0.62, y: 0.70, w: 0.72, h: 0.70, cut: 0.83, s)
        default: EmptyView()
        }
    }
    @ViewBuilder private func trainWindow(_ s: CGSize) -> some View {
        let frameImage = StoryArt.image(ref: "set/window")
        let width = s.width * 0.70
        let frameHeight = width * ((frameImage?.size.height ?? 1) / (frameImage?.size.width ?? 1))
        let cx = s.width * 0.66, cy = s.height * 0.44
        TotemTone.paper.opacity(0.75)
        if let scenery = TopicArt.backdrop(.outdoors) {
            Image(uiImage: scenery).resizable().scaledToFill()
                .frame(width: width * 0.72, height: frameHeight * 0.66).clipped()
                .clipShape(RoundedRectangle(cornerRadius: 19))
                .position(x: cx, y: cy)
        }
        StoryRaster(ref: "set/window").frame(width: width, height: frameHeight).position(x: cx, y: cy)
        node("story/trainseat", 0.22, 0.71, 0.47, 0.86, s)
        cast(0.32, 0.54, 0.29, 0.72, s, pose: .peek, angle: done ? -7 : -3)
        node("story/ticket", 0.75, 0.84, 0.22, 0.24, s, angle: -12)
    }
}
