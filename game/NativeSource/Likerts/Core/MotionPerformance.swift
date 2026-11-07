import Foundation

// Portable, declarative data only. Native adapters render these bindings;
// descriptors never execute code or receive the host's hidden answers.
struct MotionAssetID: RawRepresentable, Hashable, Codable, Sendable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(_ rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws { var value = encoder.singleValueContainer(); try value.encode(rawValue) }
}

struct MotionPoint: Hashable, Codable, Sendable {
    var x: Double
    var y: Double
    static let zero = MotionPoint(x: 0, y: 0)
}

/// Centre and size in canvas-normalized coordinates. No screen points are stored.
struct MotionFrame: Hashable, Codable, Sendable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

struct MotionTransform: Hashable, Codable, Sendable {
    var x: Double
    var y: Double
    var rotation: Double
    var scale: Double
    var opacity: Double
    init(x: Double, y: Double, rotation: Double = 0, scale: Double = 1, opacity: Double = 1) {
        self.x = x; self.y = y; self.rotation = rotation; self.scale = scale; self.opacity = opacity
    }
    func interpolated(to other: Self, progress: Double) -> Self {
        let p = progress.isFinite ? min(1, max(0, progress)) : 0
        func mix(_ a: Double, _ b: Double) -> Double { a + (b - a) * p }
        return .init(x: mix(x, other.x), y: mix(y, other.y), rotation: mix(rotation, other.rotation),
                     scale: mix(scale, other.scale), opacity: mix(opacity, other.opacity))
    }
}

enum ScenePhase: String, Codable, Sendable { case question, choice, reveal }
enum MotionLayer: Int, Codable, Sendable { case background = 0, setBack = 10, actor = 20, prop = 30, foreground = 40 }
enum MotionRole: String, Codable, Sendable { case primaryActor, secondaryActor, primaryProp, secondaryProp, detail, set, backdrop, occluder }
enum MotionFraming: String, Codable, Sendable { case stage, closeUp, portrait, foreground, duet, wide, vertical, overhead, window, tabletop }
enum MotionCapability: String, CaseIterable, Codable, Sendable {
    case rigid, translate, tilt, spin, scale, opacity, grippable, supportSurface
    case attachable, tethered, levitates, foregroundCut, poseSet, ambientLayer
}

/// Vocabulary, not a claim that every recipe has shipped or passed playback QA.
enum MotionRecipe: String, CaseIterable, Codable, Sendable {
    case inspect, approach, present, pass, exchange, lift, carry, place, align, sort, count
    case stack, settle, balance, assemble, peek, uncover, compare, consider, travel, windowDrift
    case roll, turn, spin, hover, orbit, sway, tether, protect, separate, frame, wear, attach
    case pack, unpack, listen
    case acknowledge, reactionOnly, staticTableau
}

enum MotionCondition: String, Codable, Sendable { case always, exact, near, apart }
enum MotionSemanticReview: String, Codable, Sendable { case descriptorOnly, mapped, reviewed, artGap }
enum MotionPlaybackReview: String, Codable, Sendable { case notReviewed, normalReviewed, reducedReviewed, bothReviewed }
enum MotionCoverage: String, Codable, Sendable { case actionMotion, reactionOnly, authoredTableau, staticFallback }
struct MotionReview: Hashable, Codable, Sendable {
    let semantic: MotionSemanticReview
    let playback: MotionPlaybackReview
    let coverage: MotionCoverage
    init(semantic: MotionSemanticReview = .descriptorOnly, playback: MotionPlaybackReview = .notReviewed, coverage: MotionCoverage = .staticFallback) {
        self.semantic = semantic; self.playback = playback; self.coverage = coverage
    }
}

struct MotionAssetCapabilities: Hashable, Codable, Sendable {
    let asset: MotionAssetID
    let capabilities: Set<MotionCapability>
    let anchors: [String: MotionPoint]
    let faceExclusion: MotionFrame?
    /// Optional identity family for discrete poses. A named family may only
    /// transition to another asset in that same family.
    let poseFamily: String?
    init(asset: MotionAssetID, capabilities: Set<MotionCapability>, anchors: [String: MotionPoint] = [:], faceExclusion: MotionFrame? = nil, poseFamily: String? = nil) {
        self.asset = asset; self.capabilities = capabilities; self.anchors = anchors; self.faceExclusion = faceExclusion; self.poseFamily = poseFamily
    }
}

