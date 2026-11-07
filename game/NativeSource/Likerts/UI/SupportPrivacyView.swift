import SwiftUI
import UIKit

enum HelpDestination: String, Identifiable {
    case support, report, privacy
    var id: String { rawValue }
}

struct HelpDestinationView: View {
    let destination: HelpDestination
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var systemOpenURL
    private var emailAction: OpenURLAction {
        #if DEBUG
        if Feel.testing && ProcessInfo.processInfo.arguments.contains("-support-email-unavailable") {
            return OpenURLAction { url in url.scheme == "mailto" ? .discarded : .systemAction }
        }
        #endif
        return systemOpenURL
    }
    var body: some View {
        NavigationStack {
            if destination == .privacy { PrivacyDetailsView(close: { dismiss() }) }
            else { SupportContactView(initialKind: destination == .report ? .content : .help, close: { dismiss() }) }
        }
        .tint(Palette.ink).preferredColorScheme(.light)
        .environment(\.openURL, emailAction)
        .presentationDetents([.large]).presentationDragIndicator(.visible)
    }
}

private struct SupportContactView: View {
    let close: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var kind: SupportRequest.Kind
    @State private var message = ""
    @State private var notice: String?
    @FocusState private var editing: Bool

    init(initialKind: SupportRequest.Kind, close: @escaping () -> Void) {
        _kind = State(initialValue: initialKind); self.close = close
    }
    private var request: SupportRequest {
        SupportRequest(kind: kind, message: message,
                       version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0",
                       build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                helpHeader("A little help.", subtitle: "Support, safety & privacy")
                Text("Contact \(SupportRequest.publisher)").roundedFont(16, .bold)
                Text(SupportRequest.address).roundedFont(20, .heavy).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("support.address")
                Menu {
                    ForEach(SupportRequest.Kind.allCases) { value in
                        Button(value.title) { kind = value }
                    }
                } label: {
                    HStack {
                        Text(kind.title)
                        Image(systemName: "chevron.up.chevron.down").accessibilityHidden(true)
                    }.roundedFont(16, .bold).frame(minHeight: 44).contentShape(Rectangle())
                }
                    .accessibilityIdentifier("support.kind")
                VStack(alignment: .leading, spacing: 10) {
                    Text("Tell us what happened").roundedFont(17, .bold)
                    Text("Describe the issue or quote the relevant statement. Leave out private answers, challenge codes and other people's personal details.")
                        .roundedFont(14, .medium).foregroundStyle(Palette.muted)
                    TextEditor(text: $message).roundedFont(16, .medium)
                        .focused($editing)
                        .frame(minHeight: 150).padding(10).scrollContentBackground(.hidden)
                        .background(.white, in: RoundedRectangle(cornerRadius: 18))
                        .accessibilityLabel("Your message").accessibilityIdentifier("support.message")
                        .onChange(of: message) { _, value in message = String(value.prefix(SupportRequest.messageLimit)) }
                    Text("Only your text and Likerts version \(request.version) (\(request.build)) are put in the draft. Your email app adds your sender details. Nothing from your game or conversation is attached automatically.")
                        .roundedFont(13, .medium).foregroundStyle(Palette.muted)
                        .accessibilityIdentifier("support.included")
                }
                PrimaryButton(title: "Review email draft", symbol: "envelope", identifier: "support.email") {
                    editing = false
                    openURL(request.mailURL) { accepted in
                        notice = accepted
                            ? "Review the draft in your email app. Nothing is sent until you choose Send there. If no draft appeared, copy it below."
                            : "An email draft could not be opened here. Copy the address and draft below, then use your email app. Nothing was sent."
                    }
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { copyAddress; copyDraft }
                    VStack(alignment: .leading, spacing: 8) { copyAddress; copyDraft }
                }
                if let notice {
                    Text(notice).roundedFont(14, .semibold).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("support.notice")
                }
                Text("Opening or copying a draft does not deliver a report. Sending an email does not hide a challenge or block its sender. In Messages, use Apple's conversation controls to manage or block a contact.")
                    .roundedFont(14, .medium).foregroundStyle(Palette.muted)
                    .accessibilityIdentifier("support.delivery")
                NavigationLink { PrivacyDetailsView(close: close) } label: {
                    Label("Privacy in Likerts", systemImage: "hand.raised").roundedFont(16, .bold).frame(minHeight: 44)
                }.accessibilityIdentifier("support.privacy")
                if let url = SupportRequest.privacyPolicyURL(Bundle.main.object(forInfoDictionaryKey: "LikertsSupportURL") as? String),
                   url.host == "likerts.com", url.path.hasPrefix("/game/") {
                    Link(destination: url) {
                        Text("Likerts game support website").roundedFont(15, .semibold).frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("support.publicWebsite")
                }
            }.padding(28).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.background(Palette.cream).foregroundStyle(Palette.ink)
            .safeAreaInset(edge: .top, spacing: 0) { HelpCloseBar(close: close) }
            .scrollDismissesKeyboard(.interactively)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { editing = false }.accessibilityIdentifier("support.done")
                }
            }
    }
    private var copyAddress: some View {
        Button {
            editing = false
            UIPasteboard.general.string = SupportRequest.address
            notice = "Email address copied. Nothing was sent."
        } label: {
            Text("Copy email address").roundedFont(15, .bold).frame(minHeight: 44).contentShape(Rectangle())
        }.accessibilityIdentifier("support.copyAddress")
    }
    private var copyDraft: some View {
        Button {
            editing = false
            UIPasteboard.general.string = request.copyableDraft
            notice = "Draft copied to the system clipboard. Nothing was sent. Paste it into your email app when ready."
        } label: {
            Text("Copy draft").roundedFont(15, .bold).frame(minHeight: 44).contentShape(Rectangle())
        }.accessibilityIdentifier("support.copyDraft")
    }
}

