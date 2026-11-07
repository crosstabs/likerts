import SwiftUI

/// Original cropped art in a bounded, neutral setting. No scene interprets an
/// arbitrary authored question; decorative views disappear at accessibility sizes.
struct QuizNeutralArtwork: View {
    @Environment(\.dynamicTypeSize) private var textSize
    var height: CGFloat = 92
    var sceneKey: QuizSceneKey? = nil
    var body: some View {
        if !textSize.isAccessibilitySize {
            QuizSingleSceneArtwork(value: nil, height: height, sceneKey: sceneKey)
                .frame(width: height * 0.9, height: height)
                .accessibilityHidden(true).allowsHitTesting(false)
        }
    }
}

struct QuizParticipantArtwork: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let value: Int
    var height: CGFloat = 44
    var sceneKey: QuizSceneKey? = nil
    var body: some View {
        if !textSize.isAccessibilitySize {
            QuizSingleSceneArtwork(value: value, height: height, sceneKey: sceneKey)
                .frame(width: height * 0.9, height: height)
                .accessibilityHidden(true).allowsHitTesting(false)
        }
    }
}

struct QuizCastArtwork: View {
    @Environment(\.dynamicTypeSize) private var textSize
    var celebrating = false
    var sceneKey: QuizSceneKey? = nil
    private static let heights: [CGFloat] = [0.80, 0.86, 0.96, 1.0, 0.84]
    var body: some View {
        if !textSize.isAccessibilitySize {
            GeometryReader { geometry in
                let width = geometry.size.width
                let scale = width / 390
                let baseline: CGFloat = 88
                let plateWidth = width - 22 * scale
                let plateHeight = plateWidth * 171 / 2_080
                let riseClearance = max(0, 112 - (baseline + 6 * scale + plateHeight / 2))
                ZStack {
                    QuizSceneTexture()
                    ZStack {
                        TotemRaster(name: "TotemPlatform")
                            .frame(width: plateWidth, height: plateHeight)
                            .position(x: width / 2, y: baseline + 6 * scale)
                        HStack(alignment: .bottom, spacing: 0) {
                            ForEach(1...5, id: \.self) { value in
                                StoryCharacter(value: value, pose: celebrating ? .celebrate : .hold)
                                    .frame(width: (width - 20) / 5, height: 82 * Self.heights[value - 1], alignment: .bottom)
                            }
                        }
                        .frame(width: width - 20, height: 82, alignment: .bottom)
                        .position(x: width / 2, y: baseline - 41)
                    }
                    .frame(width: width, height: 112)
                    .modifier(QuizSceneEntrance(key: sceneKey, maximumRise: riseClearance))
                }
                .clipShape(RoundedRectangle(cornerRadius: 22))
            }
            .frame(maxWidth: 390).frame(height: 112).frame(maxWidth: .infinity)
            .accessibilityHidden(true).allowsHitTesting(false)
        }
    }
}

/// This original integrated book/flag/table composition stays static and intact.
struct QuizLibrarySceneArtwork: View {
    @Environment(\.dynamicTypeSize) private var textSize
    var body: some View {
        if !textSize.isAccessibilitySize {
            StoryRaster(ref: "scene/bookFlagV42")
                .aspectRatio(1_536.0 / 894.0, contentMode: .fit)
                .frame(maxWidth: 309, maxHeight: 180).frame(maxWidth: .infinity)
                .accessibilityHidden(true).allowsHitTesting(false)
        }
    }
}

private struct QuizSingleSceneArtwork: View {
    let value: Int?
    let height: CGFloat
    let sceneKey: QuizSceneKey?
    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let baseline = height - (height <= 54 ? 4 : 8)
            let figureHeight = baseline - 2
            let plateWidth = width - 22 * width / 390
            let plateHeight = plateWidth * 171 / 2_080
            let riseClearance = max(0, height - (baseline + 6 * width / 390 + plateHeight / 2))
            ZStack {
                QuizSceneTexture()
                ZStack {
                    TotemRaster(name: "TotemPlatform")
                        .frame(width: plateWidth, height: plateHeight)
                        .position(x: width / 2, y: baseline + 6 * width / 390)
                    Group {
                        if let value { StoryCharacter(value: value, pose: .hold) }
                        else { TotemRaster(name: "Totem3") }
                    }
                    .frame(width: width * 0.84, height: figureHeight, alignment: .bottom)
                    .position(x: width / 2, y: baseline - figureHeight / 2)
                }
                .frame(width: width, height: height)
                .modifier(QuizSceneEntrance(key: sceneKey, maximumRise: riseClearance))
            }
            .clipShape(RoundedRectangle(cornerRadius: min(18, height / 4)))
        }
    }
}

private struct QuizSceneTexture: View {
    var body: some View {
        GeometryReader { geometry in
            Image("TotemBackground").resizable().scaledToFill()
                .frame(width: geometry.size.width, height: geometry.size.height)
                .opacity(0.45).clipped()
        }.accessibilityHidden(true)
    }
}

/// Only the art assembly moves. The texture, text, scores and controls stay still.
/// The phase key excludes polling time/revisions, selections and network status.
private struct QuizSceneEntrance: ViewModifier {
    let key: QuizSceneKey?
    var maximumRise: CGFloat = 6
    @Environment(\.accessibilityReduceMotion) private var systemReduced
    @Environment(\.likertsReducedEffectsTest) private var testReduced
    @Environment(\.scenePhase) private var scenePhase
    @State private var motion = QuizSceneMotionState()
    @State private var animationToken = UUID()

    private var qaOptIn: Bool {
        #if DEBUG
        Feel.testing && ProcessInfo.processInfo.arguments.contains("-quiz-scene-motion-testing")
        #else
        false
        #endif
    }
    private var qaReduced: Bool {
        #if DEBUG
        qaOptIn && ProcessInfo.processInfo.arguments.contains("-quiz-scene-reduced-motion-testing")
        #else
        false
        #endif
    }
    private var reduced: Bool { systemReduced || testReduced || qaReduced }

    func body(content: Content) -> some View {
        Group {
            if reduced { content }
            else { content.offset(y: motion.offsetY * min(1, max(0, maximumRise) / 6)).opacity(motion.opacity) }
        }
        .task(id: key) {
            guard let key else { settle(); return }
            let token = UUID(); animationToken = token
            let allowed = QuizSceneMotionPolicy.allowsMotion(systemReduceMotion: systemReduced,
                qaReducedMotion: testReduced || qaReduced, testing: Feel.testing, qaOptIn: qaOptIn)
            guard motion.prepare(key: key, allowed: allowed, consume: { QuizSceneMotionLedger.shared.consume($0) }) else { return }
            await Task.yield()
            guard !Task.isCancelled, animationToken == token, !reduced, scenePhase == .active else { settle(); return }
            withAnimation(.easeOut(duration: QuizSceneMotionState.duration), completionCriteria: .logicallyComplete) {
                _ = motion.begin(key: key)
            } completion: {
                guard animationToken == token else { return }
                _ = motion.finish(key: key)
            }
        }
        .onChange(of: reduced) { _, value in if value { settle() } }
        .onChange(of: scenePhase) { _, value in if value != .active { settle() } }
        .onDisappear { settle() }
    }

    private func settle() {
        animationToken = UUID()
        var transaction = Transaction(animation: nil); transaction.disablesAnimations = true
        withTransaction(transaction) { motion.cancel() }
    }
}