struct MotionAssetRegistry: Sendable {
    let assets: [MotionAssetID: MotionAssetCapabilities]
    init(_ values: [MotionAssetCapabilities]) throws {
        var mapped: [MotionAssetID: MotionAssetCapabilities] = [:]
        for value in values {
            guard mapped.updateValue(value, forKey: value.asset) == nil else { throw MotionValidationError.duplicateAsset(value.asset.rawValue) }
        }
        assets = mapped
    }
}

struct MotionAnchorRef: Hashable, Codable, Sendable {
    let nodeID: String
    let anchor: String
}
struct MotionAttachment: Hashable, Codable, Sendable {
    let parent: MotionAnchorRef
    let childAnchor: String
    let offset: MotionPoint
    let inheritsRotation: Bool
    init(parent: MotionAnchorRef, childAnchor: String, offset: MotionPoint = .zero, inheritsRotation: Bool = true) {
        self.parent = parent; self.childAnchor = childAnchor; self.offset = offset; self.inheritsRotation = inheritsRotation
    }
}
/// Short authored markings on a measured blank prop surface, never game scores
/// or a value derived from the player's hidden answers.
struct MotionPropLabel: Hashable, Codable, Sendable {
    let text: String
    let frame: MotionFrame
    let fontScale: Double
}
struct MotionNode: Hashable, Codable, Sendable {
    let id: String
    let asset: MotionAssetID
    let role: MotionRole
    let layer: MotionLayer
    let frame: MotionFrame
    let initial: MotionTransform
    let attachment: MotionAttachment?
    let allowedStates: [MotionAssetID]
    let labels: [MotionPropLabel]?
    init(id: String, asset: MotionAssetID, role: MotionRole, layer: MotionLayer, frame: MotionFrame,
         initial: MotionTransform? = nil, attachment: MotionAttachment? = nil, allowedStates: [MotionAssetID] = [], labels: [MotionPropLabel]? = nil) {
        self.id = id; self.asset = asset; self.role = role; self.layer = layer; self.frame = frame
        self.initial = initial ?? .init(x: frame.x, y: frame.y)
        self.attachment = attachment; self.allowedStates = allowedStates
        self.labels = labels
    }
}
struct MotionForegroundMask: Hashable, Codable, Sendable {
    let id: String
    let foregroundNodeID: String
    let subjectNodeID: String
    let region: MotionFrame
}
struct MotionSceneGraph: Hashable, Codable, Sendable {
    let id: String
    let nodes: [MotionNode]
    let masks: [MotionForegroundMask]
    init(id: String, nodes: [MotionNode], masks: [MotionForegroundMask] = []) { self.id = id; self.nodes = nodes; self.masks = masks }
}

