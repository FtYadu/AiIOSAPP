import Foundation

public struct GatewayConfiguration {
    public var baseURL: URL

    public init(baseURL: URL = URL(string: "http://localhost:8080")!) {
        self.baseURL = baseURL
    }
}

@available(macOS 12.0, iOS 15.0, *)
public final class NetworkGatewayClient: GatewayClient {
    private let session: URLSession
    private let configuration: GatewayConfiguration

    public init(
        session: URLSession = .shared,
        configuration: GatewayConfiguration = GatewayConfiguration()
    ) {
        self.session = session
        self.configuration = configuration
    }

    public func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String {
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent("/v1/edits"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 202 else {
            throw GatewayError.invalidResponse
        }

        let decoded = try JSONDecoder().decode(EnqueueResponse.self, from: data)
        return decoded.jobId
    }

    public func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput {
        _ = provider
        let requestURL = configuration.baseURL.appendingPathComponent("/v1/jobs/\(id)")
        let (data, response) = try await session.data(from: requestURL)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw GatewayError.invalidResponse
        }

        let decoded = try JSONDecoder().decode(JobResponse.self, from: data)
        let previews = decoded.previews.compactMap(URL.init(string:))
        let outputs = decoded.outputs.compactMap(URL.init(string:))
        let status = JobStatus(rawValue: decoded.status) ?? .queued

        return ProviderOutput(previews: previews, outputs: outputs, status: status)
    }

    public func listProviders() async throws -> [ProviderDescriptor] {
        let requestURL = configuration.baseURL.appendingPathComponent("/v1/providers")
        let (data, response) = try await session.data(from: requestURL)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw GatewayError.invalidResponse
        }

        let decoded = try JSONDecoder().decode(ProvidersResponse.self, from: data)
        return decoded.providers.map {
            ProviderDescriptor(
                id: $0.name,
                name: $0.name,
                modelId: $0.modelId,
                safetyLevel: $0.safetyLevel,
                supportsBoxes: $0.supportsBoxes,
                supportsUpscale: $0.supportsUpscale,
                guidanceRange: $0.guidanceRange
            )
        }
    }
}

public enum GatewayError: Error {
    case invalidResponse
}

private struct EnqueueResponse: Codable {
    let jobId: String
}

private struct JobResponse: Codable {
    let jobId: String
    let provider: String
    let status: String
    let previews: [String]
    let outputs: [String]
}

private struct ProvidersResponse: Codable {
    let providers: [ProviderDTO]

    struct ProviderDTO: Codable {
        let name: String
        let endpoint: String
        let modelId: String
        let safetyLevel: String
        let supportsBoxes: Bool
        let supportsUpscale: Bool
        let guidanceRange: [Double]
    }
}
