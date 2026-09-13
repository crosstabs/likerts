// swift-tools-version: 5.9
import PackageDescription

// Keep the SDK source in the monorepo while allowing this repository URL to be
// added directly in Xcode or SwiftPM. Existing local sdks/ios users keep working.
let package = Package(
    name: "Likerts",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "Likerts", targets: ["Likerts"])],
    targets: [
        .target(name: "Likerts", path: "sdks/ios/Sources/Likerts"),
        .testTarget(name: "LikertsTests", dependencies: ["Likerts"], path: "sdks/ios/Tests/LikertsTests")
    ]
)