struct MotionTiming: Hashable, Codable, Sendable {
    let anticipation: Double
    let action: Double
    let hold: Double
    let recovery: Double
    var total: Double { anticipation + action + hold + recovery }
    init(anticipation: Double = 0, action: Double, hold: Double = 0, recovery: Double = 0) {
        self.anticipation = anticipation; self.action = action; self.hold = hold; self.recovery = recovery
    }
}
enum MotionInterpolation: String, Codable, Sendable { case linear, smoothStep }
struct MotionKeyframe: Hashable, Codable, Sendable {
    let progress: Double
    let transform: MotionTransform
    let assetState: MotionAssetID?
    init(progress: Double, transform: MotionTransform, assetState: MotionAssetID? = nil) {
        self.progress = progress; self.transform = transform; self.assetState = assetState
    }
}
struct MotionSample: Hashable, Sendable {
    let transform: MotionTransform
    let assetState: MotionAssetID?
}
struct MotionTrack: Hashable, Codable, Sendable {
    let nodeID: String
    let frames: [MotionKeyframe]
    let interpolation: MotionInterpolation
    init(nodeID: String, frames: [MotionKeyframe], interpolation: MotionInterpolation = .smoothStep) {
        self.nodeID = nodeID; self.frames = frames; self.interpolation = interpolation
    }
    /// Pure reference evaluation; discrete image states never morph into one another.
    func sample(at progress: Double) -> MotionSample? {
        guard let first = frames.first, let last = frames.last else { return nil }
        let p = progress.isFinite ? min(1, max(0, progress)) : 0
        if p <= first.progress { return .init(transform: first.transform, assetState: first.assetState) }
        if p >= last.progress { return .init(transform: last.transform, assetState: last.assetState) }
        guard let index = frames.indices.dropLast().first(where: { frames[$0 + 1].progress > p }) else { return nil }
        let a = frames[index], b = frames[index + 1]
        let duration = b.progress - a.progress
        guard duration > 0 else { return nil }
        var t = (p - a.progress) / duration
        if interpolation == .smoothStep { t = t * t * (3 - 2 * t) }
        return .init(transform: a.transform.interpolated(to: b.transform, progress: t), assetState: a.assetState)
    }
}
struct MotionContact: Hashable, Codable, Sendable {
    let subject: MotionAnchorRef
    let target: MotionAnchorRef
}
struct MotionCue: Hashable, Codable, Sendable {
    let phase: ScenePhase
    let recipe: MotionRecipe
    let subjects: [String]
    let timing: MotionTiming
    let tracks: [MotionTrack]
    let contacts: [MotionContact]
    let maskIDs: [String]
    let condition: MotionCondition
    let repeats: Bool
    init(phase: ScenePhase, recipe: MotionRecipe, subjects: [String], timing: MotionTiming,
         tracks: [MotionTrack] = [], contacts: [MotionContact] = [], maskIDs: [String] = [],
         condition: MotionCondition = .always, repeats: Bool = false) {
        self.phase = phase; self.recipe = recipe; self.subjects = subjects; self.timing = timing
        self.tracks = tracks; self.contacts = contacts; self.maskIDs = maskIDs; self.condition = condition; self.repeats = repeats
    }
}
/// Outcome classifications come from GameSession/Scoring. Data contains no points,
/// selected rating, hidden answer, or executable predicate.
struct MotionRevealPlan: Hashable, Codable, Sendable {
    let action: MotionCue
    let exact: MotionCue?
    let near: MotionCue?
    let apart: MotionCue?
    init(action: MotionCue, exact: MotionCue? = nil, near: MotionCue? = nil, apart: MotionCue? = nil) {
        self.action = action; self.exact = exact; self.near = near; self.apart = apart
    }
}
struct MotionNodeState: Hashable, Codable, Sendable {
    let nodeID: String
    let transform: MotionTransform
    let assetState: MotionAssetID?
    init(nodeID: String, transform: MotionTransform, assetState: MotionAssetID? = nil) {
        self.nodeID = nodeID; self.transform = transform; self.assetState = assetState
    }
}
struct MotionTableau: Hashable, Codable, Sendable { let states: [MotionNodeState] }
struct MotionVariant: Hashable, Codable, Sendable {
    let id: String
    let reveal: MotionRevealPlan
    let reduced: MotionTableau
    let semanticReason: String
}
struct MotionPresentationSignature: Hashable, Codable, Sendable {
    let family: String
    let recipe: MotionRecipe
    let framing: MotionFraming
    let objectPair: [MotionAssetID]
}
enum MotionRenderer: String, Codable, Sendable { case layeredGraph, nativeStory }
struct MotionNativeBinding: Hashable, Codable, Sendable {
    let action: VignetteAction
    let contractVersion: Int
    init(action: VignetteAction, contractVersion: Int = 1) { self.action = action; self.contractVersion = contractVersion }
}
/// Code-adapter coverage from the audited native source, not JSON track coverage.
enum MotionNativeAdapterContract {
    static let version = 1
    static let excludedPilotIDs: Set<Int> = [1108, 1208]
    static let allowedIDs = Set(VignetteBank.all.map(\.id)).subtracting(excludedPilotIDs)
    static let reactionOnlyIDs: Set<Int> = [1379, 1018, 1137, 1120, 1368, 1205, 1207, 1219, 1033, 1383]
    static let actionMotionIDs = allowedIDs.subtracting(reactionOnlyIDs)
    static func action(id: Int) -> VignetteAction? { allowedIDs.contains(id) ? VignetteBank.spec(id: id)?.action : nil }
    static func coverage(id: Int) -> MotionCoverage? {
        guard allowedIDs.contains(id) else { return nil }
        return reactionOnlyIDs.contains(id) ? .reactionOnly : .actionMotion
    }
}

