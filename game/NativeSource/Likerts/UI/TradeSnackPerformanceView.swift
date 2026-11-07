import SwiftUI

/// First normal-playback gate: a physical exchange with held-object continuity.
/// Original whole sprites move along measured paths; no character rig is implied.
struct TradeSnackPerformanceView: View {
    var resolution: StoryResolution?
    var choice: Int?
    var compact = false
    var canonicalCast = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var reducedEffects
    @State private var progress = 0.0
    @State private var attention = 0.0
    @State private var reaction = 0.0
    @State private var choiceTask: Task<Void, Never>?
    private var still: Bool { reduceMotion || reducedEffects || Feel.testing }

    var body: some View {
        TradeSnackArt(progress: still && resolution != nil ? 1 : progress,
                      attention: still ? 0 : attention,
                      reaction: still && resolution != nil ? 1 : reaction,
                      exact: resolution?.exact == true, canonicalCast: canonicalCast)
            .frame(height: compact ? 144 : 200)
            .clipShape(RoundedRectangle(cornerRadius: 26))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(resolution == nil
                ? "Two friends hold a cookie and a bowl of popcorn, ready to trade."
                : "The cookie and popcorn have traded places between the two friends.")
            .accessibilityIdentifier("story.scene.1001")
            .modifier(SystemMotionQADiagnostic(systemReduceMotion: reduceMotion))
            .task(id: resolution) {
                guard resolution != nil else { progress = 0; reaction = 0; return }
                #if DEBUG
                MotionProbe.shared.captureReveal(roundID: 1001, seedLabel: "trade-snack-v1")
                #endif
                if still { progress = 1; reaction = 1; return }
                withAnimation(.easeOut(duration: 0.18)) { attention = 1 }
                do { try await Task.sleep(for: .milliseconds(220)) } catch { return }
                withAnimation(.timingCurve(0.30, 0.0, 0.20, 1, duration: 0.64)) {
                    progress = 1
                    attention = 0
                }
                do { try await Task.sleep(for: .milliseconds(640)) } catch { return }
                withAnimation(.spring(response: 0.30, dampingFraction: 0.76)) { reaction = 1 }
            }
            .onChange(of: choice) { _, value in
                guard value != nil, resolution == nil, !still else { return }
                choiceTask?.cancel()
                choiceTask = Task { @MainActor in
                    withAnimation(.easeOut(duration: 0.16)) { attention = 1 }
                    do { try await Task.sleep(for: .milliseconds(190)) } catch { return }
                    withAnimation(.easeInOut(duration: 0.20)) { attention = 0 }
                }
            }
            .onDisappear {
                choiceTask?.cancel()
                #if DEBUG
                if resolution != nil { MotionProbe.shared.cancel(roundID: 1001) }
                #endif
            }
    }
}

/// Opt-in test evidence of the actual SwiftUI system environment. It is not
/// present in Release or exposed during ordinary Debug play.
private struct SystemMotionQADiagnostic: ViewModifier {
    let systemReduceMotion: Bool
    @ViewBuilder func body(content: Content) -> some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-motion-system-probe") {
            content.accessibilityValue(systemReduceMotion ? "system-reduce-motion-on" : "system-reduce-motion-off")
        } else { content }
        #else
        content
        #endif
    }
}

private struct TradeSnackArt: View, Animatable {
    var progress: Double
    var attention: Double
    var reaction: Double
    let exact: Bool
    let canonicalCast: Bool
    var animatableData: AnimatablePair<Double, AnimatablePair<Double, Double>> {
        get { AnimatablePair(progress, AnimatablePair(attention, reaction)) }
        set { progress = newValue.first; attention = newValue.second.first; reaction = newValue.second.second }
    }
    private var giver: Int { canonicalCast ? 3 : 2 }
    private var receiver: Int { canonicalCast ? 5 : 3 }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let left = fitted(value: giver, center: CGPoint(x: size.width * 0.23, y: size.height * 0.48), width: size.width * 0.32, height: size.height * 0.85)
            let right = fitted(value: receiver, center: CGPoint(x: size.width * 0.77, y: size.height * 0.48), width: size.width * 0.32, height: size.height * 0.85)
            let leftAngle = attention * 4 + reaction * (exact ? 5 : -3)
            let rightAngle = attention * -3 + reaction * (exact ? -5 : 3)
            let leftGrip = anchor(.rightHand, value: giver, rect: left, angle: leftAngle)
            let rightGrip = anchor(.leftHand, value: receiver, rect: right, angle: rightAngle)
            let cookie = path(from: leftGrip, to: rightGrip, lift: -size.height * 0.18, t: progress)
            let popcorn = path(from: rightGrip, to: leftGrip, lift: size.height * 0.14, t: progress)
            ZStack {
                TotemTone.paper
                if let image = TopicArt.backdrop(.snacks) {
                    Image(uiImage: image).resizable().scaledToFill()
                        .frame(width: size.width, height: size.height).clipped().opacity(0.67)
                }
                StoryRaster(ref: "set/bench").frame(width: size.width * 0.96, height: size.height * 0.38)
                    .position(x: size.width * 0.50, y: size.height * 0.86)
                character(value: giver, rect: left, angle: leftAngle)
                character(value: receiver, rect: right, angle: rightAngle)
                StoryRaster(ref: "snacks/popcorn").frame(width: size.width * 0.21, height: size.height * 0.29)
                    .rotationEffect(.degrees(-4 + progress * 8))
                    .position(x: popcorn.x, y: popcorn.y + size.height * 0.09)
                StoryRaster(ref: "snacks/cookie").frame(width: size.width * 0.18, height: size.height * 0.22)
                    .rotationEffect(.degrees(-12 + progress * 24))
                    .position(x: cookie.x, y: cookie.y + size.height * 0.07)
            }.frame(width: size.width, height: size.height)
        }
    }
    private func character(value: Int, rect: CGRect, angle: Double) -> some View {
        StoryCharacter(value: value, pose: .hold).frame(width: rect.width, height: rect.height)
            .rotationEffect(.degrees(angle)).position(x: rect.midX, y: rect.midY)
    }
    private func fitted(value: Int, center: CGPoint, width: CGFloat, height: CGFloat) -> CGRect {
        let source = StoryArt.image(ref: "cast/hold/\(value)")?.size ?? CGSize(width: 1, height: 1)
        let scale = min(width / source.width, height / source.height)
        let w = source.width * scale, h = source.height * scale
        return CGRect(x: center.x - w / 2, y: center.y - h / 2, width: w, height: h)
    }
    private enum Hand { case leftHand, rightHand }
    private func anchor(_ hand: Hand, value: Int, rect: CGRect, angle: Double) -> CGPoint {
        let anchors = StoryCastAnchors.anchor(pose: .hold, value: value)
        let point = hand == .leftHand ? anchors.leftHand : anchors.rightHand
        let dx = (point.x - 0.5) * rect.width, dy = (point.y - 0.5) * rect.height
        let radians = angle * .pi / 180
        return CGPoint(x: rect.midX + dx * cos(radians) - dy * sin(radians),
                       y: rect.midY + dx * sin(radians) + dy * cos(radians))
    }
    private func path(from: CGPoint, to: CGPoint, lift: CGFloat, t: Double) -> CGPoint {
        let p = CGFloat(min(1, max(0, t)))
        let midpoint = CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + lift)
        return CGPoint(x: (1-p)*(1-p)*from.x + 2*(1-p)*p*midpoint.x + p*p*to.x,
                       y: (1-p)*(1-p)*from.y + 2*(1-p)*p*midpoint.y + p*p*to.y)
    }
}
