import Foundation

public struct Trend: Identifiable, Codable, Equatable {
    public let id: UUID
    public let term: String
    public let provider: String
    public let sampleURL: URL?
    public let updatedAt: Date

    public init(id: UUID = UUID(), term: String, provider: String, sampleURL: URL?, updatedAt: Date) {
        self.id = id
        self.term = term
        self.provider = provider
        self.sampleURL = sampleURL
        self.updatedAt = updatedAt
    }
}

@available(macOS 12.0, iOS 15.0, *)
public final class InspirationStore: ObservableObject {
    @Published public private(set) var trends: [Trend] = []
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL = URL(string: "http://localhost:8080")!, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func refresh() async {
        do {
            let (data, response) = try await session.data(from: baseURL.appendingPathComponent("/v1/trends"))
            guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
                return
            }

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let payload = try decoder.decode(TrendResponse.self, from: data)
            let mapped = payload.trends.map { dto in
                Trend(
                    term: dto.term,
                    provider: dto.provider,
                    sampleURL: URL(string: dto.sampleUrl),
                    updatedAt: dto.updatedAt
                )
            }
            await MainActor.run {
                trends = mapped
            }
        } catch {
            // Ignore errors for now; leave existing trends in place.
        }
    }
}

private struct TrendResponse: Codable {
    let trends: [TrendDTO]

    struct TrendDTO: Codable {
        let term: String
        let provider: String
        let rank: Int
        let sampleUrl: String
        let updatedAt: Date
    }
}