struct ScenePerformance: Identifiable, Hashable, Codable, Sendable {
    var id: Int { roundID }
    let roundID: Int
    let revision: Int
    let renderer: MotionRenderer
    let nativeBinding: MotionNativeBinding?
    let graph: MotionSceneGraph
    let ambient: MotionCue?
    let choice: MotionCue?
    let reveal: MotionRevealPlan
    let reduced: MotionTableau
    let variants: [MotionVariant]
    let review: MotionReview
    let semanticJustification: String
    let signature: MotionPresentationSignature
    init(roundID: Int, revision: Int = 1, graph: MotionSceneGraph, ambient: MotionCue? = nil,
         choice: MotionCue? = nil, reveal: MotionRevealPlan, reduced: MotionTableau,
         variants: [MotionVariant] = [], review: MotionReview = .init(), semanticJustification: String,
         signature: MotionPresentationSignature, renderer: MotionRenderer = .layeredGraph, nativeBinding: MotionNativeBinding? = nil) {
        self.roundID = roundID; self.revision = revision; self.renderer = renderer; self.nativeBinding = nativeBinding
        self.graph = graph; self.ambient = ambient
        self.choice = choice; self.reveal = reveal; self.reduced = reduced; self.variants = variants
        self.review = review; self.semanticJustification = semanticJustification; self.signature = signature
    }
    private enum CodingKeys: String, CodingKey {
        case roundID, revision, renderer, nativeBinding, graph, ambient, choice, reveal, reduced, variants, review, semanticJustification, signature
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(roundID: try c.decode(Int.self, forKey: .roundID), revision: try c.decode(Int.self, forKey: .revision),
                  graph: try c.decode(MotionSceneGraph.self, forKey: .graph), ambient: try c.decodeIfPresent(MotionCue.self, forKey: .ambient),
                  choice: try c.decodeIfPresent(MotionCue.self, forKey: .choice), reveal: try c.decode(MotionRevealPlan.self, forKey: .reveal),
                  reduced: try c.decode(MotionTableau.self, forKey: .reduced), variants: try c.decodeIfPresent([MotionVariant].self, forKey: .variants) ?? [],
                  review: try c.decode(MotionReview.self, forKey: .review), semanticJustification: try c.decode(String.self, forKey: .semanticJustification),
                  signature: try c.decode(MotionPresentationSignature.self, forKey: .signature),
                  renderer: try c.decodeIfPresent(MotionRenderer.self, forKey: .renderer) ?? .layeredGraph,
                  nativeBinding: try c.decodeIfPresent(MotionNativeBinding.self, forKey: .nativeBinding))
    }
}
struct MotionPerformanceCatalogue: Codable, Sendable {
    let schemaVersion: Int
    let performances: [ScenePerformance]
    init(schemaVersion: Int = 1, performances: [ScenePerformance]) { self.schemaVersion = schemaVersion; self.performances = performances }
    func validate(registry: MotionAssetRegistry, expectedRoundIDs: Set<Int> = Set(1001...2000)) throws {
        guard schemaVersion == 1 else { throw MotionValidationError.unsupportedVersion }
        guard Set(performances.map(\.roundID)) == expectedRoundIDs, performances.count == expectedRoundIDs.count else {
            throw MotionValidationError.catalogueCoverage
        }
        for performance in performances { try MotionPerformanceValidator.validate(performance, registry: registry) }
    }
}

