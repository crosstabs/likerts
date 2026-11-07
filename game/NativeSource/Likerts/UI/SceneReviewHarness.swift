#if DEBUG
import SwiftUI

enum SceneReviewBaseline {
    // Captured before this completion pass from the locally verified Resume archive.
    static let ids: Set<Int> = [
        // books
        1454, 1457, 1458, 1462, 1467, 1468, 1474, 1476, 1480, 1481, 1483, 1485, 1486, 1487, 1490, 1494, 1495, 1496, 1497, 1498,
        // celebrations
        1654, 1657, 1666, 1668, 1682, 1684, 1693, 1698,
        // fantasy
        1905, 1907, 1908, 1913,
        // future
        1953, 1956, 1966, 1967, 1969, 1976, 1981, 1996,
        // games
        1557, 1561, 1562, 1566, 1569, 1583, 1587,
        // hobbies
        1302, 1304, 1306, 1308, 1312, 1313, 1315, 1318, 1319, 1320, 1322, 1323, 1325, 1326, 1327, 1329, 1330, 1331, 1332, 1333, 1334, 1336, 1338, 1340, 1342, 1344, 1346, 1347, 1348, 1349,
        // home
        1256, 1263, 1264, 1265, 1266, 1267, 1270, 1282, 1283, 1284, 1285, 1286, 1289, 1290, 1291, 1294, 1295,
        // kitchen
        1055, 1059, 1065, 1067, 1072, 1074, 1075, 1078,
        // making
        1801, 1808, 1813, 1814, 1816, 1817, 1820, 1829, 1831, 1834, 1835, 1841, 1844, 1850,
        // mornings
        1753, 1758, 1766, 1768, 1775, 1783,
        // movies
        1414, 1417, 1421, 1424, 1430, 1431, 1432, 1433, 1436, 1438, 1443, 1445, 1447, 1449,
        // music
        1355, 1358, 1359, 1363, 1366, 1367, 1370, 1373, 1374, 1375, 1376, 1380, 1385, 1387, 1388, 1389, 1392, 1393, 1394, 1398,
        // outdoors
        1152, 1158, 1163, 1165, 1170, 1173, 1180, 1183, 1186, 1195, 1197,
        // pets
        1116, 1119, 1123, 1128, 1131, 1135, 1136, 1138, 1140, 1141,
        // snacks
        1004, 1021, 1022, 1023, 1030, 1038, 1041, 1042, 1043,
        // social
        1540,
        // style
        1604, 1606, 1609, 1619, 1623, 1625, 1633, 1634, 1641, 1645, 1648,
        // tinyadventures
        1885, 1891, 1895,
        // travel
        1215, 1218, 1220, 1221, 1226, 1238, 1242, 1247, 1248,
        // weather
        1704, 1709, 1714, 1725, 1732, 1733, 1737, 1750,
    ]
}

/// Simulator-only visual review of the actual bundled scene renderer. This is
/// evidence collection, not a claim that any scene has passed editorial review.
@MainActor struct SceneReviewHarness: View {
    private let topic: TopicID?
    private let reviewAll: Bool
    private let useBaseline: Bool
    private let explicitIDs: Set<Int>?
    private let reveal: Bool
    @State private var page = 0
    private let pageSize = 4

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        func argument(after flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }
        topic = argument(after: "-scene-review-topic").flatMap(TopicID.init(rawValue:))
        reviewAll = arguments.contains("-scene-review-all")
        useBaseline = arguments.contains("-scene-review-baseline")
        explicitIDs = argument(after: "-scene-review-ids").map { value in
            Set(value.split(separator: ",").compactMap { Int($0) })
        }
        reveal = argument(after: "-scene-review-phase") == "reveal"
    }
    private var rounds: [TopicRound] {
        guard let topic, let catalog = TopicPlayLibrary.catalog else { return [] }
        return catalog.rounds(for: topic).filter { round in
            if let explicitIDs { return explicitIDs.contains(round.id) }
            if reviewAll { return true }
            if useBaseline { return SceneReviewBaseline.ids.contains(round.id) }
            return MotionProductionLibrary.performance(id: round.id)?.review.coverage == .staticFallback
        }.sorted { $0.id < $1.id }
    }
    private var pages: Int { max(1, (rounds.count + pageSize - 1) / pageSize) }
    private var current: [TopicRound] {
        let start = min(page * pageSize, rounds.count)
        return Array(rounds.dropFirst(start).prefix(pageSize))
    }
    private var pageLabel: String {
        let ids = current.map { String($0.id) }.joined(separator: ",")
        return "\(topic?.rawValue ?? "unknown") \(reveal ? "reveal" : "question") page \(page + 1) of \(pages); ids \(ids)"
    }
    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 10) {
                Button("Previous") { page = max(0, page - 1) }
                    .disabled(page == 0).accessibilityIdentifier("review.previous")
                Spacer(minLength: 0)
                Text(pageLabel).font(.system(size: 10, weight: .semibold))
                    .lineLimit(2).accessibilityIdentifier("review.page")
                Spacer(minLength: 0)
                Button("Next") { page = min(pages - 1, page + 1) }
                    .disabled(page + 1 >= pages).accessibilityIdentifier("review.next")
            }.font(.system(size: 13, weight: .semibold)).padding(.horizontal, 8)
            if current.isEmpty {
                Text("No matching scenes in this topic.").accessibilityIdentifier("review.empty")
            } else {
                let columns = [GridItem(.flexible(), spacing: 5), GridItem(.flexible(), spacing: 5)]
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(current, id: \.id) { round in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("#\(round.id)").font(.system(size: 12, weight: .bold))
                            StorySceneView(round: round,
                                resolution: reveal ? StoryResolution(guess: 4, answer: 4) : nil,
                                choice: reveal ? 4 : nil, compact: true)
                                .environment(\.likertsReducedEffectsTest, true)
                                .accessibilityHidden(true)
                            Text(round.text).font(.system(size: 10.5, weight: .medium))
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("review.question.\(round.id)")
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: 275, maxHeight: 275, alignment: .topLeading)
                        .padding(4).background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                    }
                }.padding(.horizontal, 5)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(red: 0.96, green: 0.95, blue: 0.92))
        .foregroundStyle(.black)
        .statusBarHidden(true)
        .accessibilityIdentifier("review.loaded")
    }
}
#endif
