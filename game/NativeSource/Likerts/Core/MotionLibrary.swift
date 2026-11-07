import Foundation

enum MotionPilotLibraryError: Error { case missingRegistry, unsupportedRegistry }

/// Eight explicit pilot descriptors only. No bulk relation-to-motion inference.
enum MotionPilotLibrary {
    static let ids: Set<Int> = [1001, 1051, 1108, 1208, 1456, 1555, 1702, 1954]
    static let registryResult: Result<MotionAssetRegistry, Error> = {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        do {
            guard let url = bundle.url(forResource: "registry", withExtension: "json", subdirectory: "MotionData")
                ?? bundle.url(forResource: "registry", withExtension: "json") else { throw MotionPilotLibraryError.missingRegistry }
            let data = try Data(contentsOf: url)
            guard data.count <= 256_000 else { throw MotionPilotLibraryError.unsupportedRegistry }
            let file = try JSONDecoder().decode(RegistryFile.self, from: data)
            guard file.schemaVersion == 1 else { throw MotionPilotLibraryError.unsupportedRegistry }
            return .success(try MotionAssetRegistry(file.assets))
        } catch { return .failure(error) }
    }()
    static var registry: MotionAssetRegistry? { try? registryResult.get() }
    static let all: [ScenePerformance] = [trade(), pancakes(), catBox(), trainWindow(), protectBook(), passController(), inspectSky(), robotEmblem()]
    static func performance(id: Int) -> ScenePerformance? { all.first { $0.roundID == id } }
    static func validatePilots() throws {
        try MotionPerformanceCatalogue(performances: all).validate(registry: registryResult.get(), expectedRoundIDs: ids)
    }
    private struct RegistryFile: Decodable { let schemaVersion: Int; let assets: [MotionAssetCapabilities] }

    private static func node(_ id: String, _ asset: String, _ role: MotionRole, _ layer: MotionLayer,
                             _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                             rotation: Double = 0, opacity: Double = 1, attachment: MotionAttachment? = nil) -> MotionNode {
        .init(id: id, asset: .init(asset), role: role, layer: layer, frame: .init(x: x, y: y, width: w, height: h),
              initial: .init(x: x, y: y, rotation: rotation, opacity: opacity), attachment: attachment)
    }
    private static func actor(_ id: String, _ value: Int, _ x: Double, _ y: Double, _ w: Double = 0.28, _ h: Double = 0.78, pose: String = "hold") -> MotionNode {
        .init(id: id, asset: .init("cast/\(pose)/\(value)"), role: .primaryActor, layer: .actor,
              frame: .init(x: x, y: y, width: w, height: h), allowedStates: [.init("cast/celebrate/\(value)")])
    }
    private static func bg(_ topic: String, opacity: Double = 0.65) -> MotionNode {
        node("background", "bg/" + topic, .backdrop, .background, 0.5, 0.5, 1, 1, opacity: opacity)
    }
    private static func track(_ id: String, _ values: [(Double, MotionTransform)]) -> MotionTrack {
        .init(nodeID: id, frames: values.map { .init(progress: $0.0, transform: $0.1) })
    }
    private static func cue(_ recipe: MotionRecipe, _ subjects: [String], _ tracks: [MotionTrack], duration: Double = 0.9,
                            contacts: [MotionContact] = [], masks: [String] = [], phase: ScenePhase = .reveal) -> MotionCue {
        .init(phase: phase, recipe: recipe, subjects: subjects, timing: .init(action: duration), tracks: tracks, contacts: contacts, maskIDs: masks)
    }
    private static func make(_ id: Int, _ graphID: String, _ nodes: [MotionNode], _ action: MotionCue,
                             _ framing: MotionFraming, _ pair: [String], _ reason: String,
                             masks: [MotionForegroundMask] = [], ambient: MotionCue? = nil) -> ScenePerformance {
        let graph = MotionSceneGraph(id: graphID, nodes: nodes, masks: masks)
        let principal = nodes.first { $0.role == .primaryActor }
        let choice: MotionCue? = principal.map { actor in
            .init(phase: .choice, recipe: .acknowledge, subjects: [actor.id], timing: .init(action: 0.36), tracks: [
                track(actor.id, [(0, actor.initial), (0.44, .init(x: actor.initial.x, y: actor.initial.y, rotation: -3)), (1, actor.initial)])])
        }
        let exact: MotionCue? = principal.map { actor in
            let positive = actor.allowedStates.first
            let settled = action.tracks.first(where: { $0.nodeID == actor.id })?.frames.last?.transform ?? actor.initial
            return .init(phase: .reveal, recipe: .reactionOnly, subjects: [actor.id], timing: .init(action: 0.3), tracks: [
                .init(nodeID: actor.id, frames: [.init(progress: 0, transform: settled),
                                               .init(progress: 0.5, transform: .init(x: settled.x, y: settled.y, rotation: 4), assetState: positive),
                                               .init(progress: 1, transform: settled, assetState: positive)])], condition: .exact)
        }
        let reduced = MotionTableau(states: nodes.map { node in
            let last = action.tracks.first { $0.nodeID == node.id }?.frames.last
            return .init(nodeID: node.id, transform: last?.transform ?? node.initial, assetState: last?.assetState)
        })
        return .init(roundID: id, graph: graph, ambient: ambient, choice: choice,
                     reveal: .init(action: action, exact: exact), reduced: reduced,
                     review: .init(semantic: .mapped, playback: .notReviewed, coverage: .actionMotion),
                     semanticJustification: reason,
                     signature: .init(family: graphID, recipe: action.recipe, framing: framing, objectPair: pair.map { MotionAssetID($0) }))
    }

