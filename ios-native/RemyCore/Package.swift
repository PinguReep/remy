// swift-tools-version:5.9
// Le cœur de l'app iPhone : modèles, client de l'API, flux de réponse, état
// des écrans. Aucune dépendance à SwiftUI — il se compile et se teste aussi
// sous Linux, ce qui permet de le vérifier sans Mac.
import PackageDescription

let package = Package(
    name: "RemyCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "RemyCore", targets: ["RemyCore"])],
    targets: [
        .target(name: "RemyCore"),
        .testTarget(name: "RemyCoreTests", dependencies: ["RemyCore"]),
    ]
)
