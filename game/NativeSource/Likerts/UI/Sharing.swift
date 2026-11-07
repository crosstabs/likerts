import SwiftUI
import UIKit
import LinkPresentation

/// Share the actual result image while giving the system sheet an honest,
/// branded preview. No web destination is implied by this local image item.
final class ResultShareItem: NSObject, UIActivityItemSource {
    private let image: UIImage
    private let title: String

    init(image: UIImage, title: String) {
        self.image = image
        self.title = title
        super.init()
    }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
        image
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        image
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
        title
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                thumbnailImageForActivityType activityType: UIActivity.ActivityType?,
                                suggestedSize size: CGSize) -> UIImage? {
        image
    }

    func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
        let metadata = LPLinkMetadata()
        metadata.title = title
        metadata.imageProvider = NSItemProvider(object: image)
        metadata.iconProvider = NSItemProvider(object: image)
        return metadata
    }
}

struct SharePayload: Identifiable {
    let id = UUID()
    let items: [Any]
}
struct ChallengeSheet: Identifiable {
    let id = UUID()
    let challenge: Challenge
}
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
struct ChallengeShareView: View {
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var codeFontSize: CGFloat = 15
    let challenge: Challenge
    @State private var activity: SharePayload?
    @State private var copied = false
    private var code: String { ChallengeCodec.encode(challenge) }
    private var invitation: String {
        challenge.name == "Your friend" ? "How well do you really know me?" : "How well do you really know \(challenge.name)?"
    }
    var body: some View {
        SheetPage {
            HStack { Eyebrow(text: "Send a little mind game"); Spacer(); CloseButton { dismiss() } }
            Text("Who really\ngets you?").roundedFont(36, .black).tracking(-1)
            HStack(spacing: 20) {
                StoryCharacter(value: 3, pose: .hold)
                    .frame(width: 52, height: 76).rotationEffect(.degrees(-8))
                VStack(alignment: .leading, spacing: 8) {
                    Text(challenge.name).roundedFont(23, .heavy)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(challenge.isCustom ? "5 personal takes" : challenge.promptIDs.contains(where: { $0 >= 1001 }) ? "5 curated takes" : "5 classic takes")
                        .roundedFont(13, .heavy).padding(.horizontal, 11).padding(.vertical, 7)
                        .background(.white.opacity(0.65), in: Capsule())
                }
                Spacer(minLength: 0)
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.violet.opacity(0.25), in: RoundedRectangle(cornerRadius: 26))
            Text("Send your challenge. A friend guesses your five answers, then finds out how close they got.")
                .roundedFont(17, .medium).foregroundStyle(Palette.muted)
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "Your challenge code").foregroundStyle(Palette.muted)
                Text(code)
                    .font(.system(size: codeFontSize, weight: .semibold, design: .monospaced))
                    .lineLimit(3).truncationMode(.middle).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(code).accessibilityIdentifier("share.code")
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(.white, in: RoundedRectangle(cornerRadius: 22))
            PrimaryButton(title: "Send challenge", symbol: "square.and.arrow.up", identifier: "share.send") {
                activity = SharePayload(items: ["\(invitation) Play my five-take mind game in Likerts. Open the app → Enter a challenge → paste the code:\n\n\(code)\n\nYou'll need the Likerts iOS app. This is an offline challenge; send me your result!"])
            }
            Button { UIPasteboard.general.string = code; copied = true; Feel.tap() } label: {
                Label(copied ? "Copied!" : "Copy full code", systemImage: copied ? "checkmark.circle.fill" : "doc.on.doc")
                    .roundedFont(16).frame(maxWidth: .infinity, minHeight: 44).padding(.vertical, 4)
                    .background(Palette.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 18))
            }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("share.copy")
                .accessibilityHint("Copies the complete challenge, including any personal takes.")
            Text("Your friend needs Likerts to play. They can send you their result afterward.")
                .roundedFont(14, .medium).foregroundStyle(Palette.muted)
            Text("The code includes your nickname, takes and answers. It's encoded, not encrypted.")
                .roundedFont(11, .medium).foregroundStyle(Palette.muted)
        }.sheet(item: $activity) { payload in ActivityView(items: payload.items) }
    }
}
