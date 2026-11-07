import Foundation

enum VignetteFamily: String, CaseIterable, Codable, Sendable {
    case tabletop, wearUse, peek, share, journey, build

    var framing: String {
        switch self {
        case .tabletop: return "closeup"
        case .wearUse: return "portrait"
        case .peek: return "foreground"
        case .share: return "duet"
        case .journey: return "wide"
        case .build: return "vertical"
        }
    }
}

/// Closed names let the native renderer implement each statement's real action.
/// An action is authored content, not an inference about the player's answer.
enum VignetteAction: String, CaseIterable, Codable, Sendable {
    case countDivide, arrangeSnacks, wearNecklace, napkinPlan, saveCookie, fruitBottom
    case tradeSnack, offerBite, snackDetour, parkWalk, bridgeBowl, fruitFace
    case petPhoto, fishSketch, raincoatWalk, carryToy, catBox, catOnBook
    case catLap, catConversation, dogWalk, dogChoice, rabbitPalace, rabbitCourse
    case sortRecords, tuneGuitar, wearHeadphones, quietGuitar, hiddenHeadphones, guitarHide
    case shareMic, lendHeadphones, picnicBand, streetDrummer, pretendStage, radioStack
    case unfoldMap, planMap, giantHat, rollingCase, suitcaseSpace, surprisePack
    case trainFriends, lendHat, trainWindow, mapDetour, postcardWall, packingPuzzle
}

struct VignetteSpec: Identifiable, Hashable, Codable, Sendable {
    let id: Int
    let family: VignetteFamily
    let action: VignetteAction
    let primaryAsset: String
    let secondaryAsset: String
    let setPiece: String
    let detailAssets: [String]
    let castCount: Int
    let summary: String
    let revealSummary: String

    init(id: Int, family: VignetteFamily, action: VignetteAction, primaryAsset: String,
         secondaryAsset: String, setPiece: String, detailAssets: [String] = [],
         castCount: Int = 1, summary: String, revealSummary: String) {
        self.id = id; self.family = family; self.action = action
        self.primaryAsset = primaryAsset; self.secondaryAsset = secondaryAsset
        self.setPiece = setPiece; self.detailAssets = detailAssets; self.castCount = castCount
        self.summary = summary; self.revealSummary = revealSummary
    }
}

struct ScenePresentationProfile: Equatable, Sendable {
    let family: String
    let framing: String
    let objectPair: String
    let isVignette: Bool
}

enum VignetteValidationError: Error, Equatable {
    case wrongCount, duplicateID(Int), unknownRound(Int), wrongTopicCount(String)
    case wrongFamilyCount(String, String), invalidAsset(Int, String), invalidSetPiece(Int)
    case invalidCast(Int), invalidSummary(Int), duplicateAction(String)
}

enum VignetteBank {
    static let pilotTopics: [TopicID] = [.snacks, .pets, .music, .travel]
    static let newPropKeys: Set<String> = ["bowl", "loosepopcorn", "necklace", "napkin", "cushion", "ball", "brush", "headphones", "recordplayer", "trainseat", "passport", "ticket", "raincoat", "opensuitcase", "recordsleeves", "icecreambowl", "fruitface", "pianobench"]
    static let setPieces: Set<String> = ["table", "box", "window", "curtain", "bench", "path", "recordrack", "envelope"]
    static let availableAssets: Set<String> = Set(TopicID.allCases.flatMap { topic in
        topic.definition.props.map { "\(topic.rawValue)/\($0)" }
    }).union(newPropKeys.map { "story/\($0)" })

    // Each mapping upgrades an existing stable record; no question is added,
    // rewritten or counted twice. The complete storyboard is in Design/StoryVignettes.
    static let all: [VignetteSpec] = authored
    private static let byID = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    static func spec(id: Int) -> VignetteSpec? { byID[id] }

    static func validate(catalog: TopicCatalog) throws {
        try validate(all, catalog: catalog)
    }

