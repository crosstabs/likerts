import Foundation

struct Prompt: Identifiable, Hashable, Codable, Sendable {
    let id: Int
    let text: String
    let emoji: String
}

/// Stable IDs are part of the offline challenge format. Add new prompts; never renumber them.
enum PromptBank {
    static let all: [Prompt] = [
        Prompt(id: 1, text: "I could go a whole week without my phone.", emoji: "📵"),
        Prompt(id: 2, text: "My houseplants deserve names and a backstory.", emoji: "🪴"),
        Prompt(id: 3, text: "I rehearse a casual reply before sending it.", emoji: "💬"),
        Prompt(id: 4, text: "I would follow a squirrel if it looked like it had a quest.", emoji: "🐿️"),
        Prompt(id: 5, text: "Leaving a party without saying goodbye is an art form.", emoji: "🫥"),
        Prompt(id: 6, text: "A snack before dinner is just dinner's opening act.", emoji: "🍿"),
        Prompt(id: 7, text: "A holiday needs a spreadsheet.", emoji: "🗓️"),
        Prompt(id: 8, text: "I would rewatch my comfort show for the tenth time.", emoji: "📺"),
        Prompt(id: 9, text: "Hand me the karaoke microphone. I have a vision.", emoji: "🎤"),
        Prompt(id: 10, text: "I would defend pineapple on pizza in a court of law.", emoji: "🍍"),
        Prompt(id: 11, text: "Walking the dog counts as an occasion to dress up.", emoji: "🧣"),
        Prompt(id: 12, text: "I talk to appliances when they let me down.", emoji: "🍞"),
        Prompt(id: 13, text: "I keep mystery cables because one day I'll need them.", emoji: "🔌"),
        Prompt(id: 14, text: "Unexpected money could become a giant inflatable duck.", emoji: "🦆"),
        Prompt(id: 15, text: "Rain is a perfectly good reason to cancel plans.", emoji: "🌧️"),
        Prompt(id: 16, text: "I might read the last page of a book first.", emoji: "📖"),
        Prompt(id: 17, text: "I greet the dog before I greet its human.", emoji: "🐕"),
        Prompt(id: 18, text: "With a good tutorial, I could probably land a plane.", emoji: "✈️"),
        Prompt(id: 19, text: "A ten-minute journey still needs emergency snacks.", emoji: "🥨"),
        Prompt(id: 20, text: "Starting a hobby means buying ALL the supplies.", emoji: "🎨"),
        Prompt(id: 21, text: "The same song on repeat is a complete playlist.", emoji: "🎧"),
        Prompt(id: 22, text: "I return the shopping cart even in the rain.", emoji: "🛒"),
        Prompt(id: 23, text: "I'd sleep in a haunted house for an excellent breakfast.", emoji: "👻"),
        Prompt(id: 24, text: "If aliens landed, I would try small talk.", emoji: "🛸"),
        Prompt(id: 25, text: "My best stickers are too good to actually use.", emoji: "⭐️"),
        Prompt(id: 26, text: "I clap when the plane lands.", emoji: "👏"),
        Prompt(id: 27, text: "I'd choose a tiny dragon over a guaranteed parking space.", emoji: "🐉"),
        Prompt(id: 28, text: "A robot vacuum is basically a pet.", emoji: "🤖"),
        Prompt(id: 29, text: "I arrive early, then wait nearby to look on time.", emoji: "⏰"),
        Prompt(id: 30, text: "A group chat with 237 unread messages can stay that way.", emoji: "🔕")
    ]

    static func prompt(id: Int) -> Prompt? {
        if let original = all.first(where: { $0.id == id }) { return original }
        guard case .success(let catalog) = TopicCatalog.bundled else { return nil }
        return catalog.round(id: id)?.prompt
    }
    static func randomSet() -> [Prompt] { Array(all.shuffled().prefix(5)) }
}
