// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Imagen",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "CaptureKit", targets: ["CaptureKit"]),
        .library(name: "CanvasKit", targets: ["CanvasKit"]),
        .library(name: "PromptKit", targets: ["PromptKit"]),
        .library(name: "ModelKit", targets: ["ModelKit"]),
        .library(name: "CompareKit", targets: ["CompareKit"]),
        .library(name: "LibraryKit", targets: ["LibraryKit"]),
        .library(name: "ShareKit", targets: ["ShareKit"]),
        .library(name: "InspirationKit", targets: ["InspirationKit"]),
        .executable(name: "ImagenApp", targets: ["ImagenApp"])
    ],
    targets: [
        .target(name: "CaptureKit"),
        .target(
            name: "CanvasKit",
            dependencies: ["CaptureKit"]
        ),
        .target(
            name: "PromptKit",
            dependencies: ["ModelKit"]
        ),
        .target(
            name: "ModelKit",
            dependencies: []
        ),
        .target(
            name: "CompareKit",
            dependencies: ["ModelKit"]
        ),
        .target(
            name: "LibraryKit",
            dependencies: []
        ),
        .target(
            name: "ShareKit",
            dependencies: ["LibraryKit"]
        ),
        .target(
            name: "InspirationKit",
            dependencies: []
        ),
        .executableTarget(
            name: "ImagenApp",
            dependencies: [
                "CaptureKit",
                "CanvasKit",
                "PromptKit",
                "ModelKit",
                "CompareKit",
                "LibraryKit",
                "ShareKit",
                "InspirationKit"
            ],
            path: "Sources/ImagenApp"
        ),
        .testTarget(
            name: "ImagenTests",
            dependencies: ["ModelKit"],
            path: "Tests"
        )
    ]
)
