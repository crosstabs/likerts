import SwiftUI

/// Shared by the containing app and Messages so invitations and handbacks
/// belong to the same sculpted world as the five-choice game.
struct StoryHomeCast: View {
    var height: CGFloat = 142
    private let heights: [CGFloat] = [0.73, 0.78, 0.94, 1.0, 0.76]
    var body: some View {
        HStack(alignment: .bottom, spacing: -3) {
            ForEach(1...5, id: \.self) { value in
                StoryCharacter(value: value, pose: .hold)
                    .frame(maxWidth: .infinity).frame(height: height * heights[value - 1])
                    .rotationEffect(.degrees(Double(value - 3) * 3))
            }
        }.frame(height: height, alignment: .bottom).accessibilityHidden(true)
    }
}
