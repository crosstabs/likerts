import SwiftUI
import UniformTypeIdentifiers

extension View {
    /// Semantic text styles let Dynamic Type and accessibility audits identify
    /// the font's native role while preserving the quiz's rounded typography.
    func quizFont(_ style: Font.TextStyle, _ weight: Font.Weight = .bold) -> some View {
        font(.system(style, design: .rounded).weight(weight))
    }
}

/// Forward only an explicit app-local QA size across a presentation boundary.
/// Ordinary presentations inherit their native Dynamic Type environment.
struct QuizPresentationTextSize: ViewModifier {
    let size: DynamicTypeSize
    private var isForced: Bool {
        Feel.testing && ProcessInfo.processInfo.arguments.contains(where: { $0 == "-large-text" || $0 == "-largest-text" })
    }

    @ViewBuilder func body(content: Content) -> some View {
        if isForced { content.environment(\.dynamicTypeSize, size) }
        else { content }
    }
}

struct QuizActionButton: View {
    let title: String
    var symbol: String?
    var role: ButtonRole?
    var identifier = ""
    var disabled = false
    var action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            HStack(spacing: 8) {
                if let symbol { Image(systemName: symbol).accessibilityHidden(true) }
                Text(title).fixedSize(horizontal: false, vertical: true)
            }
            .quizFont(.subheadline, .semibold)
            .frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 14).padding(.vertical, 2)
            .background(Palette.cream, in: RoundedRectangle(cornerRadius: 15))
            .overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(Palette.ink.opacity(0.24)))
            .contentShape(RoundedRectangle(cornerRadius: 15))
        }
        .buttonStyle(SquishButtonStyle())
        .foregroundStyle(disabled ? Palette.muted : Palette.ink)
        .disabled(disabled).accessibilityIdentifier(identifier)
    }
}

/// Quiz adaptation of the shared prominent button with semantic label fonts.
struct QuizPrimaryButton: View {
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
                Text(title).quizFont(.body)
                Spacer(minLength: 8)
                Image(systemName: symbol).font(.body.weight(.bold)).accessibilityHidden(true)
            }
            .padding(.horizontal, 24).padding(.vertical, 21)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(disabled ? Palette.ink : foreground)
            .background(disabled ? Palette.ink.opacity(0.16) : color, in: RoundedRectangle(cornerRadius: 23))
            .contentShape(RoundedRectangle(cornerRadius: 23))
        }
        .buttonStyle(SquishButtonStyle()).disabled(disabled)
        .accessibilityIdentifier(identifier)
    }
}

struct QuizFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content.quizFont(.body, .medium)
            .padding(16)
            .background(.white, in: RoundedRectangle(cornerRadius: 17))
            .overlay(RoundedRectangle(cornerRadius: 17).strokeBorder(Palette.ink.opacity(0.24)))
    }
}

struct QuizSharingNote: View {
    var body: some View {
        Label("Quiz files include correct answers. Share them with hosts.", systemImage: "info.circle")
            .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct QuizExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    private let data: Data

    init(quiz: QuizDocument) throws { data = try quiz.encoded() }

    init(configuration: ReadConfiguration) throws {
        guard let contents = configuration.file.regularFileContents,
              contents.count <= QuizDocument.maximumBytes else { throw CocoaError(.fileReadCorruptFile) }
        data = try QuizDocument.decode(contents).encoded()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }

    static func filename(for title: String) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_")
        let cleaned = String(String.UnicodeScalarView(title.unicodeScalars.filter { allowed.contains($0) }.prefix(60)))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "likerts-quiz" : cleaned
    }
}
