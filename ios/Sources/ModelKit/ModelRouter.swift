import Combine
import Foundation

public enum ModelProvider: String, CaseIterable, Codable {
    case reimagine
    case openai
    case gemini
    case seedream
}

public struct PendingJob: Identifiable, Codable, Equatable {
    public let id: String
    public let provider: ModelProvider
    public let imageHash: String
    public let prompt: String
    public var status: JobStatus

    public init(
        id: String,
        provider: ModelProvider,
        imageHash: String,
        prompt: String,
        status: JobStatus = .queued
    ) {
        self.id = id
        self.provider = provider
        self.imageHash = imageHash
        self.prompt = prompt
        self.status = status
    }
}

public enum JobStatus: String, Codable {
    case queued
    case running
    case succeeded
    case failed
}

public struct ProviderAsset: Identifiable, Equatable {
    public let id: UUID
    public let url: URL
    public let mimeType: String
    public let sha256: String?
    public let width: Int?
    public let height: Int?

    public init(
        id: UUID = UUID(),
        url: URL,
        mimeType: String,
        sha256: String?,
        width: Int?,
        height: Int?
    ) {
        self.id = id
        self.url = url
        self.mimeType = mimeType
        self.sha256 = sha256
        self.width = width
        self.height = height
    }
}

public struct ProviderOutput: Equatable {
    public let outputs: [ProviderAsset]
    public let status: JobStatus
    public let errorMessage: String?

    public init(outputs: [ProviderAsset], status: JobStatus, errorMessage: String? = nil) {
        self.outputs = outputs
        self.status = status
        self.errorMessage = errorMessage
    }
}

public struct ProviderDescriptor: Identifiable, Equatable {
    public let id: String
    public let name: String
    public let modelId: String
    public let safetyLevel: String
    public let supportsBoxes: Bool
    public let supportsUpscale: Bool
    public let guidanceRange: [Double]

    public init(
        id: String,
        name: String,
        modelId: String,
        safetyLevel: String,
        supportsBoxes: Bool,
        supportsUpscale: Bool,
        guidanceRange: [Double]
    ) {
        self.id = id
        self.name = name
        self.modelId = modelId
        self.safetyLevel = safetyLevel
        self.supportsBoxes = supportsBoxes
        self.supportsUpscale = supportsUpscale
        self.guidanceRange = guidanceRange
    }
}

@available(macOS 12.0, iOS 15.0, *)
public protocol GatewayClient {
    func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String
    func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput
    func listProviders() async throws -> [ProviderDescriptor]
}

@available(macOS 12.0, iOS 15.0, *)
public final class ModelRouter: ObservableObject {
    private let client: GatewayClient
    @Published public private(set) var pendingJobs: [PendingJob] = []
    @Published public private(set) var providers: [ProviderDescriptor] = []
    @Published public private(set) var lastError: GatewayError?
    @Published public private(set) var isLoadingProviders = false
    private var outputs: [String: ProviderOutput] = [:]
    private var pollingTask: Task<Void, Never>?

    public init(client: GatewayClient) {
        self.client = client
    }

    deinit {
        pollingTask?.cancel()
    }

    public func submitEdit(
        provider: ModelProvider,
        imageHash: String,
        prompt: String,
        payload: Data
    ) async throws {
        do {
            let jobId = try await client.enqueueEdit(provider: provider, payload: payload)
            let job = PendingJob(id: jobId, provider: provider, imageHash: imageHash, prompt: prompt)
            await MainActor.run {
                pendingJobs.append(job)
                lastError = nil
            }
        } catch let error as GatewayError {
            await MainActor.run {
                lastError = error
            }
            throw error
        } catch {
            let gatewayError = GatewayError.message(error.localizedDescription)
            await MainActor.run {
                lastError = gatewayError
            }
            throw gatewayError
        }
    }

    public func refresh(jobId: String, provider: ModelProvider) async {
        guard let index = pendingJobs.firstIndex(where: { $0.id == jobId }) else { return }
        do {
            let output = try await client.fetchJob(id: jobId, provider: provider)
            outputs[cacheKey(for: jobId, provider: provider)] = output
            await MainActor.run {
                pendingJobs[index].status = output.status
                if let errorMessage = output.errorMessage, !errorMessage.isEmpty {
                    lastError = GatewayError.message(errorMessage)
                }
            }
        } catch let error as GatewayError {
            await MainActor.run {
                pendingJobs[index].status = .failed
                lastError = error
            }
        } catch {
            await MainActor.run {
                pendingJobs[index].status = .failed
                lastError = GatewayError.message(error.localizedDescription)
            }
        }
    }

    public func cachedOutput(for jobId: String, provider: ModelProvider) -> ProviderOutput? {
        outputs[cacheKey(for: jobId, provider: provider)]
    }

    public func loadProviders() async {
        await MainActor.run {
            isLoadingProviders = true
        }

        do {
            let descriptors = try await client.listProviders()
            await MainActor.run {
                providers = descriptors
                lastError = nil
                isLoadingProviders = false
            }
        } catch let error as GatewayError {
            await MainActor.run {
                lastError = error
                isLoadingProviders = false
            }
        } catch {
            let gatewayError = GatewayError.message(error.localizedDescription)
            await MainActor.run {
                lastError = gatewayError
                isLoadingProviders = false
            }
        }
    }

    public func startPolling(every interval: TimeInterval = 3.0) {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                await self.pollPendingJobs()
            }
        }
    }

    private func pollPendingJobs() async {
        let jobs = await MainActor.run { pendingJobs }
        for job in jobs where job.status == .queued || job.status == .running {
            await refresh(jobId: job.id, provider: job.provider)
        }
    }

    private func cacheKey(for jobId: String, provider: ModelProvider) -> String {
        "\(jobId)_\(provider.rawValue)"
    }
}
