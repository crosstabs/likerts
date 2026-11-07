#if canImport(UIKit)
import XCTest
import UIKit
@testable import Likerts

@MainActor
final class StoryLayerAtlasTests: XCTestCase {
    func testAtlasLayersResolveAsIndependentTransparentImages() throws {
        let names = ["emptybento", "bentorim", "pancakesingle", "plateplain", "postcardback", "warmglow",
                     "openbook", "loosepage", "redpuzzlepiece", "bluepuzzlepiece", "curtainedwindow", "singlecurtain",
                     "dogattentive", "dogresting", "catattentive", "catresting", "rabbitattentive", "rabbitresting",
                     "cakewhole", "cakemissing", "slicenarrow", "slicewide", "creamdetail", "cakeserver",
                     "mixingbowlempty", "whiskloose", "batterpool", "toasterempty", "toastslice", "servingtray",
                     "puddle", "splash", "snowpatch", "mudpath", "tidypath", "flatscarf",
                     "cottagepurple", "cottagecoral", "cottageblue", "porch", "stationpod", "gardendome"]
        for name in names {
            let image = try XCTUnwrap(StoryArt.image(ref: "story/\(name)"), name)
            let cg = try XCTUnwrap(image.cgImage, name)
            XCTAssertGreaterThan(cg.width, 100, name)
            XCTAssertGreaterThan(cg.height, 100, name)
            XCTAssertNotEqual(cg.alphaInfo, .none, name)
        }
        let registry = try MotionPilotLibrary.registryResult.get()
        let rim = try XCTUnwrap(registry.assets[.init("story/bentorim")])
        XCTAssertFalse(rim.capabilities.contains(.foregroundCut), "Separate artwork is not yet a verified matching occluder.")
        let curtain = try XCTUnwrap(registry.assets[.init("story/singlecurtain")])
        XCTAssertFalse(curtain.capabilities.contains(.foregroundCut), "A separate sprite is not a verified window mask.")
    }
}
#endif
