import Foundation
import CryptoKit
import ImageIO

@MainActor
public final class SupabaseSessionManager: ObservableObject, SupabaseSessionProviding {
    public enum AuthState: Equatable {
        case idle
        case authenticating
        case authenticated(expiration: Date)
        case failed(message: String)
    }

    public struct UploadedAsset: Equatable {
        public let publicURL: URL
        public let storagePath: String
        public let contentType: String
        public let sha256: String
        public let width: Int?
        public let height: Int?

        public init(
            publicURL: URL,
            storagePath: String,
            contentType: String,
            sha256: String,
            width: Int?,
            height: Int?
        ) {
            self.publicURL = publicURL
            self.storagePath = storagePath
            self.contentType = contentType
            self.sha256 = sha256
            self.width = width
            self.height = height
        }
    }

    private struct SupabaseSession: Equatable {
        let accessToken: String
        let expiresAt: Date
    }

    private struct AuthResponse: Decodable {
        let accessToken: String
        let expiresIn: Int

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case expiresIn = "expires_in"
        }
    }

    private struct SignedUploadRequest: Encodable {
        let fileName: String
        let contentType: String
        let bucket: String

        enum CodingKeys: String, CodingKey {
            case fileName = "file_name"
            case contentType = "content_type"
            case bucket
        }
    }

    private struct SignedUploadResponse: Decodable {
        let uploadURL: URL
        let storagePath: String
        let publicURL: URL
        let contentType: String

        enum CodingKeys: String, CodingKey {
            case uploadURL = "upload_url"
            case storagePath = "storage_path"
            case publicURL = "public_url"
            case contentType = "content_type"
        }
    }

    public struct Configuration {
        public var supabaseURL: URL
        public var anonKey: String
        public var email: String
        public var password: String
        public var gatewayBaseURL: URL
        public var defaultBucket: String

        public init(
            supabaseURL: URL = URL(string: "http://localhost:54321")!,
            anonKey: String = ProcessInfo.processInfo.environment["SUPABASE_ANON_KEY"] ?? "public-anon-key",
            email: String = ProcessInfo.processInfo.environment["SUPABASE_EMAIL"] ?? "demo@example.com",
            password: String = ProcessInfo.processInfo.environment["SUPABASE_PASSWORD"] ?? "password",
            gatewayBaseURL: URL = GatewayConfiguration().baseURL,
            defaultBucket: String = "uploads"
        ) {
            self.supabaseURL = supabaseURL
            self.anonKey = anonKey
            self.email = email
            self.password = password
            self.gatewayBaseURL = gatewayBaseURL
            self.defaultBucket = defaultBucket
        }
    }

    @Published public private(set) var authState: AuthState = .idle
    @Published public private(set) var lastErrorMessage: String?

    private let configuration: Configuration
    private let urlSession: URLSession
    private let jsonDecoder: JSONDecoder
    private let jsonEncoder: JSONEncoder
    private var cachedSession: SupabaseSession?
    private var authenticatingTask: Task<SupabaseSession, Error>?

    public init(
        configuration: Configuration = Configuration(),
        urlSession: URLSession = .shared
    ) {
        self.configuration = configuration
        self.urlSession = urlSession
        jsonDecoder = JSONDecoder()
        jsonEncoder = JSONEncoder()
        jsonEncoder.keyEncodingStrategy = .convertToSnakeCase
    }

    public func currentAccessToken() async throws -> String {
        if let cachedSession, cachedSession.expiresAt.timeIntervalSinceNow > 60 {
            if case .failed = authState {
                authState = .authenticated(expiration: cachedSession.expiresAt)
            }
            return cachedSession.accessToken
        }

        let session = try await authenticate()
        return session.accessToken
    }

    public func ensureSession() async throws {
        _ = try await currentAccessToken()
    }

    public func signAndUpload(
        data: Data,
        fileName: String,
        contentType: String,
        bucket: String? = nil
    ) async throws -> UploadedAsset {
        let signedUpload = try await createSignedUpload(
            fileName: fileName,
            contentType: contentType,
            bucket: bucket ?? configuration.defaultBucket
        )

        var request = URLRequest(url: signedUpload.uploadURL)
        request.httpMethod = "PUT"
        request.httpBody = data
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        do {
            let (_, response) = try await urlSession.upload(for: request, from: data)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200 ..< 300).contains(httpResponse.statusCode) else {
                throw GatewayError.uploadFailed
            }
        } catch {
            lastErrorMessage = error.localizedDescription
            throw GatewayError.message(error.localizedDescription)
        }

        let hash = SHA256.hash(data: data)
        let hashString = hash.map { String(format: "%02x", $0) }.joined()
        let size = imageSize(from: data)

        return UploadedAsset(
            publicURL: signedUpload.publicURL,
            storagePath: signedUpload.storagePath,
            contentType: signedUpload.contentType,
            sha256: hashString,
            width: size?.width,
            height: size?.height
        )
    }

    public func reset() {
        cachedSession = nil
        authState = .idle
        lastErrorMessage = nil
    }

    private func authenticate() async throws -> SupabaseSession {
        if let authenticatingTask {
            return try await authenticatingTask.value
        }

        guard !configuration.email.isEmpty, !configuration.password.isEmpty else {
            let error = GatewayError.missingSession
            lastErrorMessage = error.localizedDescription
            throw error
        }

        authState = .authenticating
        let task = Task<SupabaseSession, Error> {
            var components = URLComponents(url: configuration.supabaseURL, resolvingAgainstBaseURL: false)
            components?.path = "/auth/v1/token"
            components?.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
            guard let url = components?.url else {
                throw GatewayError.message("Invalid Supabase URL")
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
            request.setValue(configuration.anonKey, forHTTPHeaderField: "Authorization")

            let payload = [
                "email": configuration.email,
                "password": configuration.password
            ]
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

            let (data, response) = try await urlSession.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw GatewayError.invalidResponse(statusCode: -1)
            }

            guard (200 ..< 300).contains(httpResponse.statusCode) else {
                if httpResponse.statusCode == 401 {
                    throw GatewayError.unauthorized
                }
                throw GatewayError.invalidResponse(statusCode: httpResponse.statusCode)
            }

            do {
                let auth = try jsonDecoder.decode(AuthResponse.self, from: data)
                let session = SupabaseSession(
                    accessToken: auth.accessToken,
                    expiresAt: Date().addingTimeInterval(TimeInterval(auth.expiresIn))
                )
                return session
            } catch {
                throw GatewayError.decoding
            }
        }

        authenticatingTask = task

        do {
            let session = try await task.value
            cachedSession = session
            authState = .authenticated(expiration: session.expiresAt)
            lastErrorMessage = nil
            authenticatingTask = nil
            return session
        } catch {
            authenticatingTask = nil
            cachedSession = nil
            if let gatewayError = error as? GatewayError {
                authState = .failed(message: gatewayError.localizedDescription ?? "Authentication failed")
                lastErrorMessage = gatewayError.localizedDescription
                throw gatewayError
            } else {
                authState = .failed(message: error.localizedDescription)
                lastErrorMessage = error.localizedDescription
                throw GatewayError.message(error.localizedDescription)
            }
        }
    }

    private func createSignedUpload(
        fileName: String,
        contentType: String,
        bucket: String
    ) async throws -> SignedUploadResponse {
        let token = try await currentAccessToken()
        var request = URLRequest(url: configuration.gatewayBaseURL.appendingPathComponent("/v1/uploads/sign"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let payload = SignedUploadRequest(fileName: fileName, contentType: contentType, bucket: bucket)
        request.httpBody = try jsonEncoder.encode(payload)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            lastErrorMessage = error.localizedDescription
            throw GatewayError.message(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidResponse(statusCode: -1)
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw GatewayError.unauthorized
            }
            throw GatewayError.invalidResponse(statusCode: httpResponse.statusCode)
        }

        do {
            return try jsonDecoder.decode(SignedUploadResponse.self, from: data)
        } catch {
            throw GatewayError.decoding
        }
    }

    private func imageSize(from data: Data) -> (width: Int, height: Int)? {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, options as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, options as CFDictionary) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else {
            return nil
        }

        return (width, height)
    }
}

public protocol SupabaseSessionProviding: AnyObject {
    func currentAccessToken() async throws -> String
}
