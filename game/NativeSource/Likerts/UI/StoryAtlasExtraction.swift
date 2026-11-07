import CoreGraphics
import Foundation

/// Presentation-only clipping of disconnected atlas neighbours. Original PNGs
/// and the intended sprite's color/alpha samples are never edited or recolored.
/// StoryArt owns the cropped-image cache and calls this once for each sprite.
@MainActor
enum StoryAtlasExtraction {
    private static let threshold: UInt8 = 16
    private static let maximumPixels = 4_194_304

    /// `seed` uses local source-image pixel coordinates (upper-left origin).
    /// Its floored pixel must lie in the intended opaque component. Low-alpha
    /// antialiasing is retained for at most two connected pixels from its edge;
    /// opaque pixels in other components are never recovered by that dilation.
    static func connectedSprite(_ image: CGImage, seed: CGPoint) -> CGImage? {
        let width = image.width, height = image.height
        guard width > 0, height > 0, width <= maximumPixels / height,
              !image.isMask, seed.x.isFinite, seed.y.isFinite,
              seed.x >= 0, seed.y >= 0,
              seed.x < CGFloat(width), seed.y < CGFloat(height) else { return nil }
        let count = width * height
        let sampledAlpha: [UInt8]? = {
            var rgba = [UInt8](repeating: 0, count: count * 4)
            let rendered = rgba.withUnsafeMutableBytes { bytes -> Bool in
                guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                                              bitsPerComponent: 8, bytesPerRow: width * 4,
                                              space: CGColorSpaceCreateDeviceRGB(),
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
                context.setBlendMode(.copy)
                context.interpolationQuality = .none
                context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            guard rendered else { return nil }
            return stride(from: 3, to: rgba.count, by: 4).map { rgba[$0] }
        }()
        guard let alpha = sampledAlpha else { return nil }
        let start = Int(seed.y.rounded(.down)) * width + Int(seed.x.rounded(.down))
        guard alpha[start] >= threshold else { return nil }

        // Byte flags avoid Set/boxed-pixel overhead. Eight-connectivity keeps
        // diagonal antialiased joins and attached sculpted limbs intact.
        var kept = [UInt8](repeating: 0, count: count)
        kept[start] = 1
        var component: [UInt32] = [UInt32(start)]
        component.reserveCapacity(min(count, 65_536))
        var cursor = 0
        while cursor < component.count {
            let index = Int(component[cursor]); cursor += 1
            let x = index % width, y = index / width
            for nextY in max(0, y - 1)...min(height - 1, y + 1) {
                for nextX in max(0, x - 1)...min(width - 1, x + 1) {
                    let next = nextY * width + nextX
                    if kept[next] == 0 && alpha[next] >= threshold {
                        kept[next] = 1
                        component.append(UInt32(next))
                    }
                }
            }
        }

        // Recover only low-alpha source pixels. Dilation must not bring back
        // an unrelated opaque fragment close to the desired sprite.
        var firstEdgeRing: [UInt32] = []
        for pixel in component {
            let index = Int(pixel), x = index % width, y = index / width
            for nextY in max(0, y - 1)...min(height - 1, y + 1) {
                for nextX in max(0, x - 1)...min(width - 1, x + 1) {
                    let next = nextY * width + nextX
                    if kept[next] == 0 && alpha[next] > 0 && alpha[next] < threshold {
                        kept[next] = 2
                        firstEdgeRing.append(UInt32(next))
                    }
                }
            }
        }
        for pixel in firstEdgeRing {
            let index = Int(pixel), x = index % width, y = index / width
            for nextY in max(0, y - 1)...min(height - 1, y + 1) {
                for nextX in max(0, x - 1)...min(width - 1, x + 1) {
                    let next = nextY * width + nextX
                    if kept[next] == 0 && alpha[next] > 0 && alpha[next] < threshold { kept[next] = 2 }
                }
            }
        }

        // Quartz image masks use 0 for kept/opaque and 255 for clipped. Applying
        // the binary mask to the source preserves its original antialias alpha
        // and color samples; the alpha analysis bitmap is never the output.
        let maskBytes = kept.map { $0 == 0 ? UInt8(255) : UInt8(0) }
        guard let provider = CGDataProvider(data: Data(maskBytes) as CFData),
              let mask = CGImage(maskWidth: width, height: height, bitsPerComponent: 8,
                                 bitsPerPixel: 8, bytesPerRow: width, provider: provider,
                                 decode: nil, shouldInterpolate: false) else { return nil }
        return image.masking(mask)
    }
}
