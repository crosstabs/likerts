import SwiftUI

@main
struct LikertsApp: App {
    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-ui-testing") && args.contains("-content-safety-reset") { LocalContentSafety().clear() }
        #endif
    }
    var body: some Scene {
        WindowGroup {
            appContent
                .modifier(TestingTextSize())
                .preferredColorScheme(.light)
                .tint(Palette.ink)
        }
    }
    @ViewBuilder private var appContent: some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-scene-review") { SceneReviewHarness() }
        else if ProcessInfo.processInfo.arguments.contains("-messages-harness") { MessagesHarnessView() }
        else if let position = ProcessInfo.processInfo.arguments.firstIndex(of: "-motion-qa"),
                ProcessInfo.processInfo.arguments.indices.contains(position + 1),
                let id = Int(ProcessInfo.processInfo.arguments[position + 1]), TopicPlayLibrary.round(id: id) != nil {
            ContentView(qaChallenge: try? Challenge(name: "Alex", promptIDs: [id, 1, 2, 3, 4], answers: [4, 1, 2, 3, 5]))
        }
        else if ProcessInfo.processInfo.arguments.contains("-story-results-qa") {
            ContentView(qaChallenge: try? Challenge(name: "Alex", promptIDs: [1005, 1351, 1108, 1208, 1009], answers: [4, 1, 2, 3, 5]), qaCompleted: true)
        }
        else if let route = ["-story-qa", "-story-answer-qa"].first(where: { ProcessInfo.processInfo.arguments.contains($0) }),
                let position = ProcessInfo.processInfo.arguments.firstIndex(of: route),
                ProcessInfo.processInfo.arguments.indices.contains(position + 1),
                let id = Int(ProcessInfo.processInfo.arguments[position + 1]), VignetteBank.spec(id: id) != nil {
            ContentView(qaChallenge: try? Challenge(name: "Alex", promptIDs: [id, 1, 2, 3, 4], answers: [4, 1, 2, 3, 5]), qaAnswering: route == "-story-answer-qa")
        }
        else if ProcessInfo.processInfo.arguments.contains("-totem-qa") {
            ContentView(qaChallenge: try? Challenge(name: "Alex", promptIDs: [28, 1, 2, 3, 4], answers: [4, 1, 2, 3, 5]))
        }
        else if let position = ProcessInfo.processInfo.arguments.firstIndex(of: "-topic-qa"),
                ProcessInfo.processInfo.arguments.indices.contains(position + 1),
                let topic = TopicID(rawValue: ProcessInfo.processInfo.arguments[position + 1]) {
            let first = 1001 + topic.ordinal * 50
            ContentView(qaChallenge: try? Challenge(name: "Alex", promptIDs: Array(first..<(first + 5)), answers: [4, 1, 2, 3, 5]))
        }
        else { ContentView() }
        #else
        ContentView()
        #endif
    }
}

/// Deterministic accessibility coverage without changing a simulator's global settings.
private struct TestingTextSize: ViewModifier {
    private var reducedEffects: Bool { Feel.testing && ProcessInfo.processInfo.arguments.contains("-accessible-effects") }
    private var testSize: DynamicTypeSize? {
        guard Feel.testing else { return nil }
        if ProcessInfo.processInfo.arguments.contains("-largest-text") { return .accessibility5 }
        if ProcessInfo.processInfo.arguments.contains("-large-text") { return .accessibility3 }
        return nil
    }
    func body(content: Content) -> some View {
        Group {
            if let testSize { content.environment(\.dynamicTypeSize, testSize) }
            else { content }
        }
        .environment(\.likertsReducedEffectsTest, reducedEffects || motionReviewReduced)
    }
    private var motionReviewReduced: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-motion-reduced-qa")
        #else
        false
        #endif
    }
}
