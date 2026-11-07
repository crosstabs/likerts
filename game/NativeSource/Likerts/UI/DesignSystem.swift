import SwiftUI
import UIKit

enum Palette {
    static let cream = Color(red: 1, green: 0.965, blue: 0.91)
    static let ink = Color(red: 0.16, green: 0.135, blue: 0.24)
    static let coral = Color(red: 1, green: 0.44, blue: 0.35)
    static let violet = Color(red: 0.72, green: 0.65, blue: 0.94)
    static let lime = Color(red: 0.87, green: 0.94, blue: 0.52)
    static let muted = Color(red: 0.40, green: 0.37, blue: 0.44)
    static let colors = [coral, Color(red: 1, green: 0.76, blue: 0.48), violet, Color(red: 0.64, green: 0.79, blue: 0.94), lime]
}

private struct ScaledRoundedFont: ViewModifier {
    @ScaledMetric(relativeTo: .body) var size: CGFloat = 17
    let weight: Font.Weight
    init(size: CGFloat, weight: Font.Weight) {
        self._size = ScaledMetric(wrappedValue: size, relativeTo: .body)
        self.weight = weight
    }
    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: .rounded))
    }
}

extension View {
    func roundedFont(_ size: CGFloat, _ weight: Font.Weight = .bold) -> some View {
        modifier(ScaledRoundedFont(size: size, weight: weight))
    }
}

enum Feel {
    static var testing: Bool { ProcessInfo.processInfo.arguments.contains("-ui-testing") }
    /// An unset preference retains the game's original tactile feedback.
    static var hapticsEnabled: Bool {
        // Messages extensions have their own preferences container and no
        // settings screen, so avoid unexpectedly vibrating in a conversation.
        guard Bundle.main.bundleURL.pathExtension != "appex" else { return false }
        return UserDefaults.standard.object(forKey: "likerts.audio.haptics") as? Bool ?? true
    }
    static func tap() { if !testing && hapticsEnabled { UISelectionFeedbackGenerator().selectionChanged() } }
    static func reveal(exact: Bool) {
        if !testing && hapticsEnabled {
            if exact { UINotificationFeedbackGenerator().notificationOccurred(.success) }
            else { UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.65) }
        }
    }
}

struct SquishButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var testEffects
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion && !testEffects ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(reduceMotion || testEffects || Feel.testing ? nil : .spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

struct PrimaryButton: View {
    var title: String
    var symbol: String = "arrow.right"
    var color: Color = Palette.ink
    var foreground: Color = .white
    var identifier: String = ""
    var disabled: Bool = false
    var action: () -> Void
    var body: some View {
        Button { Feel.tap(); action() } label: {
            HStack(spacing: 12) {
                Text(title).roundedFont(18)
                Spacer(minLength: 8)
                Image(systemName: symbol).font(.system(size: 17, weight: .bold))
            }
            .padding(.horizontal, 24).padding(.vertical, 21)
            .foregroundStyle(foreground)
            .background(disabled ? Palette.ink.opacity(0.16) : color, in: RoundedRectangle(cornerRadius: 23))
        }
        .buttonStyle(SquishButtonStyle())
        .disabled(disabled)
        .accessibilityIdentifier(identifier)
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).roundedFont(11, .heavy).tracking(2)
    }
}

struct CapsulePal: View {
    var color: Color = Palette.coral
    var expression: Int = 3
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                Capsule().fill(color)
                Capsule().strokeBorder(Palette.ink.opacity(0.07), lineWidth: 1)
                HStack(spacing: w * 0.09) {
                    ForEach(0..<2) { i in
                        ZStack {
                            Ellipse().fill(Palette.cream).frame(width: w * 0.19, height: w * 0.25)
                            Ellipse().fill(Palette.ink).frame(width: w * 0.075, height: w * 0.13).offset(x: expression == 1 ? -w * 0.03 : w * 0.02, y: w * 0.01)
                        }
                        .rotationEffect(.degrees(expression == 2 && i == 0 ? -15 : 0))
                    }
                }.position(x: w * 0.5, y: h * 0.43)
                Mouth(smile: expression >= 3)
                    .stroke(Palette.ink, style: StrokeStyle(lineWidth: max(2, w * 0.035), lineCap: .round))
                    .frame(width: w * 0.19, height: w * 0.10)
                    .position(x: w * 0.5, y: h * 0.59)
                if expression == 5 {
                    HStack { Circle(); Spacer(); Circle() }
                        .foregroundStyle(Palette.coral.opacity(0.4))
                        .frame(width: w * 0.64, height: w * 0.09)
                        .position(x: w * 0.5, y: h * 0.55)
                }
            }
        }.accessibilityHidden(true)
    }
}

private struct Mouth: Shape {
    var smile: Bool
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: smile ? 0 : rect.height * 0.5))
        p.addQuadCurve(to: CGPoint(x: rect.width, y: smile ? 0 : rect.height * 0.5), control: CGPoint(x: rect.midX, y: smile ? rect.height * 1.6 : 0))
        return p
    }
}

struct PalParty: View {
    var height: CGFloat = 178
    var body: some View {
        GeometryReader { geo in
            let scale = min(1, geo.size.width / 290, height / 178)
            HStack(alignment: .bottom, spacing: -5) {
                CapsulePal(color: Palette.coral, expression: 1).frame(width: 57, height: 113).rotationEffect(.degrees(-14)).offset(y: -4)
                CapsulePal(color: Palette.colors[1], expression: 2).frame(width: 57, height: 143).rotationEffect(.degrees(-7))
                CapsulePal(color: Palette.violet, expression: 3).frame(width: 65, height: 166).offset(y: -4)
                CapsulePal(color: Palette.colors[3], expression: 4).frame(width: 57, height: 133).rotationEffect(.degrees(10))
                CapsulePal(color: Palette.lime, expression: 5).frame(width: 57, height: 105).rotationEffect(.degrees(17)).offset(y: -1)
            }
            .frame(width: 273, height: 180, alignment: .bottom)
            .scaleEffect(scale)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }.frame(height: height)
    }
}

