#if os(iOS)
import SwiftUI
import PhotosUI

import CanvasKit
import CompareKit
import InspirationKit
import LibraryKit
import ModelKit
import PromptKit
import ShareKit

@main
public struct ImagenApp: App {
    @StateObject private var sessionManager: SupabaseSessionManager
    @StateObject private var router: ModelRouter
    @StateObject private var canvasModel = CanvasViewModel()
    @StateObject private var inspirationStore = InspirationStore()
    private let promptAssistant: PromptAssistant
    private let library = LibraryService()
    private let exporter = ShareExporter()

    public init() {
        let sessionManager = SupabaseSessionManager()
        _sessionManager = StateObject(wrappedValue: sessionManager)
        let gatewayClient = HybridGatewayClient(sessionManager: sessionManager)
        _router = StateObject(wrappedValue: ModelRouter(client: gatewayClient))
        promptAssistant = PromptAssistant(client: HybridPromptClient())
    }

    public var body: some Scene {
        WindowGroup {
            HomeView(
                router: router,
                canvasModel: canvasModel,
                sessionManager: sessionManager,
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
    @ObservedObject var sessionManager: SupabaseSessionManager
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
    @State private var isSubmittingEdit = false
    @State private var submitError: String?
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var uploadStatusMessage: String?

    private var selectedProviderMetadata: ProviderDescriptor? {
        router.providers.first(where: { $0.id == selectedProvider.rawValue })
    }

    private static let byteFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter
    }()

    private var canSubmitEdit: Bool {
        guard !currentPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !isSubmittingEdit else { return false }
        switch sessionManager.authState {
        case .authenticating, .failed:
            return false
        default:
            return true
        }
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    statusMessages
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
                            if isSubmittingEdit {
                                ProgressView()
                                    .progressViewStyle(.circular)
                            } else {
                                Label("Run", systemImage: "play.circle")
                            }
                        }
                        .disabled(!canSubmitEdit)
                    }
                }
            }
        }
        .task {
            await router.loadProviders()
            try? await sessionManager.ensureSession()
            router.startPolling()
            await inspirationStore.refresh()
            await loadDefaultSuggestions()
        }
    }

    private var providerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Model Router")
                .font(.title2.weight(.semibold))
            if router.isLoadingProviders {
                ProgressView("Loading providers…")
                    .progressViewStyle(.circular)
            }
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
            if router.lastError != nil {
                Button("Retry Provider Load") {
                    Task { await router.loadProviders() }
                }
                .buttonStyle(.bordered)
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

    @ViewBuilder
    private var statusMessages: some View {
        VStack(alignment: .leading, spacing: 8) {
            if case .authenticating = sessionManager.authState {
                StatusBanner(
                    text: "Signing in to Supabase…",
                    systemImage: "arrow.triangle.2.circlepath",
                    tint: .blue
                )
            }
            if case let .failed(message) = sessionManager.authState {
                StatusBanner(
                    text: message,
                    systemImage: "exclamationmark.triangle.fill",
                    tint: .red,
                    actionTitle: "Retry"
                ) {
                    Task {
                        sessionManager.reset()
                        try? await sessionManager.ensureSession()
                    }
                }
            }

            if let submitError {
                StatusBanner(
                    text: submitError,
                    systemImage: "exclamationmark.triangle",
                    tint: .red,
                    actionTitle: "Dismiss"
                ) {
                    self.submitError = nil
                }
            }

            if submitError == nil, let routerMessage = router.lastError?.localizedDescription {
                StatusBanner(
                    text: routerMessage,
                    systemImage: "antenna.radiowaves.left.and.right",
                    tint: .orange,
                    actionTitle: "Retry"
                ) {
                    Task { await router.loadProviders() }
                }
            }

            if let message = uploadStatusMessage {
                StatusBanner(
                    text: message,
                    systemImage: "checkmark.circle",
                    tint: .green,
                    actionTitle: "Dismiss"
                ) {
                    uploadStatusMessage = nil
                }
            }
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
            PhotosPicker(selection: $selectedPhotoItem, matching: .images, photoLibrary: .shared()) {
                Label("Select Init Image", systemImage: "photo")
            }
            .onChange(of: selectedPhotoItem) { _, newValue in
                guard let newValue else { return }
                Task {
                    if let data = try? await newValue.loadTransferable(type: Data.self) {
                        await MainActor.run {
                            canvasModel.setInitImage(data: data, remoteURL: nil)
                            uploadStatusMessage = "Selected local init image (\(Self.byteFormatter.string(fromByteCount: Int64(data.count))))"
                        }
                    }
                }
            }
            if let url = canvasModel.initImageURL {
                Label("Init image uploaded · \(url.lastPathComponent)", systemImage: "link")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if let data = canvasModel.initImageData {
                Label(
                    "Init image ready (\(Self.byteFormatter.string(fromByteCount: Int64(data.count))))",
                    systemImage: "photo.fill"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            if !canvasModel.boxes.isEmpty {
                Label("Mask will include \(canvasModel.boxes.count) boxes", systemImage: "square.dashed")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if canvasModel.initImageData != nil || canvasModel.initImageURL != nil || !canvasModel.boxes.isEmpty {
                Button(role: .destructive) {
                    canvasModel.clearAssets()
                    uploadStatusMessage = "Cleared canvas assets"
                } label: {
                    Label("Clear Assets", systemImage: "trash")
                }
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
        guard canSubmitEdit else { return }

        isSubmittingEdit = true
        submitError = nil

        Task { @MainActor in
            do {
                let (payload, imageHash) = try await buildImageEditPayload()
                try await router.submitEdit(
                    provider: selectedProvider,
                    imageHash: imageHash,
                    prompt: currentPrompt,
                    payload: payload
                )
            } catch let error as GatewayError {
                submitError = error.localizedDescription
            } catch {
                submitError = error.localizedDescription
            }
            isSubmittingEdit = false
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

    @MainActor
    private func buildImageEditPayload() async throws -> (Data, String) {
        var uploads: [String: ImageEditRequest.Metadata.Upload] = [:]
        var hashSources: [String] = []

        var initImageURLString: String?
        if let remote = canvasModel.initImageURL {
            initImageURLString = remote.absoluteString
        } else if let data = canvasModel.initImageData {
            let fileName = "init-\(UUID().uuidString).png"
            let upload = try await sessionManager.signAndUpload(
                data: data,
                fileName: fileName,
                contentType: "image/png"
            )
            canvasModel.setInitImage(data: data, remoteURL: upload.publicURL)
            uploads["init"] = metadataUpload(from: upload)
            initImageURLString = upload.publicURL.absoluteString
            hashSources.append(upload.sha256)
            uploadStatusMessage = "Uploaded init image"
        }

        var maskURLString: String?
        if let remote = canvasModel.maskImageURL {
            maskURLString = remote.absoluteString
        } else if let maskData = canvasModel.maskImageData ?? canvasModel.renderedMask() {
            let fileName = "mask-\(UUID().uuidString).png"
            let upload = try await sessionManager.signAndUpload(
                data: maskData,
                fileName: fileName,
                contentType: "image/png"
            )
            canvasModel.setMaskImage(data: maskData, remoteURL: upload.publicURL)
            uploads["mask"] = metadataUpload(from: upload)
            maskURLString = upload.publicURL.absoluteString
            hashSources.append(upload.sha256)
            uploadStatusMessage = "Uploaded mask image"
        }

        let boxes = canvasModel.boxes.map { box in
            ImageEditRequest.Metadata.Box(
                x: Double(box.rect.origin.x),
                y: Double(box.rect.origin.y),
                width: Double(box.rect.size.width),
                height: Double(box.rect.size.height),
                label: box.label,
                feather: Double(box.feather)
            )
        }

        let metadata = ImageEditRequest.Metadata(
            boxes: boxes,
            uploads: uploads,
            canvas: .init(boxCount: canvasModel.boxes.count, hasMask: maskURLString != nil)
        )

        let request = ImageEditRequest(
            prompt: currentPrompt,
            providerHint: selectedProvider.rawValue,
            initImageUrl: initImageURLString,
            maskUrl: maskURLString,
            metadata: metadata
        )

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let payload = try encoder.encode(request)
        let imageHash = hashSources.isEmpty ? UUID().uuidString : hashSources.joined(separator: ":")
        return (payload, imageHash)
    }

    private func metadataUpload(from asset: SupabaseSessionManager.UploadedAsset)
        -> ImageEditRequest.Metadata.Upload
    {
        ImageEditRequest.Metadata.Upload(
            storagePath: asset.storagePath,
            contentType: asset.contentType,
            sha256: asset.sha256,
            width: asset.width,
            height: asset.height
        )
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

private struct ImageEditRequest: Encodable {
    struct Metadata: Encodable {
        struct Box: Encodable {
            let x: Double
            let y: Double
            let width: Double
            let height: Double
            let label: String?
            let feather: Double
        }

        struct Upload: Encodable {
            let storagePath: String
            let contentType: String
            let sha256: String
            let width: Int?
            let height: Int?
        }

        struct Canvas: Encodable {
            let boxCount: Int
            let hasMask: Bool
        }

        let boxes: [Box]
        let uploads: [String: Upload]
        let canvas: Canvas
    }

    let prompt: String
    let providerHint: String
    let initImageUrl: String?
    let maskUrl: String?
    let metadata: Metadata
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

private struct StatusBanner: View {
    let text: String
    let systemImage: String
    let tint: Color
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text(text)
                .font(.footnote)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle) {
                    action()
                }
                .buttonStyle(.bordered)
                .font(.footnote.weight(.semibold))
            }
        }
        .padding(12)
        .background(tint.opacity(0.12))
        .cornerRadius(10)
    }
}

private final class HybridGatewayClient: GatewayClient {
    private let networkClient: NetworkGatewayClient

    init(sessionManager: SupabaseSessionProviding) {
        networkClient = NetworkGatewayClient(sessionProvider: sessionManager)
    }

    func enqueueEdit(provider: ModelProvider, payload: Data) async throws -> String {
        try await networkClient.enqueueEdit(provider: provider, payload: payload)
    }

    func fetchJob(id: String, provider: ModelProvider) async throws -> ProviderOutput {
        try await networkClient.fetchJob(id: id, provider: provider)
    }

    func listProviders() async throws -> [ProviderDescriptor] {
        try await networkClient.listProviders()
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
