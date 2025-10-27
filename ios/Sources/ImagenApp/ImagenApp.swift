#if os(iOS)
import SwiftUI

import CanvasKit
import CompareKit
import InspirationKit
import LibraryKit
import ModelKit
import PromptKit
import ShareKit

@main
public struct ImagenApp: App {
    @StateObject private var router = ModelRouter(client: HybridGatewayClient())
    @StateObject private var canvasModel = CanvasViewModel()
    @StateObject private var inspirationStore = InspirationStore()
    private let promptAssistant: PromptAssistant
    private let library = LibraryService()
    private let exporter = ShareExporter()

    public init() {
        promptAssistant = PromptAssistant(client: HybridPromptClient())
    }

    public var body: some Scene {
        WindowGroup {
            HomeView(
                router: router,
                canvasModel: canvasModel,
                promptAssistant: promptAssistant,
                inspirationStore: inspirationStore,
                library: library,
                exporter: exporter
            )
        }
    }
}

private struct HomeView: View {
    @ObservedObject var router: ModelRouter
    @ObservedObject var canvasModel: CanvasViewModel
    @ObservedObject var inspirationStore: InspirationStore
    let promptAssistant: PromptAssistant
    let library: LibraryService
    let exporter: ShareExporter

    @State private var currentPrompt: String = ""
    @State private var suggestions: [PromptSuggestion] = []
    @State private var promptSafetyLevel: String = "balanced"
    @State private var isRequestingPrompts = false
    @State private var promptError: String?
    @State private var exportMessage: String?
    @State private var selectedProvider: ModelProvider = .openai

