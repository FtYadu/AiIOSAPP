import Foundation

public struct LibraryAsset: Identifiable, Codable, Equatable {
    public enum AssetType: String, Codable {
        case original
        case generated
        case reference
    }

    public let id: UUID
    public let type: AssetType
    public let url: URL
    public let metadata: [String: String]
    public let createdAt: Date

    public init(
        id: UUID = UUID(),
        type: AssetType,
        url: URL,
        metadata: [String: String] = [:],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.type = type
        self.url = url
        self.metadata = metadata
        self.createdAt = createdAt
    }
}

public protocol AssetCaching {
    func store(_ asset: LibraryAsset) async
    func assets(for type: LibraryAsset.AssetType) async -> [LibraryAsset]
}

public actor LibraryService: AssetCaching {
    private var items: [LibraryAsset.AssetType: [LibraryAsset]] = [:]

    public init() {}

    public func store(_ asset: LibraryAsset) async {
        items[asset.type, default: []].append(asset)
    }

    public func assets(for type: LibraryAsset.AssetType) async -> [LibraryAsset] {
        items[type] ?? []
    }
}
