import Foundation

public struct PromptGatewayConfiguration {
    public var baseURL: URL

    public init(baseURL: URL = URL(string: "http://localhost:8080")!) {
        self.baseURL = baseURL
    }
}

@available(macOS 12.0, iOS 15.0, *)
public final class NetworkPromptClient: PromptClient {
    private let session: URLSession
    private let configuration: PromptGatewayConfiguration

    public init(
        session: URLSession = .shared,
        configuration: PromptGatewayConfiguration = PromptGatewayConfiguration()
    ) {
        self.session = session
        self.configuration = configuration
    }

    public func fetchSuggestions(
        intent: String,
        boxes: Int,
        provider: String?
    ) async throws -> PromptSuggestionPayload {
        let url = configuration.baseURL.appendingPathComponent("/v1/prompt/suggest")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        let context: PromptRequest.Context?
        if boxes > 0 || provider != nil {
            context = PromptRequest.Context(
                boxes: boxes > 0 ? boxes : nil,
                provider: provider
            )
        } else {
            context = nil
        }
        let body = PromptRequest(
            intent: intent,
            context: context
        )
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw PromptError.gatewayFailure
        }

        let dto = try JSONDecoder().decode(PromptResponse.self, from: data)
        let suggestions = dto.suggestions.map { text in
            PromptSuggestion(
                id: UUID(),
                text: text,
                guidance: dto.tokens.guidance,
                strength: dto.tokens.strength,
                safetyLevel: dto.safetyLevel ?? "balanced"
            )
        }

        return PromptSuggestionPayload(
            provider: dto.provider,
            suggestions: suggestions,
            safetyLevel: dto.safetyLevel ?? "balanced"
        )
    }
}

private struct PromptRequest: Encodable {
    let intent: String
    let context: Context?

    struct Context: Codable {
        let boxes: Int?
        let provider: String?

        enum CodingKeys: String, CodingKey {
            case boxes
            case provider
        }
    }
}

private struct PromptResponse: Codable {
    let provider: String
    let suggestions: [String]
    let safetyLevel: String?
    let tokens: TokenSettings

    struct TokenSettings: Codable {
        let guidance: Double
        let strength: Double
    }
}

public enum PromptError: Error {
    case gatewayFailure
}
