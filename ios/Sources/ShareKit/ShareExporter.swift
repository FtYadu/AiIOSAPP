import Foundation
import UniformTypeIdentifiers

public enum ShareFormat: String, CaseIterable {
    case png
    case jpeg
    case webp
    case recipeJSON
}

public struct ShareOptions {
    public let includeMetadata: Bool
    public let format: ShareFormat

    public init(includeMetadata: Bool = true, format: ShareFormat = .png) {
        self.includeMetadata = includeMetadata
        self.format = format
    }
}

@available(macOS 11.0, iOS 14.0, *)
public protocol ShareExporting {
    func export(data: Data, options: ShareOptions) throws -> (data: Data, type: UTType)
}

@available(macOS 11.0, iOS 14.0, *)
public final class ShareExporter: ShareExporting {
    public init() {}

    public func export(data: Data, options: ShareOptions) throws -> (data: Data, type: UTType) {
        switch options.format {
        case .png:
            return (data, .png)
        case .jpeg:
            return (data, .jpeg)
        case .webp:
            return (data, UTType("public.webp") ?? .png)
        case .recipeJSON:
            let recipe = Recipe(metadataIncluded: options.includeMetadata)
            let recipeData = try JSONEncoder().encode(recipe)
            return (recipeData, .json)
        }
    }

    private struct Recipe: Codable {
        let metadataIncluded: Bool
        let exportedAt: Date

        init(metadataIncluded: Bool, exportedAt: Date = Date()) {
            self.metadataIncluded = metadataIncluded
            self.exportedAt = exportedAt
        }
    }
}