    private var selectedProviderMetadata: ProviderDescriptor? {
        router.providers.first(where: { $0.id == selectedProvider.rawValue })
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    providerSection
                    promptComposer
                    suggestionChips
                    canvasSection
                    exportActions
                    jobTimeline
                    inspirationSection
                }
                .padding()
                .navigationTitle("Studio")
                .toolbar {
                    ToolbarItemGroup(placement: .navigationBarTrailing) {
                        Button(action: addBox) {
                            Label("Add Box", systemImage: "rectangle.badge.plus")
                        }
                        Button(action: runSelectedProvider) {
                            Label("Run", systemImage: "play.circle")
                        }
                        .disabled(currentPrompt.isEmpty)
                    }
                }
            }
        }
        .task {
            await router.loadProviders()
            router.startPolling()
            await inspirationStore.refresh()
            await loadDefaultSuggestions()
        }
    }

    private var providerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Model Router")
                .font(.title2.weight(.semibold))
            Picker("Provider", selection: $selectedProvider) {
                ForEach(ModelProvider.allCases, id: \.self) { provider in
                    Text(provider.rawValue.capitalized).tag(provider)
                }
            }
            .pickerStyle(.segmented)
            if let metadata = selectedProviderMetadata {
                HStack {
                    Label("Model: \(metadata.modelId)", systemImage: "cpu")
                    Spacer()
                    Label("Safety: \(metadata.safetyLevel.capitalized)", systemImage: "shield")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var promptComposer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Intent")
                .font(.title2.weight(.semibold))
            TextField("Describe your edit...", text: $currentPrompt, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button(action: requestSuggestions) {
                    if isRequestingPrompts {
                        ProgressView()
                            .progressViewStyle(.circular)
                    } else {
                        Label("Suggest Prompts", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRequestingPrompts || currentPrompt.isEmpty)
                if let promptError {
                    Text(promptError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                } else {
                    Text("Safety: \(promptSafetyLevel.capitalized)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(suggestions) { suggestion in
                    Button {
                        currentPrompt = suggestion.text
                        promptSafetyLevel = suggestion.safetyLevel
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(suggestion.text)
                                .font(.subheadline)
                            Text("guidance: \(String(format: "%.2f", suggestion.guidance))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(10)
                        .background(Color.blue.opacity(0.12))
                        .cornerRadius(10)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var canvasSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Canvas")
                .font(.title2.weight(.semibold))
            CanvasPreview(canvasModel: canvasModel)
                .frame(height: 240)
                .background(Color.black.opacity(0.05))
                .cornerRadius(16)
                .overlay(alignment: .bottomTrailing) {
                    Text("Boxes: \(canvasModel.boxes.count)")
                        .font(.caption)
                        .padding(6)
                        .background(Color.black.opacity(0.5))
                        .foregroundColor(.white)
                        .cornerRadius(8)
                        .padding(8)
                }
        }
    }

    private var exportActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Asset Library")
                .font(.title2.weight(.semibold))
            HStack {
                Button {
                    Task {
                        guard let url = URL(string: "https://assets.local/\(UUID().uuidString)") else { return }
                        let asset = LibraryAsset(
                            type: .generated,
                            url: url,
                            metadata: ["prompt": currentPrompt]
                        )
                        await library.store(asset)
                    }
                } label: {
                    Label("Save Snapshot", systemImage: "square.and.arrow.down")
                }
                Button {
                    if let data = currentPrompt.data(using: .utf8) {
                        let result = try? exporter.export(data: data, options: ShareOptions(format: .recipeJSON))
                        exportMessage = result?.type.identifier
                    }
                } label: {
                    Label("Export Recipe", systemImage: "square.and.arrow.up")
                }
            }
            if let exportMessage {
                Text("Exported as: \(exportMessage)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var jobTimeline: some View {
        VStack(alignment: .leading, spacing: 8) {
            if router.pendingJobs.isEmpty {
                EmptyView()
            } else {
                Text("Job Timeline")
                    .font(.title2.weight(.semibold))
                ForEach(router.pendingJobs) { job in
                    HStack {
                        VStack(alignment: .leading) {
                            Text("#\(job.id.prefix(8)) · \(job.provider.rawValue.capitalized)")
                                .font(.subheadline.weight(.semibold))
                            Text(job.prompt)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        StatusBadge(status: job.status)
                    }
                    .padding(12)
                    .background(Color.gray.opacity(0.08))
                    .cornerRadius(12)
                }
            }
        }
    }

    private var inspirationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Trending Prompts")
                .font(.title2.weight(.semibold))
            if inspirationStore.trends.isEmpty {
                Text("No trends yet · pull to refresh")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 16) {
                        ForEach(inspirationStore.trends) { trend in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(trend.term)
                                    .font(.subheadline.weight(.semibold))
                                Text(trend.provider.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Button("Try it") {
                                    currentPrompt = trend.term
                                    selectedProvider = ModelProvider(rawValue: trend.provider) ?? .openai
                                }
                                .buttonStyle(.bordered)
                            }
                            .padding(12)
                            .background(Color.orange.opacity(0.12))
                            .cornerRadius(12)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func requestSuggestions() {
        isRequestingPrompts = true
        promptError = nil
        Task {
            defer { isRequestingPrompts = false }
            do {
                let payload = try await promptAssistant.suggestPrompts(
                    for: currentPrompt,
                    boxes: canvasModel.boxes.count,
                    provider: selectedProvider.rawValue
                )
                suggestions = payload.suggestions
                promptSafetyLevel = payload.safetyLevel
            } catch {
                promptError = "Prompt assistant offline"
            }
        }
    }

    private func runSelectedProvider() {
        guard !currentPrompt.isEmpty,
              let payload = try? JSONSerialization.data(withJSONObject: [
                  "provider": selectedProvider.rawValue,
                  "imageRef": "stub://placeholder",
                  "prompt": currentPrompt,
                  "boxes": canvasModel.boxes.map { box in
                      [
                          "x": box.rect.origin.x,
                          "y": box.rect.origin.y,
                          "w": box.rect.size.width,
                          "h": box.rect.size.height,
                          "label": box.label ?? "region"
                      ]
                  }
              ])
        else { return }

        Task {
            try? await router.submitEdit(
                provider: selectedProvider,
                imageHash: UUID().uuidString,
                prompt: currentPrompt,
                payload: payload
            )
        }
    }

    private func addBox() {
        let originX = Double.random(in: 0.05...0.6)
        let originY = Double.random(in: 0.05...0.6)
        let width = Double.random(in: 0.2...0.35)
        let height = Double.random(in: 0.2...0.35)
        let rect = CGRect(x: originX, y: originY, width: width, height: height)
        canvasModel.addBox(rect: rect, label: "Box \(canvasModel.boxes.count + 1)")
    }

    private func loadDefaultSuggestions() async {
        do {
            let payload = try await promptAssistant.suggestPrompts(
                for: "enhance lighting",
                boxes: 0,
                provider: selectedProvider.rawValue
            )
            suggestions = payload.suggestions
            promptSafetyLevel = payload.safetyLevel
        } catch {
            // Ignore; keep defaults empty.
        }
    }
}

private struct CanvasPreview: View {
    @ObservedObject var canvasModel: CanvasViewModel

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                Color.gray.opacity(0.18)
                ForEach(canvasModel.boxes) { box in
                    BoxOverlay(box: box, canvasSize: geometry.size)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private struct BoxOverlay: View {
        let box: EditBox
        let canvasSize: CGSize

        private var frame: CGRect {
            CGRect(
                x: box.rect.origin.x * canvasSize.width,
                y: box.rect.origin.y * canvasSize.height,
                width: box.rect.size.width * canvasSize.width,
                height: box.rect.size.height * canvasSize.height
            )
        }

        var body: some View {
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .strokeBorder(Color.yellow, lineWidth: 2)
                    .background(Color.yellow.opacity(0.15))
                    .frame(width: frame.width, height: frame.height)
                    .position(x: frame.midX, y: frame.midY)
                if let label = box.label {
                    Text(label)
                        .font(.caption2)
                        .padding(4)
                        .background(Color.black.opacity(0.6))
                        .foregroundColor(.white)
                        .cornerRadius(4)
                        .position(x: frame.minX + 8, y: frame.minY + 12)
                }
            }
        }
    }
}

private struct StatusBadge: View {
    let status: JobStatus

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(backgroundColor)
            .foregroundStyle(.white)
            .cornerRadius(12)
    }

    private var backgroundColor: Color {
        switch status {
        case .queued:
            return .orange
        case .running:
            return .blue
        case .succeeded:
            return .green
        case .failed:
            return .red
        }
    }
}

private final class HybridGatewayClient: GatewayClient {
    private let networkClient = NetworkGatewayClient()
    private let stubClient = StubGatewayClient()

    func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String {
        do {
            return try await networkClient.enqueueEdit(provider: provider, payload: payload)
        } catch {
            return try await stubClient.enqueueEdit(provider: provider, payload: payload)
        }
    }

    func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput {
        do {
            return try await networkClient.fetchJob(id: id, provider: provider)
        } catch {
            return try await stubClient.fetchJob(id: id, provider: provider)
        }
    }

    func listProviders() async throws -> [ProviderDescriptor] {
        do {
            let remote = try await networkClient.listProviders()
            if remote.isEmpty {
                return try await stubClient.listProviders()
            }
            return remote
        } catch {
            return try await stubClient.listProviders()
        }
    }
}

private final class StubGatewayClient: GatewayClient {
    private var results: [String: ProviderOutput] = [:]

    func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String {
        _ = payload
        let jobId = UUID().uuidString
        results[jobId] = ProviderOutput(
            previews: [URL(string: "stub://preview/\(provider.rawValue)/\(jobId)")!],
            outputs: [URL(string: "stub://output/\(provider.rawValue)/\(jobId)")!],
            status: .succeeded
        )
        return jobId
    }

    func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput {
        if let output = results[id] {
            return output
        }
        return ProviderOutput(previews: [], outputs: [], status: .queued)
    }

    func listProviders() async throws -> [ProviderDescriptor] {
        ModelProvider.allCases.map { provider in
            ProviderDescriptor(
                id: provider.rawValue,
                name: provider.rawValue,
                modelId: "stub-\(provider.rawValue)",
                safetyLevel: provider == .reimagine ? "uncensored" : "balanced",
                supportsBoxes: true,
                supportsUpscale: provider == .seedream || provider == .reimagine,
                guidanceRange: [0, 1]
            )
        }
    }
}

private final class HybridPromptClient: PromptClient {
    private let network = NetworkPromptClient()

    func fetchSuggestions(intent: String, boxes: Int, provider: String?) async throws -> PromptSuggestionPayload {
        do {
            return try await network.fetchSuggestions(intent: intent, boxes: boxes, provider: provider)
        } catch {
            return PromptSuggestionPayload(
                provider: provider ?? "openai",
                suggestions: FallbackPromptComposer.defaultSuggestions(for: intent, boxes: boxes, provider: provider),
                safetyLevel: "balanced"
            )
        }
    }
}

private enum FallbackPromptComposer {
    static func defaultSuggestions(for intent: String, boxes: Int, provider: String?) -> [PromptSuggestion] {
        let prefix = boxes > 0 ? "apply inside region: " : ""
        let normalized = intent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return [] }
        return [
            PromptSuggestion(text: "\(prefix)\(normalized) with cinematic lighting", guidance: 0.72, strength: 0.55, safetyLevel: "balanced"),
            PromptSuggestion(text: "\(prefix)\(normalized) with soft shadows", guidance: 0.64, strength: 0.48, safetyLevel: "balanced"),
            PromptSuggestion(text: "\(prefix)\(normalized) tuned for \(provider ?? "openai")", guidance: 0.6, strength: 0.5, safetyLevel: "balanced")
        ]
    }
}
#else
import Foundation

@main
public struct ImagenAppMacPlaceholder {
    public static func main() {
        print("ImagenApp is designed for iOS builds.")
    }
}
#endif
