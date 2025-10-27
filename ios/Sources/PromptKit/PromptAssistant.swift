import Foundation

public struct PromptSuggestion: Identifiable, Codable, Equatable {
    public let id: UUID
    public let text: String
    public let guidance: Double
    public let strength: Double
    public let safetyLevel: String

    public init(
        id: UUID = UUID(),
        text: String,
        guidance: Double,
        strength: Double,
        safetyLevel: String
    ) {
        self.id = id
        self.text = text
        self.guidance = guidance
        self.strength = strength
        self.safetyLevel = safetyLevel
    }
}

public struct PromptSuggestionPayload: Codable {
    public let provider: String
    public let suggestions: [PromptSuggestion]
    public let safetyLevel: String
}

public protocol PromptClient {
    func fetchSuggestions(
        intent: String,
        boxes: Int,
        provider: String?
    ) async throws -> PromptSuggestionPayload
}

public protocol PromptSuggesting {
    func suggestPrompts(
        for intent: String,
        boxes: Int,
        provider: String?
    ) async throws -> PromptSuggestionPayload
}

public final class PromptAssistant: PromptSuggesting {
    private let client: PromptClient

    public init(client: PromptClient? = nil) {
        if let client {
            self.client = client
        } else if #available(macOS 12.0, iOS 15.0, *) {
            self.client = NetworkPromptClient()
        } else {
            self.client = LocalPromptClient()
        }
    }

    public func suggestPrompts(
        for intent: String,
        boxes: Int,
        provider: String?
    ) async throws -> PromptSuggestionPayload {
        guard !intent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return PromptSuggestionPayload(provider: provider ?? "openai", suggestions: [], safetyLevel: "balanced")
        }

        return try await client.fetchSuggestions(intent: intent, boxes: boxes, provider: provider)
    }
}

private final class LocalPromptClient: PromptClient {
    func fetchSuggestions(
        intent: String,
        boxes: Int,
        provider: String?
    ) async throws -> PromptSuggestionPayload {
        let prefix = boxes > 0 ? "apply inside region: " : ""
        let normalized = intent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            return PromptSuggestionPayload(provider: provider ?? "openai", suggestions: [], safetyLevel: "balanced")
        }

        let suggestions = [
            PromptSuggestion(text: "\(prefix)\(normalized) with cinematic lighting", guidance: 0.7, strength: 0.5, safetyLevel: "balanced"),
            PromptSuggestion(text: "\(prefix)\(normalized) with soft shadows", guidance: 0.65, strength: 0.45, safetyLevel: "balanced")
        ]

        return PromptSuggestionPayload(provider: provider ?? "openai", suggestions: suggestions, safetyLevel: "balanced")
    }
}