    static func validate(_ specs: [VignetteSpec], catalog: TopicCatalog) throws {
        guard specs.count == 48 else { throw VignetteValidationError.wrongCount }
        var ids = Set<Int>(), actions = Set<String>()
        for spec in specs {
            guard ids.insert(spec.id).inserted else { throw VignetteValidationError.duplicateID(spec.id) }
            guard let round = catalog.round(id: spec.id), pilotTopics.contains(round.topic) else {
                throw VignetteValidationError.unknownRound(spec.id)
            }
            guard actions.insert(spec.action.rawValue).inserted else { throw VignetteValidationError.duplicateAction(spec.action.rawValue) }
            for asset in [spec.primaryAsset, spec.secondaryAsset] + spec.detailAssets {
                guard availableAssets.contains(asset) else { throw VignetteValidationError.invalidAsset(spec.id, asset) }
            }
            guard setPieces.contains(spec.setPiece) else { throw VignetteValidationError.invalidSetPiece(spec.id) }
            guard (1...2).contains(spec.castCount) else { throw VignetteValidationError.invalidCast(spec.id) }
            guard [spec.summary, spec.revealSummary].allSatisfy({ text in
                (20...250).contains(text.count) && !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
            }) else { throw VignetteValidationError.invalidSummary(spec.id) }
        }
        for topic in pilotTopics {
            let group = specs.filter { catalog.round(id: $0.id)?.topic == topic }
            guard group.count == 12 else { throw VignetteValidationError.wrongTopicCount(topic.rawValue) }
            for family in VignetteFamily.allCases {
                guard group.filter({ $0.family == family }).count == 2 else {
                    throw VignetteValidationError.wrongFamilyCount(topic.rawValue, family.rawValue)
                }
            }
        }
    }

    static func profile(for round: TopicRound) -> ScenePresentationProfile {
        if let spec = spec(id: round.id) {
            return .init(family: "story.\(spec.family.rawValue)", framing: spec.family.framing,
                         objectPair: pair(spec.primaryAsset, spec.secondaryAsset), isVignette: true)
        }
        return .init(family: "stage.\(round.scene.relation.rawValue)", framing: "stage",
                     objectPair: pair(round.scene.primary, round.scene.secondary), isVignette: false)
    }

    private static func pair(_ first: String, _ second: String) -> String {
        func identity(_ key: String) -> String {
            let raw = String(key.split(separator: "/").last ?? Substring(key))
            return ["loosepopcorn": "popcorn", "necklace": "popcorn", "opensuitcase": "suitcase",
                    "recordsleeves": "record", "recordplayer": "record", "icecreambowl": "icecream",
                    "fruitface": "fruit", "trainseat": "train"][raw] ?? raw
        }
        return [identity(first), identity(second)].sorted().joined(separator: "|")
    }