    private static func trade() -> ScenePerformance {
        let nodes = [bg("snacks"), node("bench", "set/bench", .set, .setBack, 0.5, 0.86, 0.96, 0.38),
                     actor("giver", 2, 0.23, 0.48, 0.32, 0.85), actor("receiver", 3, 0.77, 0.48, 0.32, 0.85),
                     node("cookie", "snacks/cookie", .primaryProp, .prop, 0.30, 0.72, 0.18, 0.22, rotation: -12),
                     node("popcorn", "snacks/popcorn", .secondaryProp, .prop, 0.69, 0.77, 0.21, 0.29, rotation: -4)]
        let action = cue(.exchange, ["cookie", "popcorn"], [
            track("cookie", [(0,.init(x:0.30,y:0.72,rotation:-12)),(0.16,.init(x:0.29,y:0.73,rotation:-15)),(0.55,.init(x:0.50,y:0.54)),(0.88,.init(x:0.69,y:0.72,rotation:12)),(1,.init(x:0.68,y:0.72,rotation:12))]),
            track("popcorn", [(0,.init(x:0.69,y:0.77,rotation:-4)),(0.16,.init(x:0.70,y:0.78,rotation:-6)),(0.55,.init(x:0.50,y:0.86)),(0.88,.init(x:0.31,y:0.77,rotation:4)),(1,.init(x:0.32,y:0.77,rotation:4))])], contacts: [
                .init(subject:.init(nodeID:"cookie",anchor:"grip"),target:.init(nodeID:"giver",anchor:"rightHand")),
                .init(subject:.init(nodeID:"popcorn",anchor:"grip"),target:.init(nodeID:"receiver",anchor:"leftHand"))])
        return make(1001,"story.tradeSnack",nodes,action,.duet,["snacks/cookie","snacks/popcorn"],"The held cookie and popcorn exchange between two friends along separate paths; no finger or character rig is implied.")
    }
    private static func pancakes() -> ScenePerformance {
        let nodes = [bg("kitchen",opacity:0.48), node("table","set/table",.set,.setBack,0.52,0.81,1.02,0.55),
                     actor("cook",3,0.17,0.45,0.27,0.76), node("pancakes","kitchen/pancakes",.primaryProp,.prop,0.66,0.60,0.43,0.63),
                     node("spatula","kitchen/spatula",.secondaryProp,.prop,0.34,0.76,0.25,0.43,rotation:-24)]
        let action=cue(.settle,["spatula","pancakes"],[
            track("spatula",[(0,.init(x:0.34,y:0.76,rotation:-24)),(0.16,.init(x:0.32,y:0.78,rotation:-28)),(0.55,.init(x:0.49,y:0.72,rotation:-12)),(0.80,.init(x:0.46,y:0.72,rotation:-15)),(1,.init(x:0.40,y:0.76,rotation:-24))]),
            track("pancakes",[(0,.init(x:0.66,y:0.60)),(0.45,.init(x:0.66,y:0.60)),(0.72,.init(x:0.66,y:0.58,rotation:8)),(0.87,.init(x:0.66,y:0.61,rotation:4)),(1,.init(x:0.66,y:0.60,rotation:6))])])
        return make(1051,"pilot.wonkyPancakes",nodes,action,.tabletop,["kitchen/pancakes","kitchen/spatula"],"The spatula approaches the supported pancake stack, which settles at a slightly uneven angle; this does not flip a separately rigged pancake.")
    }
    private static func catBox() -> ScenePerformance {
        let nodes=[bg("pets",opacity:0.92), node("boxBack","set/box",.set,.setBack,0.58,0.68,0.72,0.72),
                   actor("watcher",3,0.15,0.69,0.23,0.63,pose:"peek"), node("cat","pets/cat",.primaryProp,.prop,0.58,0.49,0.37,0.73),
                   node("boxFront","set/box",.occluder,.foreground,0.58,0.68,0.72,0.72)]
        // Region is normalized SOURCE-NODE coordinates, not a canvas rectangle.
        let mask=MotionForegroundMask(id:"boxRim",foregroundNodeID:"boxFront",subjectNodeID:"cat",region:.init(x:0.5,y:0.825,width:1,height:0.35))
        let action=cue(.peek,["cat"],[track("cat",[(0,.init(x:0.58,y:0.49,rotation:-3)),(0.15,.init(x:0.58,y:0.51,rotation:-5)),(0.58,.init(x:0.58,y:0.41,rotation:1)),(0.83,.init(x:0.58,y:0.47)),(1,.init(x:0.58,y:0.46))])],masks:["boxRim"])
        return make(1108,"story.catBox",nodes,action,.foreground,["pets/cat","set/box"],"The cat rises slightly above the actual box rim and settles safely inside it, preserving the authored cat-and-box scene; no tail, leg or blink animation is claimed.",masks:[mask])
    }
    private static func trainWindow() -> ScenePerformance {
        let nodes=[node("scenery","bg/outdoors",.backdrop,.background,0.66,0.44,0.504,0.726),
                   node("window","set/window",.set,.setBack,0.66,0.44,0.70,1.10), node("seat","story/trainseat",.set,.setBack,0.22,0.71,0.47,0.86),
                   actor("traveller",4,0.32,0.54,0.29,0.72,pose:"peek"), node("ticket","story/ticket",.detail,.prop,0.75,0.84,0.22,0.24,rotation:-12)]
        let ambient=cue(.windowDrift,["scenery"],[track("scenery",[(0,.init(x:0.66,y:0.44)),(0.5,.init(x:0.645,y:0.44)),(1,.init(x:0.66,y:0.44))])],duration:2,phase:.question)
        let action=cue(.windowDrift,["scenery"],[track("scenery",[(0,.init(x:0.66,y:0.44)),(0.12,.init(x:0.66,y:0.44)),(0.82,.init(x:0.605,y:0.44)),(1,.init(x:0.61,y:0.44))])],duration:1.15)
        return make(1208,"story.trainWindow",nodes,action,.window,["story/trainseat","set/window"],"A separate outdoor view drifts inside a fixed train-window viewport while the seated traveller stays still. The viewport uses bounded overscan, not a moving whole screen or walking animation.",ambient:ambient)
    }
    private static func protectBook() -> ScenePerformance {
        let nodes=[bg("books",opacity:0.46),node("table","set/table",.set,.setBack,0.55,0.96,1.52,0.90),actor("reader",3,0.17,0.39,0.25,0.67),
                   node("book","books/novel",.primaryProp,.prop,0.37,0.57,0.29,0.49,rotation:-8),node("cup","books/teacup",.secondaryProp,.prop,0.60,0.60,0.22,0.32)]
        let action=cue(.protect,["cup"],[track("cup",[(0,.init(x:0.60,y:0.60)),(0.16,.init(x:0.58,y:0.60)),(0.76,.init(x:0.80,y:0.60)),(0.9,.init(x:0.77,y:0.60)),(1,.init(x:0.78,y:0.60))])])
        return make(1456,"pilot.protectBook",nodes,action,.closeUp,["books/novel","books/teacup"],"The teacup moves deliberately farther from the library book and settles across a conspicuously large safe gap; no page-turn or liquid simulation is implied.")
    }
    private static func passController() -> ScenePerformance {
        let nodes=[bg("games",opacity:0.65),node("bench","set/bench",.set,.setBack,0.5,0.86,0.96,0.38),actor("giver",3,0.23,0.48,0.31,0.84),actor("receiver",5,0.77,0.48,0.31,0.84),
                   node("controller","games/controller",.primaryProp,.prop,0.32,0.73,0.22,0.31)]
        let action=cue(.pass,["controller"],[track("controller",[(0,.init(x:0.32,y:0.73,rotation:-5)),(0.17,.init(x:0.30,y:0.74,rotation:-8)),(0.58,.init(x:0.5,y:0.66)),(0.88,.init(x:0.69,y:0.71,rotation:5)),(1,.init(x:0.68,y:0.72,rotation:3))])],contacts:[
            .init(subject:.init(nodeID:"controller",anchor:"grip"),target:.init(nodeID:"giver",anchor:"rightHand")),
            .init(subject:.init(nodeID:"controller",anchor:"grip"),target:.init(nodeID:"receiver",anchor:"leftHand"))])
        return make(1555,"pilot.passController",nodes,action,.duet,["games/controller","cast/hold/5"],"One existing controller passes from the giver toward the recipient's measured hand area; the player's selected rating never chooses the recipient or exposes an answer.")
    }
    private static func inspectSky() -> ScenePerformance {
        let nodes=[bg("weather",opacity:0.50),actor("observer",3,0.25,0.66,0.29,0.62,pose:"peek"),
                   node("sun","weather/sun",.primaryProp,.prop,0.64,0.30,0.30,0.52),node("cloud","weather/cloud",.secondaryProp,.prop,0.84,0.38,0.38,0.38)]
        let action=cue(.inspect,["observer","cloud"],[
            track("observer",[(0,.init(x:0.25,y:0.66)),(0.18,.init(x:0.25,y:0.67,rotation:-2)),(0.65,.init(x:0.25,y:0.65,rotation:5)),(1,.init(x:0.25,y:0.66,rotation:2))]),
            track("cloud",[(0,.init(x:0.84,y:0.38)),(0.16,.init(x:0.84,y:0.38)),(0.84,.init(x:0.65,y:0.38)),(1,.init(x:0.67,y:0.38))])],duration:1.1)
        return make(1702,"pilot.inspectSky",nodes,action,.wide,["weather/sun","weather/cloud"],"A separate cloud crosses partly in front of the sun as the totem gives one whole-body upward attention cue; this is not an articulated eye or weather-particle effect.")
    }
    private static func robotEmblem() -> ScenePerformance {
        let nodes=[bg("future",opacity:0.65),actor("maker",3,0.17,0.60,0.24,0.63),node("robot","future/robot",.primaryProp,.prop,0.64,0.54,0.37,0.85),
                   node("emblem","future/star",.secondaryProp,.prop,0.32,0.83,0.13,0.20)]
        let action=cue(.attach,["emblem"],[track("emblem",[(0,.init(x:0.32,y:0.83)),(0.16,.init(x:0.30,y:0.84,rotation:-16,scale:0.9)),(0.66,.init(x:0.59,y:0.70,rotation:4,scale:0.75)),(0.86,.init(x:0.64,y:0.71,scale:0.7)),(1,.init(x:0.64,y:0.72,scale:0.7))])],contacts:[
            .init(subject:.init(nodeID:"emblem",anchor:"grip"),target:.init(nodeID:"robot",anchor:"body"))])
        return make(1954,"pilot.robotEmblem",nodes,action,.portrait,["future/robot","future/star"],"The existing star becomes a small emblem on the robot's lower body, below its face, to make the appliance feel personal; no facial, material or skin morph is performed.")
    }
}
