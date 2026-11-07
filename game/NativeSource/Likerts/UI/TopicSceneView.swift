import SwiftUI
import UIKit

/// The five atlas files are original Image Gen artwork. Cells are cropped from
/// unchanged source PNGs at runtime; no network or per-round image generation.
@MainActor enum TopicArt {
    private static let cells = NSCache<NSString, UIImage>()
    private static var atlases: [String: UIImage] = [:]
    private static func cell(atlas: String, column: Int, row: Int, columns: Int, rows: Int, bounds: CGRect?) -> UIImage? {
        cells.totalCostLimit = 18 * 1_024 * 1_024
        let key = "\(atlas)-\(column)-\(row)" as NSString
        if let image = cells.object(forKey: key) { return image }
        let source: UIImage
        if let loaded = atlases[atlas] { source = loaded }
        else {
            guard let loaded = UIImage(named: atlas) else { return nil }
            atlases[atlas] = loaded; source = loaded
        }
        guard let cg = source.cgImage else { return nil }
        let width = CGFloat(cg.width) / CGFloat(columns), height = CGFloat(cg.height) / CGFloat(rows)
        let rect = (bounds ?? CGRect(x: CGFloat(column) * width, y: CGFloat(row) * height, width: width, height: height)).integral
        guard let crop = cg.cropping(to: rect) else { return nil }
        let image = UIImage(cgImage: crop)
        cells.setObject(image, forKey: key, cost: crop.bytesPerRow * crop.height)
        return image
    }
    static func prop(_ key: String, topic: TopicID) -> UIImage? {
        guard let column = topic.definition.props.firstIndex(of: key), let ordinal = TopicID.allCases.firstIndex(of: topic) else { return nil }
        let atlas = ["TopicPropsA", "TopicPropsB", "TopicPropsC", "TopicPropsD"][ordinal / 5]
        return cell(atlas: atlas, column: column, row: ordinal % 5, columns: 6, rows: 5, bounds: TopicSpriteBounds.props["\(topic.rawValue)/\(key)"])
    }
    static func backdrop(_ topic: TopicID) -> UIImage? {
        guard let ordinal = TopicID.allCases.firstIndex(of: topic) else { return nil }
        return cell(atlas: "TopicBackdrops", column: ordinal % 5, row: ordinal / 5, columns: 5, rows: 4, bounds: TopicSpriteBounds.backdrops[topic.rawValue])
    }
}