struct CloseButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark").font(.system(size: 15, weight: .bold))
                .frame(width: 44, height: 44).navigationGlass()
                .contentShape(Rectangle())
        }.buttonStyle(SquishButtonStyle()).accessibilityLabel("Close").accessibilityIdentifier("nav.close")
    }
}

struct ChoiceScale: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let selection: Int?
    var answer: Int? = nil
    var locked: Bool = false
    var answering = false
    var onSelect: (Int) -> Void
    static let labels = ["Not me", "A little", "Depends", "Mostly me", "So me"]
    @ViewBuilder var body: some View {
        if textSize.isAccessibilitySize { accessibleScale }
        else { characterScale }
    }
    private var characterScale: some View {
        VStack(spacing: 15) {
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(1...5, id: \.self) { value in
                    Button {
                        Feel.tap(); onSelect(value)
                    } label: {
                        VStack(spacing: 7) {
                            if let answer, answer == value {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 17, weight: .bold)).foregroundStyle(Palette.ink)
                            } else {
                                Text("\(value)").roundedFont(13, .heavy).foregroundStyle(Palette.muted)
                            }
                            CapsulePal(color: Palette.colors[value - 1], expression: value)
                                .frame(height: selection == value ? 89 : 72)
                                .overlay {
                                    Capsule().strokeBorder(selection == value ? Palette.ink : .clear, lineWidth: 3)
                                }
                                .padding(.bottom, selection == value ? 0 : 8)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(SquishButtonStyle())
                    .disabled(locked)
                    .accessibilityLabel("\(value), \(Self.labels[value - 1])")
                    .accessibilityValue(selection == value ? "selected" : "not selected")
                    .accessibilityAddTraits(selection == value ? [.isSelected] : [])
                    .accessibilityHint(answering ? "Choose how much this statement sounds like you." : "Predict how much this statement sounds like the person who answered.")
                    .accessibilityIdentifier("round.choice.\(value)")
                }
            }.frame(minHeight: 120)
            HStack {
                Text("NOT ME"); Spacer(); Text("SO ME")
            }.roundedFont(10, .heavy).tracking(1.2).foregroundStyle(Palette.muted)
            Text(selection.map { Self.labels[$0 - 1] } ?? "Tap your instinct")
                .roundedFont(17).foregroundStyle(selection == nil ? Palette.muted : Palette.ink)
                .frame(minHeight: 25)
        }
    }
    private var accessibleScale: some View {
        VStack(spacing: 9) {
            Text(selection.map { Self.labels[$0 - 1] } ?? "Choose your instinct")
                .roundedFont(14, .bold).foregroundStyle(Palette.ink)
            HStack(spacing: 7) {
                ForEach(1...5, id: \.self) { value in
                    Button { Feel.tap(); onSelect(value) } label: {
                        Text("\(value)").roundedFont(19, .heavy)
                            .frame(maxWidth: .infinity, minHeight: 54).padding(.vertical, 5)
                            .background(selection == value ? Palette.colors[value - 1] : .white, in: RoundedRectangle(cornerRadius: 15))
                            .overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(selection == value ? Palette.ink : Palette.ink.opacity(0.15), lineWidth: selection == value ? 3 : 1))
                            .contentShape(Rectangle())
                    }.buttonStyle(SquishButtonStyle()).disabled(locked)
                        .accessibilityLabel("\(value), \(Self.labels[value - 1])")
                        .accessibilityValue(selection == value ? "selected" : "not selected")
                        .accessibilityAddTraits(selection == value ? [.isSelected] : [])
                        .accessibilityHint(answering ? "Choose how much this statement sounds like you." : "Predict how much this statement sounds like the person who answered.")
                        .accessibilityIdentifier("round.choice.\(value)")
                }
            }
            HStack { Text("Not me"); Spacer(); Text("So me") }
                .roundedFont(11, .semibold).foregroundStyle(Palette.muted).accessibilityHidden(true)
        }
    }

}

struct PaperCard<Content: View>: View {
    var color: Color = .white
    @ViewBuilder var content: Content
    var body: some View {
        content.padding(24).frame(maxWidth: .infinity)
            .background(color, in: RoundedRectangle(cornerRadius: 30))
    }
}

/// Glass stays on navigation. Content and the answer dock retain solid contrast.
private struct NavigationGlass: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.likertsReducedEffectsTest) private var testEffects
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !reduceTransparency, !testEffects, contrast != .increased {
            content.glassEffect(.regular.interactive(), in: .circle)
        } else {
            content.background(Palette.ink.opacity(0.07), in: Circle())
                .overlay(Circle().strokeBorder(Palette.ink.opacity(contrast == .increased || testEffects ? 0.5 : 0.1), lineWidth: 1))
        }
    }
}

extension View {
    func navigationGlass() -> some View { modifier(NavigationGlass()) }
}

private struct ReducedEffectsTestKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var likertsReducedEffectsTest: Bool {
        get { self[ReducedEffectsTestKey.self] }
        set { self[ReducedEffectsTestKey.self] = newValue }
    }
}