private struct PrivacyDetailsView: View {
    let close: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                helpHeader("Privacy in Likerts.", subtitle: "How your game data is used")
                detail("Offline play on this device", "Likerts has no account, advertising or analytics SDK. Offline settings, topic history, Daily best, creator quizzes and an unfinished standalone game can be stored on this device. A saved standalone game includes its nickname, statements, answers, guesses and results. Pass-the-phone party boards are temporary and do not sync to a leaderboard.")
                detail("Storage & deletion", "Likerts does not encrypt saved games. The standalone save uses operating-system file protection and is excluded from device backup; other preferences may follow your device's backup settings. Leaving a game attempts to clear that save; a storage error is shown if removal fails. Hiding a challenge stores a local fingerprint. Settings can clear that hidden list. Messages uses a separate local list. Device and backup controls govern other remaining data.")
                detail("Quiz library in the app", "Quizzes you create or import in the app are saved on this device, including questions, answer choices, correct answers and explanations. The library uses operating-system file protection, is not separately encrypted by Likerts and is excluded from device backup. Open Quizzes in the app to delete a saved quiz; a storage error is shown if removal fails. Practice scores are not saved, and the library does not sync automatically. Exported quiz files include correct answers. Manage exported copies in Files or the service you choose.")
                detail("When you share offline games", "Offline challenge codes and Messages cards contain nicknames, statements and answers. They are encoded, not encrypted or tamper-proof. Results can include names, scores and answer comparisons. Copying puts the selected content on the system clipboard. Sharing uses the service you choose and its privacy rules. Both people need Likerts for these offline challenge and Messages games.")
                detail("Optional live rooms", "When a live service is connected, players can join from the app or browser. Hosting a quiz uploads a fixed copy of the selected quiz, including its correct answers and explanations. Your local quiz library does not automatically upload or sync. The service receives room settings, participant nicknames and submissions to run and score the game. It derives a hashed network-source identifier from connection information for abuse and rate-limit controls; this is not an advertising or hardware identifier. Nicknames appear in the lobby; submitted quiz choices and points are shown to the room at reveal. Mind-reading answers are revealed after predictions lock. Live invites contain a room code, not a member's access credential or quiz answer key. Live games use the reviewed Render service and PostgreSQL database. Rooms have a six-hour maximum life, two-hour idle expiry and fifteen-minute finished expiry; cleanup may run later than an expiry boundary. Leave revokes your seat access but earlier nicknames, answers and results can remain in the room until it closes or expires. The host's Close room ends access for everyone. Admission recovery is available for ten minutes, with separate temporary admission and rate-limit metadata. Provider request logs and backups have separate retention, and other players can retain what they have seen. Returning home keeps your place and does not close the room. Scoped access and any pending quiz-upload recovery copy are stored securely on this device until resolved or explicitly forgotten.")
                detail("Optional on-device AI", "Handpicked games are the default. On supported devices, optional AI selects from reviewed English statements using the theme and menu, rather than your nickname or answers. You can review, discard or cancel. Invalid, unavailable or slow selection has a labelled handpicked fallback. Likerts does not send game content to a remote AI API. Apple manages system model availability and downloads.")
                detail("Help & content concerns", "The contact screen prepares only the text you write and the app version/build. Opening or copying a draft does not deliver it to the publisher. Opening the draft hands its contents to your email app and its providers, which may sync an unsent draft. If you choose Send in an email app, your email address, message and any additions you make go to \(SupportRequest.publisher) at \(SupportRequest.address) and are handled by its email providers. Ask that address about access or deletion of correspondence. Do not include other people's private information unnecessarily.")
                detail("Local safety controls", "Hiding clears local challenge progress when storage permits; it does not deliver a report, block a sender or remove an existing Messages card. Reporting by email is separate from hiding. Use the communication service's sender and conversation controls where needed.")
                if let url = SupportRequest.privacyPolicyURL(Bundle.main.object(forInfoDictionaryKey: "LikertsPrivacyPolicyURL") as? String),
                   url.host == "likerts.com", url.path.hasPrefix("/game/") {
                    Link(destination: url) {
                        Text("Public privacy policy").roundedFont(16, .bold).frame(minHeight: 44).contentShape(Rectangle())
                    }
                        .accessibilityIdentifier("privacy.publicPolicy")
                }
                Text("Publisher: \(SupportRequest.publisher)\nPrivacy contact: \(SupportRequest.address)")
                    .roundedFont(14, .semibold).textSelection(.enabled)
                    .accessibilityIdentifier("privacy.contact")
            }.padding(28).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.background(Palette.cream).foregroundStyle(Palette.ink)
            .safeAreaInset(edge: .top, spacing: 0) { HelpCloseBar(close: close) }
            .navigationBarTitleDisplayMode(.inline)
    }
    private func detail(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).roundedFont(18, .heavy)
            Text(text).roundedFont(15, .medium).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct HelpCloseBar: View {
    let close: () -> Void
    var body: some View {
        HStack {
            Spacer(minLength: 0)
            CloseButton(action: close)
                .accessibilityLabel("Close help").accessibilityIdentifier("help.close")
        }.padding(.horizontal, 22).padding(.vertical, 6).background(Palette.cream)
    }
}

private func helpHeader(_ title: String, subtitle: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        Text(title).roundedFont(28, .black).tracking(-0.6)
        Text(subtitle).roundedFont(15, .semibold).foregroundStyle(Palette.muted)
    }
}
