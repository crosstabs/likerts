#if canImport(UIKit) && !SWIFT_PACKAGE
import CoreGraphics
import Foundation
import XCTest
@testable import Likerts

@MainActor
final class StoryAtlasExtractionTests: XCTestCase {
    func testKeepsSeededComponentAndRemovesDisconnectedNeighbourWithoutChangingItsColor() throws {
        var pixels = [UInt8](repeating: 0, count: 8 * 6 * 4)
        for y in 2...4 { for x in 1...3 { put(&pixels, width: 8, x: x, y: y, rgba: [72, 38, 20, 255]) } }
        put(&pixels, width: 8, x: 6, y: 1, rgba: [0, 0, 255, 255])
        let source = try image(width: 8, height: 6, pixels: pixels)
        let output = try XCTUnwrap(StoryAtlasExtraction.connectedSprite(source, seed: CGPoint(x: 2.4, y: 3.2)))
        let result = try rgba(output)
        XCTAssertEqual(pixel(result, width: 8, x: 2, y: 3), [72, 38, 20, 255])
        XCTAssertEqual(pixel(result, width: 8, x: 6, y: 1), [0, 0, 0, 0])
        XCTAssertEqual(source.width, output.width)
        XCTAssertEqual(source.height, output.height)
        XCTAssertEqual(try rgba(source), pixels, "Extraction must not mutate the input image.")
    }

    func testRetainsTwoConnectedAntialiasPixelsWithoutRestoringNearbyOpaqueFragment() throws {
        var pixels = [UInt8](repeating: 0, count: 9 * 5 * 4)
        put(&pixels, width: 9, x: 2, y: 2, rgba: [100, 50, 20, 255])
        put(&pixels, width: 9, x: 3, y: 2, rgba: [8, 4, 2, 15])
        put(&pixels, width: 9, x: 4, y: 2, rgba: [2, 1, 0, 4])
        put(&pixels, width: 9, x: 5, y: 2, rgba: [1, 0, 0, 2])
        put(&pixels, width: 9, x: 4, y: 3, rgba: [0, 0, 255, 255])
        let source = try image(width: 9, height: 5, pixels: pixels)
        let original = try rgba(source)
        let output = try XCTUnwrap(StoryAtlasExtraction.connectedSprite(source, seed: CGPoint(x: 2, y: 2)))
        let result = try rgba(output)
        XCTAssertEqual(pixel(result, width: 9, x: 3, y: 2), pixel(original, width: 9, x: 3, y: 2))
        XCTAssertEqual(pixel(result, width: 9, x: 4, y: 2), pixel(original, width: 9, x: 4, y: 2))
        XCTAssertEqual(pixel(result, width: 9, x: 5, y: 2)[3], 0, "Third edge ring must not expand the bounded mask.")
        XCTAssertEqual(pixel(result, width: 9, x: 4, y: 3)[3], 0, "A separate strong component must not be brought back by edge retention.")
    }

    func testDiagonalConnectionAndUpperLeftSeedCoordinatesArePreserved() throws {
        var pixels = [UInt8](repeating: 0, count: 6 * 7 * 4)
        put(&pixels, width: 6, x: 1, y: 0, rgba: [80, 40, 20, 117])
        put(&pixels, width: 6, x: 2, y: 1, rgba: [90, 50, 30, 255])
        put(&pixels, width: 6, x: 4, y: 6, rgba: [0, 200, 0, 255])
        let source = try image(width: 6, height: 7, pixels: pixels)
        let output = try XCTUnwrap(StoryAtlasExtraction.connectedSprite(source, seed: CGPoint(x: 1, y: 0)))
        let original = try rgba(source), result = try rgba(output)
        XCTAssertEqual(pixel(result, width: 6, x: 1, y: 0), pixel(original, width: 6, x: 1, y: 0))
        XCTAssertEqual(pixel(result, width: 6, x: 2, y: 1)[3], 255)
        XCTAssertEqual(pixel(result, width: 6, x: 4, y: 6)[3], 0)
    }

    func testTransparentLowAlphaAndOutOfBoundsSeedsFailWithoutChoosingAnotherComponent() throws {
        var pixels = [UInt8](repeating: 0, count: 4 * 4 * 4)
        put(&pixels, width: 4, x: 2, y: 2, rgba: [80, 40, 20, 255])
        put(&pixels, width: 4, x: 1, y: 2, rgba: [5, 2, 1, 10])
        let source = try image(width: 4, height: 4, pixels: pixels)
        for seed in [CGPoint.zero, CGPoint(x: 1, y: 2), CGPoint(x: -0.1, y: 2), CGPoint(x: 4, y: 2),
                     CGPoint(x: 2, y: 4), CGPoint(x: CGFloat.nan, y: 2), CGPoint(x: 2, y: CGFloat.infinity)] {
            XCTAssertNil(StoryAtlasExtraction.connectedSprite(source, seed: seed))
        }
    }

    private func image(width: Int, height: Int, pixels: [UInt8]) throws -> CGImage {
        let provider = try XCTUnwrap(CGDataProvider(data: Data(pixels) as CFData))
        return try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                                    bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue).union(.byteOrder32Big),
                                    provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    }
    private func rgba(_ image: CGImage) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let success = bytes.withUnsafeMutableBytes { pointer -> Bool in
            guard let context = CGContext(data: pointer.baseAddress, width: image.width, height: image.height,
                                          bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.setBlendMode(.copy)
            context.interpolationQuality = .none
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        XCTAssertTrue(success)
        return bytes
    }
    private func put(_ bytes: inout [UInt8], width: Int, x: Int, y: Int, rgba: [UInt8]) {
        let index = (y * width + x) * 4
        bytes.replaceSubrange(index..<(index + 4), with: rgba)
    }
    private func pixel(_ bytes: [UInt8], width: Int, x: Int, y: Int) -> [UInt8] {
        let index = (y * width + x) * 4
        return Array(bytes[index..<(index + 4)])
    }
}
#endif
