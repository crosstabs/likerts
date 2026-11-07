import SwiftUI
import UIKit

/// Native presentation crops from the original unchanged headphone PNG.
/// Splitting the band and cups lets each earcup sit outside a fitted face,
/// instead of shrinking the artwork's original narrow central opening over it.
@MainActor private enum StoryWearableParts {
    // Coordinates are relative to StoryArt's 317x288 headphone crop.
    static let bandRect = CGRect(x: 25, y: 0, width: 271, height: 112)
    static let leftCupRect = CGRect(x: 0, y: 105, width: 153, height: 183)
    static let rightCupRect = CGRect(x: 163, y: 112, width: 154, height: 176)
    private static var cached: [String: UIImage] = [:]

    static func image(_ name: String) -> UIImage? {
        if let image = cached[name] { return image }
        guard let source = StoryArt.image(ref: "story/headphones")?.cgImage else { return nil }
        let rect: CGRect
        switch name {
        case "band": rect = bandRect
        case "leftCup": rect = leftCupRect
        default: rect = rightCupRect
        }
        guard let part = source.cropping(to: rect) else { return nil }
        let image = UIImage(cgImage: part)
        cached[name] = image
        return image
    }
}

/// Add to a full-scene ZStack. `face` uses that scene's absolute point space.
/// Supplying `headTop` improves crown contact for asymmetric Y/arch silhouettes;
/// the one-argument face initializer remains sufficient for a safe clear face.
struct StoryHeadphones: View {
    let face: CGRect
    var headTop: CGPoint? = nil

    var body: some View {
        GeometryReader { geometry in
            let cupHeight = min(max(18, face.height * 1.28), geometry.size.height * 0.40)
            let leftRatio: CGFloat = 153.0 / 183.0
            let rightRatio: CGFloat = 154.0 / 176.0
            let leftWidth = cupHeight * leftRatio
            let rightWidth = cupHeight * rightRatio
            // Two points of contact at each outside edge, never a pad laid over
            // the eye/face center. Cup artwork keeps its native aspect ratio.
            let touch: CGFloat = min(2, face.width * 0.035)
            let leftX = face.minX - leftWidth / 2 + touch
            let rightX = face.maxX + rightWidth / 2 - touch
            let cupY = face.minY + face.height * 0.42
            let bandBottom = cupY - cupHeight * 0.36
            let crownY = headTop.map { $0.y - face.height * 0.10 }
                ?? (bandBottom - face.height * 0.95)
            let bandHeight = max(face.height * 0.38, bandBottom - max(1, crownY))
            let bandWidth = max(24, rightX - leftX + min(leftWidth, rightWidth) * 0.12)

            ZStack {
                if let image = StoryWearableParts.image("band") {
                    // Only the original band segment stretches to span the
                    // authored head. No generated pixels are redrawn/recolored.
                    Image(uiImage: image).resizable()
                        .frame(width: bandWidth, height: bandHeight)
                        .position(x: (leftX + rightX) / 2, y: bandBottom - bandHeight / 2)
                }
                if let image = StoryWearableParts.image("leftCup") {
                    Image(uiImage: image).resizable().scaledToFit()
                        .frame(width: leftWidth, height: cupHeight)
                        .position(x: leftX, y: cupY)
                }
                if let image = StoryWearableParts.image("rightCup") {
                    Image(uiImage: image).resizable().scaledToFit()
                        .frame(width: rightWidth, height: cupHeight)
                        .position(x: rightX, y: cupY)
                }
            }.frame(width: geometry.size.width, height: geometry.size.height)
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}

/// Whole head remains untouched between the coat back and its lower foreground.
/// The clipping boundary is below the measured face, so there is no rectangular
/// pasted face patch over opaque hood lining.
struct StoryRaincoat: View {
    let value: Int
    let pose: StoryPose
    let characterRect: CGRect
    let face: CGRect
    let canvas: CGSize

    private var coatRect: CGRect {
        let top = max(2, face.minY - face.height * 0.80)
        let bottom = min(canvas.height - 2, max(characterRect.maxY + 5, face.maxY + face.height * 1.25))
        let height = max(24, bottom - top)
        let image = StoryArt.image(ref: "story/raincoat")
        let ratio = (image?.size.width ?? 396) / (image?.size.height ?? 433)
        let width = min(canvas.width - 8, height * ratio)
        let centerX = min(canvas.width - 4 - width / 2, max(4 + width / 2, face.midX))
        return CGRect(x: centerX - width / 2, y: top, width: width, height: height)
    }

    var body: some View {
        let coat = coatRect
        let foregroundHeight = max(0, coat.maxY - (face.maxY + 3))
        ZStack(alignment: .topLeading) {
            coatLayer(coat)
            StoryCharacter(value: value, pose: pose)
                .frame(width: characterRect.width, height: characterRect.height)
                .position(x: characterRect.midX, y: characterRect.midY)
            coatLayer(coat)
                .mask(alignment: .topLeading) {
                    ZStack {
                        Rectangle().frame(width: canvas.width, height: foregroundHeight)
                            .position(x: canvas.width / 2, y: coat.maxY - foregroundHeight / 2)
                    }.frame(width: canvas.width, height: canvas.height)
                }
        }.frame(width: canvas.width, height: canvas.height)
            .allowsHitTesting(false).accessibilityHidden(true)
    }

    private func coatLayer(_ rect: CGRect) -> some View {
        ZStack {
            StoryRaster(ref: "story/raincoat")
                .frame(width: rect.width, height: rect.height)
                .position(x: rect.midX, y: rect.midY)
        }.frame(width: canvas.width, height: canvas.height)
    }
}
