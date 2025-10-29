import Combine
import CoreGraphics
import MetalKit
import SwiftUI
import ImageIO

#if canImport(UIKit)
import UIKit
public typealias CanvasOverlayImage = UIImage
#elseif canImport(AppKit)
import AppKit
public typealias CanvasOverlayImage = NSImage
#else
public typealias CanvasOverlayImage = AnyObject
#endif

public struct EditBox: Identifiable, Codable, Equatable {
    public let id: UUID
    public var rect: CGRect
    public var label: String?
    public var feather: CGFloat

    public init(id: UUID = UUID(), rect: CGRect, label: String? = nil, feather: CGFloat = 0.1) {
        self.id = id
        self.rect = rect
        self.label = label
        self.feather = feather
    }
}

@available(macOS 10.15, iOS 15.0, *)
public final class CanvasViewModel: ObservableObject {
    @Published public var boxes: [EditBox] = []
    @Published public var overlays: [CanvasOverlayImage] = []
    @Published public var zoomScale: CGFloat = 1.0
    @Published public var referenceOpacity: CGFloat = 0.5
    @Published public var initImageData: Data?
    @Published public var initImageURL: URL?
    @Published public var maskImageData: Data?
    @Published public var maskImageURL: URL?

    public let device: MTLDevice?
    public private(set) var commandQueue: MTLCommandQueue?

    public init(device: MTLDevice? = MTLCreateSystemDefaultDevice()) {
        self.device = device
        self.commandQueue = device?.makeCommandQueue()
    }

    public func addBox(rect: CGRect, label: String? = nil, feather: CGFloat = 0.1) {
        let normalized = normalize(rect: rect)
        boxes.append(EditBox(rect: normalized, label: label, feather: feather))
    }

    public func updateBox(id: EditBox.ID, rect: CGRect) {
        guard let index = boxes.firstIndex(where: { $0.id == id }) else { return }
        boxes[index].rect = normalize(rect: rect)
    }

    public func removeBox(id: EditBox.ID) {
        boxes.removeAll { $0.id == id }
    }

    public func setInitImage(data: Data?, remoteURL: URL?) {
        initImageData = data
        initImageURL = remoteURL
    }

    public func setMaskImage(data: Data?, remoteURL: URL?) {
        maskImageData = data
        maskImageURL = remoteURL
    }

    public func clearAssets() {
        initImageData = nil
        initImageURL = nil
        maskImageData = nil
        maskImageURL = nil
    }

    private func normalize(rect: CGRect) -> CGRect {
        CGRect(
            x: max(0, min(rect.origin.x, 1)),
            y: max(0, min(rect.origin.y, 1)),
            width: max(0, min(rect.size.width, 1)),
            height: max(0, min(rect.size.height, 1))
        )
    }

    public func renderedMask(size: CGSize = CGSize(width: 1024, height: 1024)) -> Data? {
        guard !boxes.isEmpty else { return nil }

        #if canImport(UIKit)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.white.setFill()
            for box in boxes {
                let rect = CGRect(
                    x: box.rect.origin.x * size.width,
                    y: box.rect.origin.y * size.height,
                    width: box.rect.size.width * size.width,
                    height: box.rect.size.height * size.height
                )
                context.fill(rect)
            }
        }
        return image.pngData()
        #elseif canImport(AppKit)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.black.setFill()
        NSBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
        NSColor.white.setFill()
        for box in boxes {
            let rect = CGRect(
                x: box.rect.origin.x * size.width,
                y: box.rect.origin.y * size.height,
                width: box.rect.size.width * size.width,
                height: box.rect.size.height * size.height
            )
            NSBezierPath(rect: rect).fill()
        }
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff) else {
            return nil
        }
        return bitmap.representation(using: .png, properties: [:])
        #else
        return nil
        #endif
    }

    public func sizeForImageData(_ data: Data) -> CGSize? {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, options as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, options as CFDictionary) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? CGFloat,
              let height = properties[kCGImagePropertyPixelHeight] as? CGFloat else {
            return nil
        }
        return CGSize(width: width, height: height)
    }
}