enum MotionValidationError: Error, Equatable {
    case unsupportedVersion, catalogueCoverage, duplicateAsset(String), invalidAsset(String), unknownAsset(String)
    case invalidID, invalidGraph, duplicateNode(String), unknownNode(String), invalidGeometry(String)
    case invalidAnchor(String), attachmentCycle, invalidMask(String), invalidTiming, invalidPath(String)
    case phasePrivacy, invalidPhase, missingCapability(String, MotionCapability), invalidState(String)
    case invalidReview, invalidVariant, invalidSemanticReason, reducedCoverage, reducedMismatch(String), invalidNativeBinding(Int)
}

enum MotionPerformanceValidator {
    static func validate(_ performance: ScenePerformance, registry: MotionAssetRegistry) throws {
        guard (1001...2000).contains(performance.roundID), (1...10_000).contains(performance.revision) else { throw MotionValidationError.invalidID }
        guard readable(performance.semanticJustification), token(performance.signature.family),
              (1...2).contains(performance.signature.objectPair.count) else { throw MotionValidationError.invalidSemanticReason }
        switch performance.renderer {
        case .layeredGraph:
            guard performance.nativeBinding == nil else { throw MotionValidationError.invalidNativeBinding(performance.roundID) }
        case .nativeStory:
            guard let binding = performance.nativeBinding, binding.contractVersion == MotionNativeAdapterContract.version,
                  MotionNativeAdapterContract.action(id: performance.roundID) == binding.action,
                  MotionNativeAdapterContract.coverage(id: performance.roundID) == performance.review.coverage,
                  performance.variants.isEmpty else { throw MotionValidationError.invalidNativeBinding(performance.roundID) }
            let nativeCues = [performance.ambient, performance.choice, performance.reveal.action,
                              performance.reveal.exact, performance.reveal.near, performance.reveal.apart].compactMap { $0 }
            guard nativeCues.allSatisfy({ $0.tracks.isEmpty }) else { throw MotionValidationError.invalidNativeBinding(performance.roundID) }
        }
        let graph = performance.graph
        guard token(graph.id), (1...24).contains(graph.nodes.count) else { throw MotionValidationError.invalidGraph }
        var nodes: [String: MotionNode] = [:]
        for node in graph.nodes {
            guard token(node.id) else { throw MotionValidationError.invalidGraph }
            guard nodes.updateValue(node, forKey: node.id) == nil else { throw MotionValidationError.duplicateNode(node.id) }
            let capability = try asset(node.asset, registry)
            guard frame(node.frame), transform(node.initial) else { throw MotionValidationError.invalidGeometry(node.id) }
            if let labels = node.labels {
                guard labels.count <= 2, ![.backdrop, .primaryActor, .secondaryActor].contains(node.role), labels.allSatisfy({ label in
                    (1...32).contains(label.text.count) && label.text.utf8.count <= 96 &&
                    !label.text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) &&
                    unitFrame(label.frame) && label.fontScale.isFinite && (0.05...0.4).contains(label.fontScale)
                }) else { throw MotionValidationError.invalidGeometry(node.id) }
            }
            for (name, point) in capability.anchors {
                guard token(name), unitPoint(point) else { throw MotionValidationError.invalidAnchor(node.id + "." + name) }
            }
            if let face = capability.faceExclusion, !unitFrame(face) { throw MotionValidationError.invalidGeometry(node.id) }
            for state in node.allowedStates {
                let other = try asset(state, registry)
                if capability.poseFamily != nil || other.poseFamily != nil {
                    guard let family = capability.poseFamily, token(family), family == other.poseFamily else {
                        throw MotionValidationError.invalidState(node.id)
                    }
                }
            }
        }
        for node in graph.nodes {
            var ancestry = Set([node.id]), cursor = node
            while let attachment = cursor.attachment {
                try anchor(attachment.parent, nodes: nodes, registry: registry)
                let child = try asset(cursor.asset, registry)
                guard child.anchors[attachment.childAnchor] != nil, finiteOffset(attachment.offset) else { throw MotionValidationError.invalidAnchor(cursor.id) }
                for state in cursor.allowedStates {
                    guard try asset(state, registry).anchors[attachment.childAnchor] != nil else { throw MotionValidationError.invalidAnchor(cursor.id) }
                }
                guard ancestry.insert(attachment.parent.nodeID).inserted else { throw MotionValidationError.attachmentCycle }
                guard let parent = nodes[attachment.parent.nodeID] else { throw MotionValidationError.unknownNode(attachment.parent.nodeID) }
                cursor = parent
            }
        }
        var masks = Set<String>()
        for mask in graph.masks {
            guard token(mask.id), masks.insert(mask.id).inserted, mask.foregroundNodeID != mask.subjectNodeID,
                  let foreground = nodes[mask.foregroundNodeID], nodes[mask.subjectNodeID] != nil,
                  foreground.layer == .foreground, unitFrame(mask.region) else { throw MotionValidationError.invalidMask(mask.id) }
            try require(.foregroundCut, asset: foreground.asset, registry: registry)
        }
        for assetID in performance.signature.objectPair { _ = try asset(assetID, registry) }
        if let cue = performance.ambient {
            guard cue.phase == .question else { throw MotionValidationError.invalidPhase }
            try validate(cue, graph: graph, nodes: nodes, masks: masks, registry: registry)
        }
        if let cue = performance.choice {
            guard cue.phase == .choice, [.acknowledge, .consider, .settle].contains(cue.recipe) else { throw MotionValidationError.phasePrivacy }
            try validate(cue, graph: graph, nodes: nodes, masks: masks, registry: registry)
        }
        try reveal(performance.reveal, graph: graph, nodes: nodes, masks: masks, registry: registry)
        try tableau(performance.reduced, nodes: nodes, registry: registry)
        if performance.renderer == .layeredGraph { try reducedEnd(performance.reduced, action: performance.reveal.action) }
        guard performance.variants.count <= 3, Set(performance.variants.map(\.id)).count == performance.variants.count else { throw MotionValidationError.invalidVariant }
        for variant in performance.variants {
            guard token(variant.id), readable(variant.semanticReason) else { throw MotionValidationError.invalidVariant }
            try reveal(variant.reveal, graph: graph, nodes: nodes, masks: masks, registry: registry)
            try tableau(variant.reduced, nodes: nodes, registry: registry)
            try reducedEnd(variant.reduced, action: variant.reveal.action)
        }
        if performance.review.playback != .notReviewed && performance.review.semantic != .reviewed { throw MotionValidationError.invalidReview }
        if performance.review.coverage == .authoredTableau &&
            (performance.renderer != .layeredGraph || performance.reveal.action.recipe != .staticTableau || !performance.reveal.action.tracks.isEmpty) {
            throw MotionValidationError.invalidReview
        }
        if performance.renderer == .layeredGraph && performance.review.coverage == .actionMotion && [.staticTableau, .reactionOnly, .acknowledge].contains(performance.reveal.action.recipe) { throw MotionValidationError.invalidReview }
        if performance.renderer == .layeredGraph && performance.review.coverage == .actionMotion {
            guard performance.reveal.action.tracks.contains(where: { track in
                guard let first = track.frames.first?.transform else { return false }
                return track.frames.dropFirst().contains { $0.transform != first }
            }) else { throw MotionValidationError.invalidReview }
        }
    }

    private static func reveal(_ plan: MotionRevealPlan, graph: MotionSceneGraph, nodes: [String: MotionNode], masks: Set<String>, registry: MotionAssetRegistry) throws {
        guard plan.action.phase == .reveal, plan.action.condition == .always else { throw MotionValidationError.invalidPhase }
        try validate(plan.action, graph: graph, nodes: nodes, masks: masks, registry: registry)
        for (cue, condition) in [(plan.exact, MotionCondition.exact), (plan.near, .near), (plan.apart, .apart)] {
            guard let cue else { continue }
            guard cue.phase == .reveal, cue.condition == condition else { throw MotionValidationError.invalidPhase }
            try validate(cue, graph: graph, nodes: nodes, masks: masks, registry: registry)
        }
    }
    private static func validate(_ cue: MotionCue, graph: MotionSceneGraph, nodes: [String: MotionNode], masks: Set<String>, registry: MotionAssetRegistry) throws {
        let times = [cue.timing.anticipation, cue.timing.action, cue.timing.hold, cue.timing.recovery]
        guard times.allSatisfy({ $0.isFinite && (0...2).contains($0) }), cue.timing.total <= 2,
              cue.tracks.isEmpty || cue.timing.total > 0 else { throw MotionValidationError.invalidTiming }
        guard cue.phase == .reveal || cue.condition == .always else { throw MotionValidationError.phasePrivacy }
        guard !cue.repeats || cue.phase == .question else { throw MotionValidationError.phasePrivacy }
        guard !cue.subjects.isEmpty, Set(cue.subjects).count == cue.subjects.count, cue.tracks.count <= 3,
              Set(cue.tracks.map(\.nodeID)).count == cue.tracks.count else { throw MotionValidationError.invalidGraph }
        for subject in cue.subjects { guard nodes[subject] != nil else { throw MotionValidationError.unknownNode(subject) } }
        for contact in cue.contacts {
            try anchor(contact.subject, nodes: nodes, registry: registry)
            try anchor(contact.target, nodes: nodes, registry: registry)
        }
        guard cue.maskIDs.allSatisfy({ masks.contains($0) }) else { throw MotionValidationError.invalidMask(cue.maskIDs.first ?? "") }
        if [.peek, .uncover].contains(cue.recipe), cue.maskIDs.isEmpty { throw MotionValidationError.invalidMask("required") }
        if [.pass, .exchange, .carry, .wear, .attach].contains(cue.recipe), cue.contacts.isEmpty { throw MotionValidationError.invalidAnchor("contact required") }
        for subject in cue.subjects {
            let node = nodes[subject]!
            switch cue.recipe {
            case .spin, .turn, .roll: try require(.spin, asset: node.asset, registry: registry)
            case .hover, .orbit: try require(.levitates, asset: node.asset, registry: registry)
            case .sway, .tether: try require(.tethered, asset: node.asset, registry: registry)
            case .wear, .attach: try require(.attachable, asset: node.asset, registry: registry)
            case .pass, .exchange, .carry: try require(.grippable, asset: node.asset, registry: registry)
            default: break
            }
            if cue.repeats { try require(.ambientLayer, asset: node.asset, registry: registry) }
        }
        for track in cue.tracks {
            guard let node = nodes[track.nodeID] else { throw MotionValidationError.unknownNode(track.nodeID) }
            guard cue.subjects.contains(track.nodeID), (2...16).contains(track.frames.count),
                  track.frames.first?.progress == 0, track.frames.last?.progress == 1 else { throw MotionValidationError.invalidPath(track.nodeID) }
            var previous = -1.0
            for key in track.frames {
                guard key.progress.isFinite, (0...1).contains(key.progress), key.progress > previous, transform(key.transform) else { throw MotionValidationError.invalidPath(track.nodeID) }
                previous = key.progress
                try state(key.assetState, node: node, registry: registry)
            }
            let values = track.frames.map(\.transform), first = values[0]
            // Placement of an attached child is derived from the parent's
            // anchor every frame; authored child XY changes are ignored by the
            // renderer. Reject them rather than certifying motion that cannot
            // appear. Rotation, scale and opacity remain meaningful locally.
            if node.attachment != nil,
               values.contains(where: { $0.x != first.x || $0.y != first.y }) {
                throw MotionValidationError.invalidPath(track.nodeID)
            }
            if values.contains(where: { $0.x != first.x || $0.y != first.y }) { try require(.translate, asset: node.asset, registry: registry) }
            if values.contains(where: { $0.rotation != first.rotation }) { try require(values.contains(where: { abs($0.rotation) > 45 }) ? .spin : .tilt, asset: node.asset, registry: registry) }
            if values.contains(where: { $0.scale != first.scale }) { try require(.scale, asset: node.asset, registry: registry) }
            if values.contains(where: { $0.opacity != first.opacity }) { try require(.opacity, asset: node.asset, registry: registry) }
        }
    }
    private static func tableau(_ value: MotionTableau, nodes: [String: MotionNode], registry: MotionAssetRegistry) throws {
        guard Set(value.states.map(\.nodeID)) == Set(nodes.keys), value.states.count == nodes.count else { throw MotionValidationError.reducedCoverage }
        for state in value.states {
            guard let node = nodes[state.nodeID], transform(state.transform) else { throw MotionValidationError.invalidGeometry(state.nodeID) }
            try self.state(state.assetState, node: node, registry: registry)
        }
    }
    private static func reducedEnd(_ value: MotionTableau, action: MotionCue) throws {
        for track in action.tracks {
            guard let end = track.frames.last, let state = value.states.first(where: { $0.nodeID == track.nodeID }),
                  state.transform == end.transform,
                  end.assetState == nil || state.assetState == end.assetState else {
                throw MotionValidationError.reducedMismatch(track.nodeID)
            }
        }
    }
    private static func state(_ state: MotionAssetID?, node: MotionNode, registry: MotionAssetRegistry) throws {
        guard let state, state != node.asset else { return }
        guard node.allowedStates.contains(state) else { throw MotionValidationError.invalidState(node.id) }
        _ = try asset(state, registry); try require(.poseSet, asset: node.asset, registry: registry)
    }
    private static func anchor(_ ref: MotionAnchorRef, nodes: [String: MotionNode], registry: MotionAssetRegistry) throws {
        guard let node = nodes[ref.nodeID] else { throw MotionValidationError.unknownNode(ref.nodeID) }
        guard token(ref.anchor), try asset(node.asset, registry).anchors[ref.anchor] != nil else { throw MotionValidationError.invalidAnchor(ref.nodeID + "." + ref.anchor) }
        for state in node.allowedStates {
            guard try asset(state, registry).anchors[ref.anchor] != nil else { throw MotionValidationError.invalidAnchor(ref.nodeID + "." + ref.anchor) }
        }
    }
    private static func asset(_ id: MotionAssetID, _ registry: MotionAssetRegistry) throws -> MotionAssetCapabilities {
        let parts = id.rawValue.split(separator: "/", omittingEmptySubsequences: false)
        guard (2...3).contains(parts.count), parts.allSatisfy({ token(String($0)) && $0 != "." && $0 != ".." }) else { throw MotionValidationError.invalidAsset(id.rawValue) }
        guard let value = registry.assets[id] else { throw MotionValidationError.unknownAsset(id.rawValue) }
        return value
    }
    private static func require(_ capability: MotionCapability, asset id: MotionAssetID, registry: MotionAssetRegistry) throws {
        guard try asset(id, registry).capabilities.contains(capability) else { throw MotionValidationError.missingCapability(id.rawValue, capability) }
    }
    private static func token(_ value: String) -> Bool {
        (1...64).contains(value.utf8.count) && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45 || $0 == 46 }
    }
    private static func readable(_ value: String) -> Bool { (12...500).contains(value.count) && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) } }
    private static func unitPoint(_ p: MotionPoint) -> Bool { p.x.isFinite && p.y.isFinite && (0...1).contains(p.x) && (0...1).contains(p.y) }
    private static func finiteOffset(_ p: MotionPoint) -> Bool { p.x.isFinite && p.y.isFinite && (-1...1).contains(p.x) && (-1...1).contains(p.y) }
    private static func frame(_ f: MotionFrame) -> Bool { finiteOffset(.init(x: f.x, y: f.y)) && f.width.isFinite && f.height.isFinite && f.width > 0 && f.width <= 2 && f.height > 0 && f.height <= 2 }
    private static func unitFrame(_ f: MotionFrame) -> Bool { frame(f) && f.width <= 1 && f.height <= 1 && f.x - f.width / 2 >= 0 && f.x + f.width / 2 <= 1 && f.y - f.height / 2 >= 0 && f.y + f.height / 2 <= 1 }
    private static func transform(_ t: MotionTransform) -> Bool {
        [t.x, t.y, t.rotation, t.scale, t.opacity].allSatisfy(\.isFinite) && (-0.5...1.5).contains(t.x) && (-0.5...1.5).contains(t.y) && (-720...720).contains(t.rotation) && (0.1...3).contains(t.scale) && (0...1).contains(t.opacity)
    }
}
