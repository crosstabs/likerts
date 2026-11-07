import SwiftUI

struct QuizEditorView: View {
    @Environment(\.dynamicTypeSize) private var presentedTextSize
    @State private var draft: QuizDocument
    @State private var selectedQuestion = 0
    @State private var validationMessage: String?
    @State private var confirmDiscard = false
    @State private var practice: QuizRun?
    @AccessibilityFocusState private var validationFocused: Bool
    @FocusState private var focusedField: Field?
    private let original: QuizDocument
    private let save: (QuizDocument) -> String?
    private let close: () -> Void
    private enum Field: Hashable {
        case title, prompt(String), answer(String, Int), explanation(String)
    }

    init(quiz: QuizDocument, save: @escaping (QuizDocument) -> String?, close: @escaping () -> Void) {
        _draft = State(initialValue: quiz)
        original = quiz
        self.save = save
        self.close = close
    }

    private var changed: Bool { draft != original }

    private var actionLayout: AnyLayout {
        presentedTextSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
    }

    private var headerLayout: AnyLayout {
        presentedTextSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 5))
            : AnyLayout(HStackLayout(spacing: 10))
    }

    var body: some View {
        SheetPage(scrollIdentifier: "quiz.editor.scroll") {
            HStack(alignment: .center, spacing: 18) {
                Text("Make a quiz").quizFont(.largeTitle, .black).accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                QuizNeutralArtwork(height: 70, sceneKey: .make(namespace: .editor, identifiers: [draft.id], phase: .entered))
            }
            headerLayout {
                cancelButton
                Spacer(minLength: 0)
                saveButton
            }
            VStack(alignment: .leading, spacing: 9) {
                Text("Quiz title").quizFont(.subheadline, .semibold)
                TextField("Give your quiz a title", text: $draft.title, axis: .vertical)
                    .lineLimit(1...)
                    .modifier(QuizFieldStyle()).textInputAutocapitalization(.sentences)
                    .focused($focusedField, equals: .title)
                    .accessibilityLabel("Quiz title").accessibilityIdentifier("quiz.editor.title")
            }
            if let validationMessage {
                Label(validationMessage, systemImage: "exclamationmark.circle")
                    .quizFont(.subheadline, .semibold).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("quiz.editor.error").accessibilityFocused($validationFocused)
            }
            questionNavigation
            questionEditor
            QuizPrimaryButton(title: "Practice quiz", symbol: "play.fill", color: Palette.lime, foreground: Palette.ink, identifier: "quiz.editor.practice") {
                focusedField = nil
                do { practice = try QuizRun(quiz: draft.normalized()); validationMessage = nil }
                catch { show(error) }
            }
            QuizSharingNote()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if focusedField != nil {
                HStack {
                    Spacer(minLength: 8)
                    Button { focusedField = nil } label: {
                        Text("Done").font(.body).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).accessibilityIdentifier("quiz.editor.done")
                }
                .padding(.horizontal, 28).padding(.vertical, 8)
                .frame(maxWidth: 550).frame(maxWidth: .infinity)
                .background(Palette.cream).foregroundStyle(Palette.ink)
            }
        }
        .interactiveDismissDisabled(changed)
        .confirmationDialog("Discard your changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive, action: close).accessibilityIdentifier("quiz.editor.discard")
            Button("Keep editing") { confirmDiscard = false }
                .accessibilityIdentifier("quiz.editor.keepEditing")
        } message: { Text("Changes made here haven’t been saved to your library.") }
        .fullScreenCover(isPresented: Binding(get: { practice != nil }, set: { if !$0 { practice = nil } })) {
            if let practice {
                QuizPracticeView(run: practice, returnTitle: "Back to editor", close: { self.practice = nil })
                    .modifier(QuizPresentationTextSize(size: presentedTextSize))
            }
        }
        .onChange(of: draft) { _, _ in validationMessage = nil }
    }

    private var cancelButton: some View {
        QuizActionButton(title: "Cancel", identifier: "quiz.editor.cancel") {
            focusedField = nil
            if changed { confirmDiscard = true } else { close() }
        }
    }
    private var saveButton: some View {
        QuizActionButton(title: "Save quiz", symbol: "checkmark", identifier: "quiz.editor.save") {
            focusedField = nil
            do {
                let valid = try draft.normalized()
                validationMessage = save(valid)
                if validationMessage != nil { validationFocused = true }
            } catch { show(error) }
        }
    }

    private var questionNavigation: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("\(draft.questions.count) \(draft.questions.count == 1 ? "question" : "questions")")
                .quizFont(.body, .heavy).accessibilityIdentifier("quiz.editor.questionCount")
            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    ForEach(draft.questions.indices, id: \.self) { index in
                        Button { focusedField = nil; selectedQuestion = index } label: {
                            Text("Question \(index + 1)").quizFont(.subheadline, .semibold)
                                .frame(minHeight: 44).padding(.horizontal, 15)
                                .background(selectedQuestion == index ? Palette.violet.opacity(0.5) : Palette.cream,
                                            in: RoundedRectangle(cornerRadius: 15))
                                .overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(Palette.ink.opacity(0.2)))
                        }
                        .buttonStyle(SquishButtonStyle())
                        .accessibilityAddTraits(selectedQuestion == index ? .isSelected : [])
                        .accessibilityIdentifier("quiz.editor.question.\(index)")
                    }
                }
            }
            QuizActionButton(title: "Add question", symbol: "plus", identifier: "quiz.editor.addQuestion", disabled: draft.questions.count >= 30) {
                focusedField = nil
                draft.questions.append(.draft())
                selectedQuestion = draft.questions.count - 1
            }
            VStack(alignment: .leading, spacing: 8) {
                moveUpButton
                moveDownButton
                removeQuestionButton
            }
        }
    }

    private var moveUpButton: some View {
        QuizActionButton(title: "Move up", symbol: "arrow.up", identifier: "quiz.editor.moveUp", disabled: selectedQuestion == 0) {
            focusedField = nil
            guard selectedQuestion > 0 else { return }
            draft.questions.swapAt(selectedQuestion, selectedQuestion - 1)
            selectedQuestion -= 1
        }
    }
    private var moveDownButton: some View {
        QuizActionButton(title: "Move down", symbol: "arrow.down", identifier: "quiz.editor.moveDown", disabled: selectedQuestion + 1 >= draft.questions.count) {
            focusedField = nil
            guard selectedQuestion + 1 < draft.questions.count else { return }
            draft.questions.swapAt(selectedQuestion, selectedQuestion + 1)
            selectedQuestion += 1
        }
    }
    private var removeQuestionButton: some View {
        QuizActionButton(title: "Remove question", symbol: "minus", identifier: "quiz.editor.removeQuestion", disabled: draft.questions.count <= 1) {
            focusedField = nil
            guard draft.questions.count > 1 else { return }
            draft.questions.remove(at: selectedQuestion)
            selectedQuestion = min(selectedQuestion, draft.questions.count - 1)
        }
    }

    private var questionEditor: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 20) {
                Text("Question \(selectedQuestion + 1)").quizFont(.title2, .heavy).accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 9) {
                    Text("Question").quizFont(.subheadline, .semibold)
                    TextField("What would you like to ask?", text: textBinding(\.prompt), axis: .vertical)
                        .lineLimit(2...5).modifier(QuizFieldStyle())
                        .focused($focusedField, equals: .prompt(draft.questions[selectedQuestion].id))
                        .accessibilityLabel("Question").accessibilityIdentifier("quiz.editor.prompt")
                }
                Text("Choose the correct answer").quizFont(.subheadline, .semibold)
                ForEach(draft.questions[selectedQuestion].answers.indices, id: \.self) { answer in answerEditor(answer) }
                actionLayout {
                    addAnswerButton
                    removeAnswerButton
                }
                timeLimitMenu
                VStack(alignment: .leading, spacing: 9) {
                    Text("Explanation").quizFont(.subheadline, .semibold)
                    TextField("Optional: explain the answer", text: textBinding(\.explanation), axis: .vertical)
                        .lineLimit(2...5).modifier(QuizFieldStyle())
                        .focused($focusedField, equals: .explanation(draft.questions[selectedQuestion].id))
                        .accessibilityLabel("Explanation").accessibilityIdentifier("quiz.editor.explanation")
                }
            }
        }
    }

    private func answerEditor(_ index: Int) -> some View {
        let marked = draft.questions[selectedQuestion].correctAnswer == index
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                draft.questions[selectedQuestion].correctAnswer = index
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: marked ? "checkmark.circle.fill" : "circle").accessibilityHidden(true)
                    Text(marked ? "Answer \(index + 1) · Correct answer" : "Answer \(index + 1)")
                        .quizFont(.subheadline, .semibold).fixedSize(horizontal: false, vertical: true)
                }
                .frame(minHeight: 44, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mark answer \(index + 1) as correct")
            .accessibilityValue(marked ? "Correct answer" : "Not marked correct")
            .accessibilityAddTraits(marked ? .isSelected : [])
            .accessibilityIdentifier("quiz.editor.correct.\(index)")
            TextField("Answer \(index + 1)", text: answerBinding(index))
                .modifier(QuizFieldStyle()).textInputAutocapitalization(.sentences)
                .focused($focusedField, equals: .answer(draft.questions[selectedQuestion].id, index))
                .accessibilityLabel("Answer \(index + 1)").accessibilityIdentifier("quiz.editor.answer.\(index)")
        }
        .padding(14)
        .background(marked ? Palette.lime : Palette.cream, in: RoundedRectangle(cornerRadius: 21))
    }

    private var addAnswerButton: some View {
        QuizActionButton(title: "Add answer", symbol: "plus", identifier: "quiz.editor.addAnswer", disabled: draft.questions[selectedQuestion].answers.count >= 4) {
            guard draft.questions[selectedQuestion].answers.count < 4 else { return }
            draft.questions[selectedQuestion].answers.append("")
        }
    }

    private var timeLimitMenu: some View {
        let selected = timeBinding.wrappedValue
        let title = selected == 0 ? "Untimed" : "\(selected) seconds"
        return VStack(alignment: .leading, spacing: 9) {
            Text("Time limit").quizFont(.subheadline, .semibold)
            Menu {
                ForEach(QuizDocument.allowedTimeLimits, id: \.self) { seconds in
                    Button {
                        timeBinding.wrappedValue = seconds
                    } label: {
                        if seconds == selected {
                            Label(seconds == 0 ? "Untimed" : "\(seconds) seconds", systemImage: "checkmark")
                        } else {
                            Text(seconds == 0 ? "Untimed" : "\(seconds) seconds")
                        }
                    }
                }
            } label: {
                HStack(spacing: 12) {
                    Text(title).quizFont(.callout, .semibold)
                    Image(systemName: "chevron.up.chevron.down").accessibilityHidden(true)
                }
                .frame(minWidth: 44, minHeight: 44)
                .padding(.horizontal, 14)
                .background(Palette.cream, in: RoundedRectangle(cornerRadius: 14))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(Palette.ink)
            .accessibilityLabel("Time limit").accessibilityValue(title)
            .accessibilityIdentifier("quiz.editor.timeLimit")
        }
    }
    private var removeAnswerButton: some View {
        QuizActionButton(title: "Remove last answer", symbol: "minus", identifier: "quiz.editor.removeAnswer", disabled: draft.questions[selectedQuestion].answers.count <= 2) {
            focusedField = nil
            guard draft.questions[selectedQuestion].answers.count > 2 else { return }
            draft.questions[selectedQuestion].answers.removeLast()
            if draft.questions[selectedQuestion].correctAnswer >= draft.questions[selectedQuestion].answers.count {
                draft.questions[selectedQuestion].correctAnswer = -1
            }
        }
    }

    private func textBinding(_ keyPath: WritableKeyPath<QuizQuestion, String>) -> Binding<String> {
        let id = draft.questions[selectedQuestion].id
        return Binding(get: { draft.questions.first(where: { $0.id == id })?[keyPath: keyPath] ?? "" }, set: { value in
            guard let index = draft.questions.firstIndex(where: { $0.id == id }) else { return }
            draft.questions[index][keyPath: keyPath] = value
        })
    }
    private func answerBinding(_ answer: Int) -> Binding<String> {
        let id = draft.questions[selectedQuestion].id
        return Binding(get: {
            guard let question = draft.questions.first(where: { $0.id == id }), question.answers.indices.contains(answer) else { return "" }
            return question.answers[answer]
        }, set: { value in
            guard let index = draft.questions.firstIndex(where: { $0.id == id }), draft.questions[index].answers.indices.contains(answer) else { return }
            draft.questions[index].answers[answer] = value
        })
    }
    private var timeBinding: Binding<Int> {
        let id = draft.questions[selectedQuestion].id
        return Binding(get: { draft.questions.first(where: { $0.id == id })?.timeLimitSeconds ?? 20 }, set: { value in
            guard let index = draft.questions.firstIndex(where: { $0.id == id }) else { return }
            draft.questions[index].timeLimitSeconds = value
        })
    }

    private func show(_ error: Error) {
        if let error = error as? QuizValidationError, error.path.hasPrefix("questions["),
           let end = error.path.firstIndex(of: "]"),
           let index = Int(error.path[error.path.index(error.path.startIndex, offsetBy: 10)..<end]),
           draft.questions.indices.contains(index) { selectedQuestion = index }
        validationMessage = error.localizedDescription
        validationFocused = true
    }
}
