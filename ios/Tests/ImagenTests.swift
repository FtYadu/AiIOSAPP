#if canImport(XCTest)
import XCTest
@testable import ModelKit

@available(macOS 12.0, iOS 15.0, *)
final class ImagenTests: XCTestCase {
    func testModelRouterSubmitsJob() async throws {
        let client = RecordingGatewayClient()
        let router = ModelRouter(client: client)

        try await router.submitEdit(
            provider: .openai,
            imageHash: "hash",
            prompt: "test prompt",
            payload: Data()
        )

        await MainActor.run {
            XCTAssertEqual(router.pendingJobs.count, 1)
            XCTAssertEqual(router.pendingJobs.first?.provider, .openai)
        }
    }

    func testLoadProvidersUsesGateway() async throws {
        let client = RecordingGatewayClient()
        let router = ModelRouter(client: client)

        await router.loadProviders()

        await MainActor.run {
            XCTAssertEqual(router.providers.count, 2)
            XCTAssertEqual(router.providers.first?.id, "openai")
        }
    }
}

@available(macOS 12.0, iOS 15.0, *)
private final class RecordingGatewayClient: GatewayClient {
    func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String {
        _ = (provider, payload)
        return UUID().uuidString
    }

    func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput {
        _ = (id, provider)
        return ProviderOutput(previews: [], outputs: [], status: .queued)
    }

    func listProviders() async throws -> [ProviderDescriptor] {
        [
            ProviderDescriptor(
                id: "openai",
                name: "OpenAI",
                modelId: "gpt-image-edit-1",
                safetyLevel: "balanced",
                supportsBoxes: true,
                supportsUpscale: false,
                guidanceRange: [0, 1]
            ),
            ProviderDescriptor(
                id: "reimagine",
                name: "Reimagine",
                modelId: "reimagine-edit",
                safetyLevel: "uncensored",
                supportsBoxes: true,
                supportsUpscale: true,
                guidanceRange: [0, 1]
            )
        ]
    }
}
#endif