    private static let authored: [VignetteSpec] = [
        .init(id: 1005, family: .tabletop, action: .countDivide,
              primaryAsset: "snacks/pretzel", secondaryAsset: "story/bowl", setPiece: "table",
              detailAssets: [], castCount: 1,
              summary: "A close-up shows several pretzels being counted into two portions beside a small bowl.",
              revealSummary: "The counted portions settle on the tabletop so the sharing ritual is visible."),
        .init(id: 1024, family: .tabletop, action: .arrangeSnacks,
              primaryAsset: "snacks/fruit", secondaryAsset: "snacks/cookie", setPiece: "table",
              detailAssets: ["snacks/bento"], castCount: 1,
              summary: "Fruit and cookies are arranged deliberately around a bento on a close tabletop.",
              revealSummary: "The snack arrangement finishes in a neat, visibly intentional pattern."),
        .init(id: 1018, family: .wearUse, action: .wearNecklace,
              primaryAsset: "story/necklace", secondaryAsset: "story/loosepopcorn", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "A totem wears an actual popcorn necklace while a few loose popcorn pieces wait nearby.",
              revealSummary: "The necklace rests on the totem rather than floating beside it."),
        .init(id: 1036, family: .wearUse, action: .napkinPlan,
              primaryAsset: "snacks/icecream", secondaryAsset: "story/napkin", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "A totem holds an ice-cream cone with a napkin wrapped around its base.",
              revealSummary: "The napkin catches the cone area as the character holds its snack securely."),
        .init(id: 1002, family: .peek, action: .saveCookie,
              primaryAsset: "snacks/cookie", secondaryAsset: "snacks/popcorn", setPiece: "box",
              detailAssets: [], castCount: 1,
              summary: "A cookie is tucked behind the popcorn tub, with just its chocolate edge peeking out.",
              revealSummary: "The saved cookie becomes visible again after the foreground popcorn clears."),
        .init(id: 1026, family: .peek, action: .fruitBottom,
              primaryAsset: "snacks/fruit", secondaryAsset: "story/bowl", setPiece: "table",
              detailAssets: [], castCount: 1,
              summary: "Fruit peeks from the bottom of an open bowl behind its front rim.",
              revealSummary: "The bowl reveals the fruit that was deliberately saved at the bottom."),
        .init(id: 1001, family: .share, action: .tradeSnack,
              primaryAsset: "snacks/cookie", secondaryAsset: "snacks/popcorn", setPiece: "table",
              detailAssets: [], castCount: 2,
              summary: "Two totems face each other across a table, offering a cookie and a popcorn bowl in exchange.",
              revealSummary: "The cookie and popcorn cross the shared table toward their recipients."),
        .init(id: 1019, family: .share, action: .offerBite,
              primaryAsset: "snacks/icecream", secondaryAsset: "story/napkin", setPiece: "bench",
              detailAssets: [], castCount: 2,
              summary: "One totem offers an ice-cream cone toward a second totem with a napkin ready.",
              revealSummary: "The offered cone reaches the space between the two friends."),
        .init(id: 1008, family: .journey, action: .snackDetour,
              primaryAsset: "snacks/fruit", secondaryAsset: "snacks/pretzel", setPiece: "path",
              detailAssets: ["travel/map"], castCount: 1,
              summary: "A totem carries fruit along a path and encounters a pretzel at the next stop.",
              revealSummary: "The character reaches the pretzel while still carrying the original fruit."),
        .init(id: 1031, family: .journey, action: .parkWalk,
              primaryAsset: "snacks/bento", secondaryAsset: "outdoors/tree", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "A totem carries a full bento toward a tree at the end of a short park path.",
              revealSummary: "The bento arrives at the park with the character rather than floating as a topic icon."),
        .init(id: 1009, family: .build, action: .bridgeBowl,
              primaryAsset: "snacks/cookie", secondaryAsset: "story/icecreambowl", setPiece: "table",
              detailAssets: [], castCount: 1,
              summary: "Cookie pieces form a small bridge over an actual open bowl of ice cream.",
              revealSummary: "The cookie bridge spans the bowl, making the statement's construction visible."),
        .init(id: 1033, family: .build, action: .fruitFace,
              primaryAsset: "story/fruitface", secondaryAsset: "story/bowl", setPiece: "table",
              detailAssets: ["snacks/fruit"], castCount: 2,
              summary: "A totem assembles fruit into a smiling face on the serving area before offering it to a guest.",
              revealSummary: "The completed fruit face turns toward the waiting guest."),
        .init(id: 1111, family: .tabletop, action: .petPhoto,
              primaryAsset: "pets/dog", secondaryAsset: "hobbies/camera", setPiece: "table",
              detailAssets: [], castCount: 1,
              summary: "A close camera view frames a dog turned slightly away from the would-be posed photo.",
              revealSummary: "The dog keeps its uncooperative pose while the camera remains pointed at it."),
        .init(id: 1142, family: .tabletop, action: .fishSketch,
              primaryAsset: "pets/fish", secondaryAsset: "hobbies/sketchbook", setPiece: "table",
              detailAssets: ["making/pencil"], castCount: 1,
              summary: "A fish and sketchbook sit together while a pencil is held toward the page.",
              revealSummary: "The character finishes another small sketch while keeping the fish in view."),
        .init(id: 1137, family: .wearUse, action: .raincoatWalk,
              primaryAsset: "story/raincoat", secondaryAsset: "pets/dog", setPiece: "path",
              detailAssets: ["weather/rainboot"], castCount: 1,
              summary: "A totem wears a cheerful oversized raincoat beside a dog ready for a walk.",
              revealSummary: "The raincoat moves with the character as the dog joins the walk."),
        .init(id: 1120, family: .wearUse, action: .carryToy,
              primaryAsset: "story/ball", secondaryAsset: "pets/dog", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "A totem carries a conspicuously large pet ball beside a tired dog.",
              revealSummary: "The toy stays in the totem's grasp while the dog rests nearby."),
        .init(id: 1108, family: .peek, action: .catBox,
              primaryAsset: "pets/cat", secondaryAsset: "story/cushion", setPiece: "box",
              detailAssets: [], castCount: 1,
              summary: "A cat sits visibly inside an open cardboard box, with a cushion behind its front rim.",
              revealSummary: "The foreground box edge reveals the cat occupying the empty space."),
        .init(id: 1121, family: .peek, action: .catOnBook,
              primaryAsset: "pets/cat", secondaryAsset: "books/novel", setPiece: "table",
              detailAssets: [], castCount: 1,
              summary: "A cat sits directly on the open-book area the totem is trying to use.",
              revealSummary: "The cat stays planted on the book as the totem peers around it."),
        .init(id: 1115, family: .share, action: .catLap,
              primaryAsset: "pets/cat", secondaryAsset: "story/cushion", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "A seated totem shares its cushion with a cat settled in its lap area.",
              revealSummary: "The cat remains close on the cushion while the totem reacts warmly."),
        .init(id: 1126, family: .share, action: .catConversation,
              primaryAsset: "pets/cat", secondaryAsset: "social/conversation", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "A totem faces a cat at conversational distance, with the reusable dialogue bubbles between them.",
              revealSummary: "The totem finishes explaining while the cat remains an attentive, ambiguous listener."),
        .init(id: 1107, family: .journey, action: .dogWalk,
              primaryAsset: "pets/dog", secondaryAsset: "outdoors/tree", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "A curious dog leads a totem toward a tree along a scenic curved path.",
              revealSummary: "The dog pauses at the interesting tree while the totem catches up."),
        .init(id: 1143, family: .journey, action: .dogChoice,
              primaryAsset: "pets/dog", secondaryAsset: "travel/map", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "A dog stands at two safe route directions while the totem holds a folded map nearby.",
              revealSummary: "The dog moves toward one route while the totem follows its choice."),
        .init(id: 1122, family: .build, action: .rabbitPalace,
              primaryAsset: "pets/rabbit", secondaryAsset: "making/cardboard", setPiece: "box",
              detailAssets: [], castCount: 1,
              summary: "Cardboard box pieces surround a rabbit like a small handmade palace.",
              revealSummary: "The last cardboard section settles around the rabbit's new home."),
        .init(id: 1133, family: .build, action: .rabbitCourse,
              primaryAsset: "pets/rabbit", secondaryAsset: "story/cushion", setPiece: "path",
              detailAssets: ["making/cardboard"], castCount: 1,
              summary: "A rabbit faces a low course made from a cushion and cardboard pieces.",
              revealSummary: "The rabbit reaches the next soft obstacle in the homemade course."),
        .init(id: 1369, family: .tabletop, action: .sortRecords,
              primaryAsset: "story/recordsleeves", secondaryAsset: "music/piano", setPiece: "recordrack",
              detailAssets: ["story/recordplayer"], castCount: 1,
              summary: "Record sleeves are sorted across a low rack beside a piano and record player.",
              revealSummary: "The sleeves finish in deliberate groups instead of a random floating stack."),
        .init(id: 1379, family: .tabletop, action: .tuneGuitar,
              primaryAsset: "music/guitar", secondaryAsset: "music/drum", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "A totem leans closely toward the guitar's tuning end while the drum waits untouched.",
              revealSummary: "The guitar is held steady as the careful adjustment finishes."),
        .init(id: 1351, family: .wearUse, action: .wearHeadphones,
              primaryAsset: "story/headphones", secondaryAsset: "music/record", setPiece: "recordrack",
              detailAssets: ["story/recordplayer"], castCount: 1,
              summary: "Headphones are attached over the totem's head while it considers the next record.",
              revealSummary: "The headphones remain worn as the selected record comes forward."),
        .init(id: 1368, family: .wearUse, action: .quietGuitar,
              primaryAsset: "story/headphones", secondaryAsset: "music/guitar", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "A totem wears headphones while holding its guitar close for a quiet private performance.",
              revealSummary: "The held guitar and worn headphones move with the character as one pose."),
        .init(id: 1371, family: .peek, action: .hiddenHeadphones,
              primaryAsset: "music/headphones", secondaryAsset: "music/piano", setPiece: "curtain",
              detailAssets: [], castCount: 1,
              summary: "Headphones are partly concealed behind the piano rather than displayed beside it.",
              revealSummary: "The hidden headphones peek out from the piano's far side."),
        .init(id: 1381, family: .peek, action: .guitarHide,
              primaryAsset: "music/guitar", secondaryAsset: "music/microphone", setPiece: "curtain",
              detailAssets: [], castCount: 2,
              summary: "One totem hides behind a guitar while its friend holds the microphone in front.",
              revealSummary: "The hidden totem peeks around the guitar toward the friend with the microphone."),
        .init(id: 1372, family: .share, action: .shareMic,
              primaryAsset: "music/microphone", secondaryAsset: "music/headphones", setPiece: "bench",
              detailAssets: [], castCount: 2,
              summary: "Two totems lean toward one shared microphone with the headphones set aside.",
              revealSummary: "The microphone remains between the two performers as they share the moment."),
        .init(id: 1396, family: .share, action: .lendHeadphones,
              primaryAsset: "story/headphones", secondaryAsset: "music/guitar", setPiece: "bench",
              detailAssets: [], castCount: 2,
              summary: "A totem passes its headphones toward a friend beside the guitar they are listening to.",
              revealSummary: "The headphones reach the friend rather than remaining a disconnected prop."),
        .init(id: 1365, family: .journey, action: .picnicBand,
              primaryAsset: "music/guitar", secondaryAsset: "music/drum", setPiece: "path",
              detailAssets: ["tinyadventures/picnic"], castCount: 2,
              summary: "Two totems carry guitar and drum toward a small picnic stop together.",
              revealSummary: "Both instruments arrive with their players at the picnic."),
        .init(id: 1377, family: .journey, action: .streetDrummer,
              primaryAsset: "story/headphones", secondaryAsset: "music/drum", setPiece: "path",
              detailAssets: [], castCount: 2,
              summary: "A travelling totem with headphones pauses beside a second totem playing a drum.",
              revealSummary: "The listener stops moving to attend to the drummer."),
        .init(id: 1383, family: .build, action: .pretendStage,
              primaryAsset: "music/microphone", secondaryAsset: "story/pianobench", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "The piano bench becomes a small pretend stage with a microphone held above it.",
              revealSummary: "The performer settles onto the improvised bench stage."),
        .init(id: 1400, family: .build, action: .radioStack,
              primaryAsset: "story/recordsleeves", secondaryAsset: "music/microphone", setPiece: "recordrack",
              detailAssets: [], castCount: 1,
              summary: "Record sleeves are stacked next to a microphone like a tiny radio desk.",
              revealSummary: "The final sleeve completes the pretend radio-show setup."),
        .init(id: 1204, family: .tabletop, action: .unfoldMap,
              primaryAsset: "travel/map", secondaryAsset: "travel/camera", setPiece: "table",
              detailAssets: [], castCount: 1,
              summary: "A paper map opens across the tabletop in front of a nearby camera.",
              revealSummary: "The map spreads fully even though the route was already familiar."),
        .init(id: 1231, family: .tabletop, action: .planMap,
              primaryAsset: "travel/map", secondaryAsset: "outdoors/compass", setPiece: "table",
              detailAssets: [], castCount: 2,
              summary: "Two totems gather around a paper map placed at the centre of their planning table.",
              revealSummary: "The map stays central as both friends indicate the shared adventure."),
        .init(id: 1205, family: .wearUse, action: .giantHat,
              primaryAsset: "travel/sunhat", secondaryAsset: "travel/suitcase", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "An enormous sunhat sits on the totem's head beside its travel case.",
              revealSummary: "The hat remains proudly worn as the character sets off."),
        .init(id: 1217, family: .wearUse, action: .rollingCase,
              primaryAsset: "travel/suitcase", secondaryAsset: "travel/sunhat", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "A totem grips a suitcase handle while its wheels track a short path.",
              revealSummary: "The suitcase follows the character on its wheels rather than floating in place."),
        .init(id: 1207, family: .peek, action: .suitcaseSpace,
              primaryAsset: "story/opensuitcase", secondaryAsset: "travel/sunhat", setPiece: "bench",
              detailAssets: [], castCount: 1,
              summary: "An open suitcase keeps a visibly empty area while a sunhat waits outside it.",
              revealSummary: "The open case reveals the space reserved for an unknown discovery."),
        .init(id: 1234, family: .peek, action: .surprisePack,
              primaryAsset: "story/opensuitcase", secondaryAsset: "celebrations/gift", setPiece: "bench",
              detailAssets: [], castCount: 2,
              summary: "A friend lowers a wrapped surprise toward an open suitcase while its owner looks aside.",
              revealSummary: "The gift becomes visible inside the suitcase after the foreground opening clears."),
        .init(id: 1219, family: .share, action: .trainFriends,
              primaryAsset: "story/trainseat", secondaryAsset: "travel/train", setPiece: "window",
              detailAssets: [], castCount: 2,
              summary: "Two totems sit together by a train window, one facing the opposite direction.",
              revealSummary: "The friends remain side by side while the journey continues beyond the window."),
        .init(id: 1239, family: .share, action: .lendHat,
              primaryAsset: "travel/sunhat", secondaryAsset: "travel/camera", setPiece: "path",
              detailAssets: [], castCount: 2,
              summary: "One totem lifts its sunhat toward the other while a camera waits nearby.",
              revealSummary: "The sunhat reaches the friend for the next travel photo."),
        .init(id: 1208, family: .journey, action: .trainWindow,
              primaryAsset: "travel/train", secondaryAsset: "travel/map", setPiece: "window",
              detailAssets: ["story/trainseat", "story/ticket"], castCount: 1,
              summary: "A seated totem looks through a foreground train window with its map set aside.",
              revealSummary: "The window view shifts gently while the character keeps looking outside."),
        .init(id: 1210, family: .journey, action: .mapDetour,
              primaryAsset: "travel/map", secondaryAsset: "home/plant", setPiece: "path",
              detailAssets: [], castCount: 1,
              summary: "A totem carrying a map turns toward a small inviting side route marked by a plant.",
              revealSummary: "The character reaches the interesting detour instead of following a straight main route."),
        .init(id: 1250, family: .build, action: .postcardWall,
              primaryAsset: "travel/postcard", secondaryAsset: "hobbies/sketchbook", setPiece: "recordrack",
              detailAssets: [], castCount: 1,
              summary: "Postcards are arranged vertically into a small wall display beside an unfinished album.",
              revealSummary: "The last postcard completes the display while the album waits."),
        .init(id: 1201, family: .build, action: .packingPuzzle,
              primaryAsset: "story/opensuitcase", secondaryAsset: "travel/sunhat", setPiece: "table",
              detailAssets: ["hobbies/camera", "mornings/slippers"], castCount: 1,
              summary: "A sunhat, camera and slippers fit into the open suitcase like a packing puzzle.",
              revealSummary: "The final object settles into the remaining gap in the case.")
    ]
}
