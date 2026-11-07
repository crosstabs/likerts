import CoreGraphics

/// Measured bounds on original unmodified Image Gen atlases.
/// Some rectangular bounds include disconnected neighboring sprite pixels;
/// native presentation must isolate the alpha component at componentSeeds.
enum StoryCastBounds {
    static let isolationAlphaThreshold: UInt8 = 8
    static let hold: [Int: CGRect] = [
        1: CGRect(x: 52, y: 286, width: 382, height: 393),
        2: CGRect(x: 448, y: 273, width: 385, height: 407),
        3: CGRect(x: 817, y: 168, width: 387, height: 517),
        4: CGRect(x: 1209, y: 138, width: 309, height: 545),
        5: CGRect(x: 1540, y: 296, width: 400, height: 388)
    ]
    static let peek: [Int: CGRect] = [
        1: CGRect(x: 40, y: 286, width: 400, height: 395),
        2: CGRect(x: 448, y: 274, width: 384, height: 407),
        3: CGRect(x: 819, y: 168, width: 392, height: 513),
        4: CGRect(x: 1211, y: 142, width: 345, height: 541),
        5: CGRect(x: 1548, y: 306, width: 411, height: 381)
    ]
    static let celebrate: [Int: CGRect] = [
        1: CGRect(x: 40, y: 263, width: 399, height: 417),
        2: CGRect(x: 428, y: 267, width: 427, height: 409),
        3: CGRect(x: 807, y: 172, width: 389, height: 510),
        4: CGRect(x: 1210, y: 144, width: 361, height: 537),
        5: CGRect(x: 1548, y: 292, width: 401, height: 390)
    ]
    /// Seeds are GLOBAL source-pixel coordinates, not relative to crops.
    static let componentSeeds: [String: CGPoint] = [
        "hold/1": CGPoint(x: 413, y: 552),
        "hold/2": CGPoint(x: 483, y: 449),
        "hold/3": CGPoint(x: 921, y: 526),
        "hold/4": CGPoint(x: 1296, y: 457),
        "hold/5": CGPoint(x: 1736, y: 535),
        "peek/1": CGPoint(x: 222, y: 660),
        "peek/2": CGPoint(x: 485, y: 442),
        "peek/3": CGPoint(x: 921, y: 454),
        "peek/4": CGPoint(x: 1287, y: 486),
        "peek/5": CGPoint(x: 1789, y: 571),
        "celebrate/1": CGPoint(x: 428, y: 517),
        "celebrate/2": CGPoint(x: 625, y: 636),
        "celebrate/3": CGPoint(x: 1158, y: 257),
        "celebrate/4": CGPoint(x: 1499, y: 352),
        "celebrate/5": CGPoint(x: 1773, y: 536)
    ]
}


/// Approximate contact anchors in normalized cropped-source coordinates.
/// Convert through the sprite's actual scaledToFit rectangle, not its view frame.
struct StoryCastContactAnchors {
    let mouth: CGRect
    let face: CGRect
    /// Crown edge above face center, not necessarily the highest asymmetric tip.
    let headTop: CGPoint
    let handCenter: CGPoint
    let leftHand: CGPoint
    let rightHand: CGPoint
    var mouthCenter: CGPoint { CGPoint(x: mouth.midX, y: mouth.midY) }
}