/// A recipe describes an object relationship, not a palette variation. All
/// geometry is native and recomposes the same canonical cast and prop library.
struct TopicSceneView: View {
    let round: TopicRound
    var compact = false
    var canonicalCast = false
    private struct Pose {
        let x: CGFloat, y: CGFloat, size: CGFloat, angle: Double
    }
    private var arrangement: [Pose] {
        switch round.scene.relation.rawValue {
        case "inspect": return [Pose(x: 0.25,y: 0.62,size: 0.38,angle: 10), Pose(x: 0.67,y: 0.58,size: 0.48,angle: -8), Pose(x: 0.78,y: 0.81,size: 0.23,angle: 12)]
        case "offer": return [Pose(x: 0.23,y: 0.66,size: 0.38,angle: 9), Pose(x: 0.47,y: 0.44,size: 0.35,angle: -13), Pose(x: 0.78,y: 0.65,size: 0.43,angle: 0)]
        case "balance": return [Pose(x: 0.50,y: 0.70,size: 0.36,angle: -6), Pose(x: 0.46,y: 0.23,size: 0.34,angle: -14), Pose(x: 0.75,y: 0.74,size: 0.33,angle: 11)]
        case "stack": return [Pose(x: 0.22,y: 0.70,size: 0.33,angle: 9), Pose(x: 0.63,y: 0.24,size: 0.33,angle: 5), Pose(x: 0.63,y: 0.72,size: 0.48,angle: 0)]
        case "hide": return [Pose(x: 0.57,y: 0.57,size: 0.29,angle: -14), Pose(x: 0.52,y: 0.73,size: 0.58,angle: 0), Pose(x: 0.81,y: 0.74,size: 0.28,angle: 8)]
        case "share": return [Pose(x: 0.20,y: 0.69,size: 0.32,angle: 10), Pose(x: 0.50,y: 0.61,size: 0.48,angle: 0), Pose(x: 0.79,y: 0.69,size: 0.33,angle: -10)]
        case "choose": return [Pose(x: 0.50,y: 0.60,size: 0.36,angle: 0), Pose(x: 0.19,y: 0.70,size: 0.38,angle: -8), Pose(x: 0.81,y: 0.70,size: 0.38,angle: 8)]
        case "carry": return [Pose(x: 0.40,y: 0.70,size: 0.37,angle: 7), Pose(x: 0.38,y: 0.24,size: 0.36,angle: -8), Pose(x: 0.72,y: 0.60,size: 0.37,angle: 14)]
        case "orbit": return [Pose(x: 0.50,y: 0.65,size: 0.35,angle: 0), Pose(x: 0.23,y: 0.31,size: 0.34,angle: -22), Pose(x: 0.79,y: 0.40,size: 0.34,angle: 20)]
        default: return [Pose(x: 0.19,y: 0.69,size: 0.34,angle: 8), Pose(x: 0.61,y: 0.63,size: 0.47,angle: -6), Pose(x: 0.70,y: 0.23,size: 0.32,angle: 12)]
        }
    }
    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width, height = geometry.size.height
            ZStack {
                if let image = TopicArt.backdrop(round.topic) {
                    Image(uiImage: image).resizable().scaledToFill().frame(width: width, height: height).clipped().opacity(0.9)
                }
                Ellipse().fill(TotemTone.ink.opacity(0.07)).frame(width: width * 0.76, height: 15).position(x: width / 2, y: height * 0.89)
                sculpture(pose: arrangement[0], width: width, height: height)
                if round.scene.relation.rawValue == "share" {
                    TotemRaster(name: "Totem\(canonicalCast ? 2 : (round.id % 4) + 2)").frame(width: height * 0.29, height: height * 0.51).position(x: width * 0.83, y: height * 0.55)
                }
                prop(round.scene.primary, pose: arrangement[1], width: width, height: height)
                prop(round.scene.secondary, pose: arrangement[2], width: width, height: height)
            }.clipShape(RoundedRectangle(cornerRadius: 26))
        }.frame(height: compact ? 125 : 164)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(round.topic.definition.title) illustration: \(propLabel(round.scene.primary)), \(propLabel(round.scene.secondary)).")
            .accessibilityIdentifier("round.topicScene.\(round.id)")
    }
    private func sculpture(pose: Pose, width: CGFloat, height: CGFloat) -> some View {
        TotemRaster(name: "Totem\(canonicalCast ? 3 : (round.id % 5) + 1)")
            .frame(width: height * pose.size * 1.18, height: height * pose.size * 1.70)
            .rotationEffect(.degrees(pose.angle)).position(x: width * pose.x, y: height * pose.y)
    }
    private func propLabel(_ key: String) -> String {
        ["icecream": "ice cream", "mixingbowl": "mixing bowl", "campmug": "camp mug", "sunhat": "sun hat", "paintbrush": "paintbrush", "sketchbook": "sketchbook", "clapperboard": "clapperboard", "filmreel": "film reel", "booklamp": "reading lamp", "bookstack": "stack of books", "chesspiece": "chess piece", "partyhat": "party hat", "rainboot": "rain boot", "conversation": "conversation bubbles" ][key] ?? key
    }
    @ViewBuilder private func prop(_ key: String, pose: Pose, width: CGFloat, height: CGFloat) -> some View {
        if let image = TopicArt.prop(key, topic: round.topic) {
            Image(uiImage: image).resizable().scaledToFit().frame(width: height * pose.size * 1.15, height: height * pose.size * 1.15)
                .rotationEffect(.degrees(pose.angle)).position(x: width * pose.x, y: height * pose.y)
        }
    }
}
