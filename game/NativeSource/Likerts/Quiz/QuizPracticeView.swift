import SwiftUI
import Combine

struct QuizPracticeView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .body) private var badgeSize: CGFloat = 36
    @State private var run: QuizRun
    @State private var practiceRunID = UUID()
    @State private var selection: Int?
    @State private var now = Date()
    @State private var confirmLeave = false
    private let returnTitle: String
    private let close: () -> Void
    private let clock = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    init(run: QuizRun, returnTitle: String, close: @escaping () -> Void) {
        _run = State(initialValue: run)
        self.returnTitle = returnTitle
        self.close = close
    }

    var body: some View {
        SheetPage(scrollIdentifier: "quiz.practice.scroll") {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(run.quiz.title).quizFont(.title2, .heavy).fixedSize(horizontal: false, vertical: true)
                    Text("Practice quiz").quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                CloseButton { requestClose() }
            }
            if run.phase == .finished { results }
            else if let question = run.currentQuestion { round(question) }
        }
        .interactiveDismissDisabled(run.phase != .finished)
        .confirmationDialog("Leave this practice?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave practice", role: .destructive, action: close).accessibilityIdentifier("quiz.practice.confirmLeave")
            Button("Keep playing") { confirmLeave = false }
                .accessibilityIdentifier("quiz.practice.keepPlaying")
        } message: { Text("Your current practice score won’t be saved. Your quiz stays in the library.") }
        .onReceive(clock) { date in
            guard run.phase == .answer else { return }
            now = date
            _ = run.advance(now: date)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { now = Date(); _ = run.advance(now: now) }
        }
    }

    private func round(_ question: QuizQuestion) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 12) {
                QuizNeutralArtwork(height: 44, sceneKey: run.phase == .answer ? practiceSceneKey : nil)
                Text("Question \(run.index + 1) of \(run.quiz.questions.count)").quizFont(.subheadline, .semibold)
                Spacer(minLength: 0)
                if let remaining = run.remainingSeconds(at: now) {
                    Label("\(remaining)s", systemImage: "timer").quizFont(.callout, .bold)
                        .accessibilityLabel("Time remaining").accessibilityValue("\(remaining) seconds")
                        .accessibilityIdentifier("quiz.practice.countdown")
                } else if run.phase == .answer {
                    Text("Untimed").quizFont(.subheadline, .medium).foregroundStyle(Palette.muted)
                }
            }
            Text(question.prompt).quizFont(.title, .heavy).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("quiz.practice.prompt")
            VStack(spacing: 12) {
                ForEach(question.answers.indices, id: \.self) { index in choice(question, index: index) }
            }
            if run.phase == .answer {
                QuizPrimaryButton(title: "Lock answer", symbol: "lock.fill", identifier: "quiz.practice.lock", disabled: selection == nil) {
                    guard let selection else { return }
                    now = Date(); _ = run.submit(answer: selection, now: now)
                }
                Text("1,000 points for a correct answer. No speed bonus.")
                    .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
            } else {
                reveal(question)
                QuizPrimaryButton(title: run.index + 1 == run.quiz.questions.count ? "See results" : "Next question", identifier: "quiz.practice.next") {
                    now = Date(); _ = run.next(now: now); selection = nil
                }
            }
        }
    }

    private func choice(_ question: QuizQuestion, index: Int) -> some View {
        let revealed = run.phase == .reveal
        let correct = revealed && question.correctAnswer == index
        let selected = revealed ? run.selectedAnswer == index : selection == index
        let layout = textSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        return Button {
            guard run.phase == .answer else { return }
            now = Date()
            if !run.advance(now: now) { selection = index }
        } label: {
            layout {
                Text(["A", "B", "C", "D"][index]).quizFont(.callout, .heavy)
                    .frame(width: badgeSize, height: badgeSize).background(Palette.ink, in: Circle())
                    .foregroundStyle(.white).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(question.answers[index]).quizFont(.body, .semibold).fixedSize(horizontal: false, vertical: true)
                    if correct { Text("Correct answer").quizFont(.footnote, .bold) }
                    else if revealed && selected { Text("Your answer").quizFont(.footnote, .bold) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected && !revealed { Image(systemName: "checkmark.circle.fill").accessibilityHidden(true) }
            }
            .padding(18).frame(minHeight: 64).frame(maxWidth: .infinity, alignment: .leading)
            .background(correct ? Palette.lime : revealed && selected ? Palette.coral.opacity(0.22) : .white,
                        in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(selected ? Palette.ink : Palette.ink.opacity(0.2), lineWidth: selected ? 2 : 1))
            .foregroundStyle(Palette.ink).contentShape(RoundedRectangle(cornerRadius: 22))
        }
        .buttonStyle(SquishButtonStyle()).disabled(revealed)
        .accessibilityLabel("Answer \(["A", "B", "C", "D"][index]). \(question.answers[index])\(correct ? ". Correct answer." : revealed && selected ? ". Your answer." : "")")
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(.isButton)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("quiz.practice.answer.\(index)")
    }

    private func reveal(_ question: QuizQuestion) -> some View {
        let result = run.results.last
        return PaperCard(color: result?.correct == true ? Palette.lime : Palette.violet.opacity(0.3)) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 16) {
                    QuizNeutralArtwork(height: 54, sceneKey: practiceSceneKey)
                    VStack(alignment: .leading, spacing: 12) {
                        Text(result?.timedOut == true ? "Time’s up" : result?.correct == true ? "Correct!" : "Not quite")
                            .quizFont(.title, .heavy).accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("quiz.practice.feedback")
                        Text("\(result?.points ?? 0) points").quizFont(.body, .bold)
                            .accessibilityIdentifier("quiz.practice.roundPoints")
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                if !question.explanation.isEmpty { Text(question.explanation).quizFont(.callout, .medium) }
            }
        }
    }

    private var results: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Quiz complete").quizFont(.largeTitle, .black).accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("quiz.practice.complete")
            PaperCard(color: Palette.lime) {
                VStack(alignment: .leading, spacing: 13) {
                    Text("\(run.correctCount) of \(run.quiz.questions.count) correct")
                        .quizFont(.title, .heavy).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("quiz.practice.correctCount")
                    Text("\(run.score.formatted()) points").quizFont(.title2, .bold)
                        .accessibilityIdentifier("quiz.practice.score")
                }
            }
            QuizPrimaryButton(title: "Replay quiz", symbol: "arrow.clockwise", identifier: "quiz.practice.replay") {
                if let replay = try? QuizRun(quiz: run.quiz) { run = replay; practiceRunID = UUID(); selection = nil; now = Date() }
            }
            QuizActionButton(title: returnTitle, symbol: "arrow.left", identifier: "quiz.practice.return", action: close)
            QuizCastArtwork(celebrating: run.correctCount > 0, sceneKey: practiceSceneKey)
            Text("Your quiz stays on this device. This practice score isn’t saved.")
                .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
        }
    }

    private func requestClose() {
        if run.phase == .finished { close() } else { confirmLeave = true }
    }

    private var practiceSceneKey: QuizSceneKey? {
        let phase: QuizScenePhase
        switch run.phase { case .answer: phase = .answer; case .reveal: phase = .reveal; case .finished: phase = .finished }
        let identifiers = [practiceRunID.uuidString.lowercased(), run.quiz.id] + (run.currentQuestion.map { [$0.id] } ?? [])
        return .make(namespace: .practice, identifiers: identifiers, phase: phase)
    }
}