enum StoryCastAnchors {
    static func anchor(pose: StoryPose = .hold, value: Int) -> StoryCastContactAnchors {
        profiles["\(pose.rawValue)/\(min(5, max(1, value)))"] ?? fallback
    }
    private static let fallback = StoryCastContactAnchors(mouth: CGRect(x: 0.4860, y: 0.5450, width: 0.1520, height: 0.0570), face: CGRect(x: 0.3890, y: 0.3990, width: 0.3750, height: 0.2130), headTop: CGPoint(x: 0.5762, y: 0.2785), handCenter: CGPoint(x: 0.58, y: 0.745), leftHand: CGPoint(x: 0.43, y: 0.76), rightHand: CGPoint(x: 0.73, y: 0.73))
    private static let profiles: [String: StoryCastContactAnchors] = [
        "hold/1": StoryCastContactAnchors(mouth: CGRect(x: 0.4136, y: 0.6081, width: 0.1518, height: 0.0662), face: CGRect(x: 0.3239, y: 0.4180, width: 0.3810, height: 0.2663), headTop: CGPoint(x: 0.5144, y: 0.0967), handCenter: CGPoint(x: 0.5000, y: 0.7750), leftHand: CGPoint(x: 0.3000, y: 0.7700), rightHand: CGPoint(x: 0.7000, y: 0.7800)),
        "hold/2": StoryCastContactAnchors(mouth: CGRect(x: 0.4623, y: 0.5627, width: 0.1455, height: 0.0639), face: CGRect(x: 0.3522, y: 0.3728, width: 0.3813, height: 0.2638), headTop: CGPoint(x: 0.5429, y: 0.0074), handCenter: CGPoint(x: 0.5450, y: 0.7450), leftHand: CGPoint(x: 0.3900, y: 0.7700), rightHand: CGPoint(x: 0.7000, y: 0.7200)),
        "hold/3": StoryCastContactAnchors(mouth: CGRect(x: 0.4858, y: 0.5455, width: 0.1525, height: 0.0561), face: CGRect(x: 0.3889, y: 0.3991, width: 0.3746, height: 0.2125), headTop: CGPoint(x: 0.5762, y: 0.2785), handCenter: CGPoint(x: 0.5800, y: 0.7450), leftHand: CGPoint(x: 0.4300, y: 0.7600), rightHand: CGPoint(x: 0.7300, y: 0.7300)),
        "hold/4": StoryCastContactAnchors(mouth: CGRect(x: 0.5210, y: 0.4349, width: 0.1845, height: 0.0550), face: CGRect(x: 0.4131, y: 0.2921, width: 0.4166, height: 0.2078), headTop: CGPoint(x: 0.6214, y: 0.0587), handCenter: CGPoint(x: 0.6150, y: 0.7400), leftHand: CGPoint(x: 0.4400, y: 0.7600), rightHand: CGPoint(x: 0.7900, y: 0.7200)),
        "hold/5": StoryCastContactAnchors(mouth: CGRect(x: 0.4825, y: 0.4149, width: 0.1525, height: 0.0722), face: CGRect(x: 0.4175, y: 0.2306, width: 0.3400, height: 0.2665), headTop: CGPoint(x: 0.5875, y: 0.0155), handCenter: CGPoint(x: 0.5450, y: 0.6400), leftHand: CGPoint(x: 0.3000, y: 0.6400), rightHand: CGPoint(x: 0.7900, y: 0.6400)),
        "peek/1": StoryCastContactAnchors(mouth: CGRect(x: 0.5475, y: 0.5544, width: 0.1400, height: 0.0759), face: CGRect(x: 0.4625, y: 0.3676, width: 0.3400, height: 0.2728), headTop: CGPoint(x: 0.6325, y: 0.0127), handCenter: CGPoint(x: 0.6750, y: 0.6850), leftHand: CGPoint(x: 0.4400, y: 0.7400), rightHand: CGPoint(x: 0.9100, y: 0.6300)),
        "peek/2": StoryCastContactAnchors(mouth: CGRect(x: 0.5339, y: 0.5209, width: 0.1354, height: 0.0762), face: CGRect(x: 0.4314, y: 0.3261, width: 0.3508, height: 0.2810), headTop: CGPoint(x: 0.6068, y: 0.0197), handCenter: CGPoint(x: 0.6650, y: 0.7050), leftHand: CGPoint(x: 0.4400, y: 0.7700), rightHand: CGPoint(x: 0.8900, y: 0.6400)),
        "peek/3": StoryCastContactAnchors(mouth: CGRect(x: 0.5204, y: 0.5380, width: 0.1403, height: 0.0565), face: CGRect(x: 0.4370, y: 0.3888, width: 0.3504, height: 0.2157), headTop: CGPoint(x: 0.6122, y: 0.2515), handCenter: CGPoint(x: 0.6650, y: 0.7100), leftHand: CGPoint(x: 0.4500, y: 0.7700), rightHand: CGPoint(x: 0.8800, y: 0.6500)),
        "peek/4": StoryCastContactAnchors(mouth: CGRect(x: 0.5101, y: 0.4177, width: 0.1623, height: 0.0536), face: CGRect(x: 0.4122, y: 0.2779, width: 0.3757, height: 0.2034), headTop: CGPoint(x: 0.6000, y: 0.0832), handCenter: CGPoint(x: 0.6750, y: 0.6800), leftHand: CGPoint(x: 0.4600, y: 0.7500), rightHand: CGPoint(x: 0.8900, y: 0.6100)),
        "peek/5": StoryCastContactAnchors(mouth: CGRect(x: 0.5304, y: 0.3858, width: 0.1387, height: 0.0761), face: CGRect(x: 0.4588, y: 0.1936, width: 0.3233, height: 0.2783), headTop: CGPoint(x: 0.6204, y: 0.0367), handCenter: CGPoint(x: 0.6100, y: 0.6150), leftHand: CGPoint(x: 0.3200, y: 0.6600), rightHand: CGPoint(x: 0.9000, y: 0.5700)),
        "celebrate/1": StoryCastContactAnchors(mouth: CGRect(x: 0.4336, y: 0.5468, width: 0.1679, height: 0.1367), face: CGRect(x: 0.3811, y: 0.3629, width: 0.3657, height: 0.3306), headTop: CGPoint(x: 0.5639, y: 0.0600), handCenter: CGPoint(x: 0.5050, y: 0.5000), leftHand: CGPoint(x: 0.0900, y: 0.4000), rightHand: CGPoint(x: 0.9200, y: 0.6000)),
        "celebrate/2": StoryCastContactAnchors(mouth: CGRect(x: 0.4590, y: 0.5110, width: 0.1475, height: 0.1296), face: CGRect(x: 0.3511, y: 0.3365, width: 0.3353, height: 0.3141), headTop: CGPoint(x: 0.5187, y: 0.0147), handCenter: CGPoint(x: 0.5210, y: 0.5095), leftHand: CGPoint(x: 0.1150, y: 0.4230), rightHand: CGPoint(x: 0.9270, y: 0.5960)),
        "celebrate/3": StoryCastContactAnchors(mouth: CGRect(x: 0.5167, y: 0.4882, width: 0.1671, height: 0.1157), face: CGRect(x: 0.4099, y: 0.3345, width: 0.3679, height: 0.2794), headTop: CGPoint(x: 0.5938, y: 0.2490), handCenter: CGPoint(x: 0.5745, y: 0.6010), leftHand: CGPoint(x: 0.2520, y: 0.5980), rightHand: CGPoint(x: 0.8970, y: 0.6040)),
        "celebrate/4": StoryCastContactAnchors(mouth: CGRect(x: 0.4515, y: 0.3836, width: 0.1773, height: 0.1099), face: CGRect(x: 0.3340, y: 0.2449, width: 0.3653, height: 0.2586), headTop: CGPoint(x: 0.5166, y: 0.0503), handCenter: CGPoint(x: 0.5275, y: 0.4765), leftHand: CGPoint(x: 0.1660, y: 0.5080), rightHand: CGPoint(x: 0.8890, y: 0.4450)),
        "celebrate/5": StoryCastContactAnchors(mouth: CGRect(x: 0.5087, y: 0.3487, width: 0.1571, height: 0.1359), face: CGRect(x: 0.4039, y: 0.1651, width: 0.3394, height: 0.3295), headTop: CGPoint(x: 0.5736, y: 0.0205), handCenter: CGPoint(x: 0.4975, y: 0.4085), leftHand: CGPoint(x: 0.1070, y: 0.4840), rightHand: CGPoint(x: 0.8880, y: 0.3330))
    ]
}
