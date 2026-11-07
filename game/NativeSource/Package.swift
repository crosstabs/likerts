// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Likerts",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "Likerts", targets: ["Likerts"])],
    targets: [
        .target(name: "Likerts", path: "Likerts/Core", resources: [.copy("TopicData"), .copy("MotionData")]),
        .testTarget(name: "LikertsTests", dependencies: ["Likerts"], path: "LikertsTests", exclude: ["SceneReviewOriginal218.json"])
    ]
)
