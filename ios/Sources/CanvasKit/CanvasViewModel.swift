import Combine
import CoreGraphics
import MetalKit
import SwiftUI

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

    private func normalize(rect: CGRect) -> CGRect {
        CGRect(
            x: max(0, min(rect.origin.x, 1)),
            y: max(0, min(rect.origin.y, 1)),
            width: max(0, min(rect.size.width, 1)),
            height: max(0, min(rect.size.height, 1))
        )
    }
}
