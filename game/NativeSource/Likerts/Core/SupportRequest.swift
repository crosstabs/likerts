import Foundation

/// User-directed contact only. This model never reads a game, clipboard or conversation.
struct SupportRequest: Equatable {
    enum Kind: String, CaseIterable, Identifiable {
        case help, content, privacy
        var id: String { rawValue }
        var title: String {
            switch self {
            case .help: return "Game help"
            case .content: return "Content or safety concern"
            case .privacy: return "Privacy question"
            }
        }
        var subject: String {
            switch self {
            case .help: return "[Likerts] Support"
            case .content: return "[Likerts] Content report"
            case .privacy: return "[Likerts] Privacy"
            }
        }
    }

    static let address = "support@crosstabs.com"
    static let publisher = "CROSSTABS PTY LTD"
    static let messageLimit = 4_000
    let kind: Kind
    let message: String
    let version: String
    let build: String

    var body: String {
        "Likerts \(version) (\(build))\n\n\(String(message.prefix(Self.messageLimit)))"
    }
    var copyableDraft: String { "To: \(Self.address)\nSubject: \(kind.subject)\n\n\(body)" }
    var mailURL: URL {
        // Encode delimiters and newlines as data, including +, &, # and ?.
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let subject = kind.subject.addingPercentEncoding(withAllowedCharacters: allowed)!
        let content = body.addingPercentEncoding(withAllowedCharacters: allowed)!
        return URL(string: "mailto:\(Self.address)?subject=\(subject)&body=\(content)")!
    }

    /// A release can supply its published Likerts policy without shipping an invented URL.
    static func privacyPolicyURL(_ configured: String?) -> URL? {
        guard let configured, !configured.isEmpty,
              let url = URL(string: configured), url.scheme == "https",
              let host = url.host, host.contains("."),
              !host.hasSuffix(".invalid"), !host.hasSuffix(".example"),
              url.user == nil, url.password == nil else { return nil }
        return url
    }
}
