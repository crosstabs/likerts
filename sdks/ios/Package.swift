// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "Likerts", platforms: [.iOS(.v15), .macOS(.v12)], products: [.library(name: "Likerts", targets: ["Likerts"])], targets: [.target(name: "Likerts"), .testTarget(name: "LikertsTests", dependencies: ["Likerts"])])
