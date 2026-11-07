import SwiftUI
import UniformTypeIdentifiers

@MainActor struct QuizLibraryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var store: QuizLibraryStore
    @State private var editing: QuizDocument?
    @State private var practice: QuizRun?
    @State private var hosting: QuizDocument?
    @State private var importing = false
    @State private var exporting = false
    @State private var exportDocument: QuizExportDocument?
    @State private var exportFilename = "likerts-quiz"
    @State private var statusMessage: String?
    @State private var fileError: String?
    @State private var confirmation: Confirmation?

    private enum Confirmation {
        case delete(QuizDocument), reset
        var title: String {
            switch self {
            case .delete: return "Delete this quiz?"
            case .reset: return "Reset your quiz library?"
            }
        }
        var message: String {
            switch self {
            case .delete: return "This removes the saved quiz from this device. Export a copy first if you want to keep it."
            case .reset: return "This replaces the unreadable library with an empty one. Its saved quizzes will be lost."
            }
        }
    }

    init(store: QuizLibraryStore? = nil) { _store = State(initialValue: store ?? QuizLibraryStore()) }

    private var actionLayout: AnyLayout {
        textSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
    }

    var body: some View {
        Group {
            if let quiz = editing {
                QuizEditorView(quiz: quiz, save: { value in
                    guard store.save(value) else { return store.operationError ?? "The quiz couldn’t be saved." }
                    editing = nil; statusMessage = "Quiz saved on this device."
                    return nil
                }, close: { editing = nil })
                .id(quiz.id)
            } else if let run = practice {
                QuizPracticeView(run: run, returnTitle: "Library", close: { practice = nil })
            } else {
                library
            }
        }
        .presentationDetents([.large])
        .fullScreenCover(item: $hosting) { quiz in
            if let configuration = LiveRoomConfiguration.current {
                LiveRoomView(configuration: configuration, quiz: quiz, close: { hosting = nil })
                    .modifier(QuizPresentationTextSize(size: textSize))
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                do {
                    if store.importQuiz(try QuizLibraryStore.readImport(from: url)) {
                        statusMessage = "Imported as a new quiz on this device."
                    }
                } catch { fileError = "That quiz file couldn’t be opened. Choose a valid Likerts quiz file no larger than 64 KB." }
            case .failure(let error):
                if (error as NSError).code != NSUserCancelledError { fileError = "That quiz file couldn’t be opened. Please try again." }
            }
        }
        .fileExporter(isPresented: $exporting, document: exportDocument, contentType: .json, defaultFilename: exportFilename) { result in
            switch result {
            case .success: statusMessage = "Quiz exported."
            case .failure(let error):
                if (error as NSError).code != NSUserCancelledError { fileError = "The quiz couldn’t be exported. Your saved quiz is unchanged." }
            }
        }
        .alert("Quiz library", isPresented: Binding(get: { fileError != nil || store.operationError != nil }, set: { if !$0 { clearError() } })) {
            Button("OK", role: .cancel) { clearError() }
        } message: { Text(fileError ?? store.operationError ?? "Please try again.") }
        .confirmationDialog(confirmation?.title ?? "", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
            if let confirmation {
                switch confirmation {
                case .delete(let quiz):
                    Button("Delete quiz", role: .destructive) { _ = store.delete(id: quiz.id); self.confirmation = nil }
                        .accessibilityIdentifier("quiz.library.confirmDelete")
                case .reset:
                    Button("Reset library", role: .destructive) { _ = store.resetLibrary(); self.confirmation = nil }
                        .accessibilityIdentifier("quiz.library.confirmReset")
                }
            }
            Button("Keep library") { confirmation = nil }
                .accessibilityIdentifier("quiz.library.keepLibrary")
        } message: { Text(confirmation?.message ?? "") }
    }

    private var library: some View {
        SheetPage(scrollIdentifier: "quiz.library.scroll") {
            HStack(alignment: .top) {
                Text("Quizzes").quizFont(.largeTitle, .black).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 12)
                CloseButton { dismiss() }
            }
            HStack(alignment: .center, spacing: 18) {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Create something worth knowing.")
                        .quizFont(.title3, .bold).fixedSize(horizontal: false, vertical: true)
                    Text("Save and practice here, or bring your people together for a live quiz.")
                        .quizFont(.subheadline, .medium).foregroundStyle(Palette.muted)
                }
                QuizNeutralArtwork(sceneKey: .make(namespace: .library,
                    identifiers: ["00000000-0000-0000-0000-000000000001"], phase: .entered))
            }
            if LiveRoomConfiguration.current == nil {
                Text("Live hosting isn’t connected in this build. You can practice and export quiz files to web or iOS.")
                    .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                    .accessibilityIdentifier("quiz.library.hostUnavailable")
            }
            if let loadError = store.loadError {
                PaperCard(color: Palette.violet.opacity(0.25)) {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Library needs attention", systemImage: "exclamationmark.circle").quizFont(.body, .heavy)
                        Text(loadError).quizFont(.subheadline, .medium)
                        QuizActionButton(title: "Retry library", symbol: "arrow.clockwise", identifier: "quiz.library.retryLoad") { store.reload() }
                        QuizActionButton(title: "Reset library", symbol: "trash", role: .destructive, identifier: "quiz.library.reset") { confirmation = .reset }
                    }
                }
            } else {
                QuizPrimaryButton(title: "Create quiz", symbol: "plus", identifier: "quiz.library.create", disabled: store.quizzes.count >= QuizLibraryStore.maximumQuizzes) {
                    statusMessage = nil; editing = .draft()
                }
                QuizActionButton(title: "Import quiz", symbol: "square.and.arrow.down", identifier: "quiz.library.import", disabled: store.quizzes.count >= QuizLibraryStore.maximumQuizzes) { importing = true }
                if store.quizzes.count >= QuizLibraryStore.maximumQuizzes {
                    Text("Your library holds 25 quizzes. Delete one before creating or importing another.")
                        .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                }
            }
            if let statusMessage {
                Label(statusMessage, systemImage: "checkmark.circle").quizFont(.subheadline, .medium)
                    .accessibilityIdentifier("quiz.library.status")
            }
            VStack(alignment: .leading, spacing: 16) {
                Text("Saved on this device").quizFont(.title2, .heavy).accessibilityAddTraits(.isHeader)
                if store.quizzes.isEmpty && store.loadError == nil {
                    Text("Your first quiz starts with a good question.").quizFont(.subheadline, .medium).foregroundStyle(Palette.muted)
                }
                ForEach(store.quizzes) { quiz in savedQuiz(quiz) }
            }
            sample
            QuizSharingNote()
        }
    }

    private func savedQuiz(_ quiz: QuizDocument) -> some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 15) {
                Text(quiz.title).quizFont(.title2, .heavy).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("quiz.library.title.\(quiz.id)")
                Text("\(quiz.questions.count) \(quiz.questions.count == 1 ? "question" : "questions")")
                    .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                QuizPrimaryButton(title: "Practice quiz", symbol: "play.fill", identifier: "quiz.library.practice.\(quiz.id)") { startPractice(quiz) }
                QuizActionButton(title: "Host live quiz", symbol: "person.2.fill", identifier: "quiz.library.host.\(quiz.id)", disabled: LiveRoomConfiguration.current == nil) { hosting = quiz }
                actionLayout {
                    editButton(quiz)
                    exportButton(quiz)
                }
                actionLayout {
                    duplicateButton(quiz)
                    deleteButton(quiz)
                }
            }
        }
    }

    private func editButton(_ quiz: QuizDocument) -> some View {
        QuizActionButton(title: "Edit", symbol: "pencil", identifier: "quiz.library.edit.\(quiz.id)") { editing = quiz; statusMessage = nil }
    }
    private func exportButton(_ quiz: QuizDocument) -> some View {
        QuizActionButton(title: "Export", symbol: "square.and.arrow.up", identifier: "quiz.library.export.\(quiz.id)") { export(quiz) }
    }
    private func duplicateButton(_ quiz: QuizDocument) -> some View {
        QuizActionButton(title: "Duplicate", symbol: "doc.on.doc", identifier: "quiz.library.duplicate.\(quiz.id)", disabled: store.quizzes.count >= QuizLibraryStore.maximumQuizzes) {
            if store.duplicate(quiz) { statusMessage = "A new copy was saved on this device." }
        }
    }
    private func deleteButton(_ quiz: QuizDocument) -> some View {
        QuizActionButton(title: "Delete", symbol: "trash", role: .destructive, identifier: "quiz.library.delete.\(quiz.id)") { confirmation = .delete(quiz) }
    }

    private var sample: some View {
        PaperCard(color: Palette.violet.opacity(0.28)) {
            VStack(alignment: .leading, spacing: 15) {
                Text("Try Little wonders").quizFont(.title2, .heavy).accessibilityAddTraits(.isHeader)
                Text("Three questions. A small spark of curiosity.").quizFont(.subheadline, .medium).foregroundStyle(Palette.muted)
                QuizPrimaryButton(title: "Practice sample", symbol: "play.fill", color: Palette.lime, foreground: Palette.ink, identifier: "quiz.library.samplePractice") { startPractice(.sample) }
                QuizActionButton(title: "Host sample live", symbol: "person.2.fill", identifier: "quiz.library.sampleHost", disabled: LiveRoomConfiguration.current == nil) { hosting = .sample }
                QuizActionButton(title: "Make a copy", symbol: "doc.on.doc", identifier: "quiz.library.sampleCopy", disabled: !store.canModify || store.quizzes.count >= QuizLibraryStore.maximumQuizzes) {
                    do { editing = try QuizDocument.sample.duplicated(); statusMessage = nil }
                    catch { fileError = "The sample couldn’t be opened. Please try again." }
                }
                QuizLibrarySceneArtwork()
            }
        }
    }

    private func startPractice(_ quiz: QuizDocument) {
        do { practice = try QuizRun(quiz: quiz) }
        catch { fileError = "This quiz couldn’t start. Edit and check its questions first." }
    }
    private func export(_ quiz: QuizDocument) {
        do {
            exportDocument = try QuizExportDocument(quiz: quiz)
            exportFilename = QuizExportDocument.filename(for: quiz.title)
            exporting = true
        } catch { fileError = "This quiz couldn’t be exported. Edit and check its questions first." }
    }
    private func clearError() { fileError = nil; store.dismissOperationError() }
}
