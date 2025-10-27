#if canImport(UIKit)
import UIKit
public typealias CaptureImage = UIImage
#elseif canImport(AppKit)
import AppKit
public typealias CaptureImage = NSImage
#else
public typealias CaptureImage = AnyObject
#endif

import Foundation
import UniformTypeIdentifiers

public enum CaptureError: Error {
    case cameraUnavailable
    case importFailed
    case unsupported
}

@available(macOS 11.0, iOS 14.0, *)
public struct CaptureConfiguration {
    public var allowsCamera: Bool
    public var preferredFormat: UTType

    public init(allowsCamera: Bool = true, preferredFormat: UTType = .png) {
        self.allowsCamera = allowsCamera
        self.preferredFormat = preferredFormat
    }
}

public protocol CaptureProviding {
    func importImage(from url: URL) async throws -> CaptureImage
    func convertToPNG(_ image: CaptureImage) async throws -> Data
}

@available(macOS 11.0, iOS 14.0, *)
public final class CaptureService: CaptureProviding {
    private let configuration: CaptureConfiguration

    public init(configuration: CaptureConfiguration = .init()) {
        self.configuration = configuration
    }

    public func importImage(from url: URL) async throws -> CaptureImage {
#if canImport(UIKit)
        let data = try Data(contentsOf: url)
        guard let image = UIImage(data: data) else {
            throw CaptureError.importFailed
        }
        return image
#elseif canImport(AppKit)
        let data = try Data(contentsOf: url)
        guard let image = NSImage(data: data) else {
            throw CaptureError.importFailed
        }
        return image
#else
        _ = url
        throw CaptureError.unsupported
#endif
    }

    public func convertToPNG(_ image: CaptureImage) async throws -> Data {
#if canImport(UIKit)
        guard let data = (image as? UIImage)?.pngData() else {
            throw CaptureError.importFailed
        }
        return data
#elseif canImport(AppKit)
        guard let tiff = (image as? NSImage)?.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .png, properties: [:]) else {
            throw CaptureError.importFailed
        }
        return data
#else
        _ = image
        throw CaptureError.unsupported
#endif
    }
}
