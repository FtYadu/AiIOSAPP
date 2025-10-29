import Foundation

public struct GatewayConfiguration {
    public var baseURL: URL

    public init(baseURL: URL = URL(string: "http://localhost:8080")!) {
        self.baseURL = baseURL
    }
}

public enum GatewayError: LocalizedError, Equatable {
    case invalidResponse(statusCode: Int)
    case decoding
    case unauthorized
    case missingSession
    case uploadFailed
    case message(String)

    public var errorDescription: String? {
        switch self {
        case let .invalidResponse(statusCode):
            return "Gateway response invalid (status code: \(statusCode))."
        case .decoding:
            return "Failed to decode gateway response."
        case .unauthorized:
            return "Unauthorized. Please verify your Supabase credentials."
        case .missingSession:
            return "Supabase credentials are required before contacting the gateway."
        case .uploadFailed:
            return "Failed to upload asset to storage."
        case let .message(message):
            return message
        }
    }
}

@available(macOS 12.0, iOS 15.0, *)
public final class NetworkGatewayClient: GatewayClient {
    private let session: URLSession
    private let configuration: GatewayConfiguration
    private let jsonDecoder: JSONDecoder
    private let sessionProvider: SupabaseSessionProviding?

    public init(
        session: URLSession = .shared,
        configuration: GatewayConfiguration = GatewayConfiguration(),
        sessionProvider: SupabaseSessionProviding? = nil
    ) {
        self.session = session
        self.configuration = configuration
        self.sessionProvider = sessionProvider
        jsonDecoder = JSONDecoder()
        jsonDecoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    public func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String {
        _ = provider
        let endpoint = configuration.baseURL.appendingPathComponent("/v1/images/edits")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload
        if let token = try await sessionProvider?.currentAccessToken() {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if sessionProvider != nil {
            throw GatewayError.missingSession
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw GatewayError.message(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidResponse(statusCode: -1)
        }

        switch httpResponse.statusCode {
        case 202:
            break
        case 401:
            throw GatewayError.unauthorized
        default:
            throw GatewayError.invalidResponse(statusCode: httpResponse.statusCode)
        }

        do {
            let decoded = try jsonDecoder.decode(EnqueueResponse.self, from: data)
            return decoded.jobId
        } catch {
            throw GatewayError.decoding
        }
    }

    public func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput {
        _ = provider
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent("/v1/images/edits/\(id)"))
        if let token = try await sessionProvider?.currentAccessToken() {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if sessionProvider != nil {
            throw GatewayError.missingSession
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw GatewayError.message(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidResponse(statusCode: -1)
        }

        switch httpResponse.statusCode {
        case 200:
            break
        case 401:
            throw GatewayError.unauthorized
        case 404:
            throw GatewayError.invalidResponse(statusCode: httpResponse.statusCode)
        default:
            throw GatewayError.invalidResponse(statusCode: httpResponse.statusCode)
        }

        do {
            let decoded = try jsonDecoder.decode(JobResponse.self, from: data)
            let status = JobStatus(rawValue: decoded.status) ?? .queued
            let assets = decoded.outputs.compactMap { asset -> ProviderAsset? in
                guard let url = URL(string: asset.url) else { return nil }
                return ProviderAsset(
                    url: url,
                    mimeType: asset.mime,
                    sha256: asset.sha256,
                    width: asset.width,
                    height: asset.height
                )
            }

            return ProviderOutput(outputs: assets, status: status, errorMessage: decoded.error)
        } catch {
            throw GatewayError.decoding
        }
    }

    public func listProviders() async throws -> [ProviderDescriptor] {
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent("/v1/providers"))
        if let token = try await sessionProvider?.currentAccessToken() {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw GatewayError.message(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidResponse(statusCode: -1)
        }

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw GatewayError.unauthorized
            }
            throw GatewayError.invalidResponse(statusCode: httpResponse.statusCode)
        }

        do {
            let decoded = try jsonDecoder.decode(ProvidersResponse.self, from: data)
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
        } catch {
            throw GatewayError.decoding
        }
    }
}

private struct EnqueueResponse: Decodable {
    let jobId: String
    let pollUrl: URL
    let status: String
}

private struct JobResponse: Decodable {
    struct OutputAsset: Decodable {
        let url: String
        let mime: String
        let sha256: String?
        let width: Int?
        let height: Int?
    }

    let jobId: String
    let status: String
    let error: String?
    let outputs: [OutputAsset]
}

private struct ProvidersResponse: Decodable {
    let providers: [ProviderDTO]

    struct ProviderDTO: Decodable {
        let name: String
        let endpoint: String
        let modelId: String
        let safetyLevel: String
        let supportsBoxes: Bool
        let supportsUpscale: Bool
        let guidanceRange: [Double]
    }
}
