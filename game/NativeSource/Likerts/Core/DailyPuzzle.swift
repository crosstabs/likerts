import Foundation

/// A small authored fiction puzzle. There are no crowd statistics or live opponents.
/// Days roll over at midnight UTC, so friends get the same character for the same date.
struct DailyPuzzle: Equatable, Sendable {
    let key: String
    let name: String
    let tagline: String
    let bio: String
    let emoji: String
    let promptIDs: [Int]
    let answers: [Int]
    let clues: [String]

    /// Present the puzzle's fixed UTC date in the reader's regional format.
    /// The ISO key remains unchanged for persistence and rollover comparisons.
    func displayDate(locale: Locale = .current) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.calendar = Calendar(identifier: .gregorian)
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        parser.dateFormat = "yyyy-MM-dd"
        parser.isLenient = false
        guard let date = parser.date(from: key) else { return key }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    var challenge: Challenge {
        // These authored fixtures are validated in DailyPuzzleTests.
        try! Challenge(name: name, promptIDs: promptIDs, answers: answers)
    }

    static func today(date: Date = Date()) -> DailyPuzzle {
        let day = Int(floor(date.timeIntervalSince1970 / 86_400))
        let index = ((day % characters.count) + characters.count) % characters.count
        let character = characters[index]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        let key = String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
        return DailyPuzzle(
            key: key, name: character.name, tagline: character.tagline,
            bio: character.bio, emoji: character.emoji, promptIDs: character.promptIDs,
            answers: character.answers, clues: character.clues
        )
    }

    static func nextRefresh(after date: Date) -> Date {
        Date(timeIntervalSince1970: (floor(date.timeIntervalSince1970 / 86_400) + 1) * 86_400)
    }

    private static let characters: [DailyPuzzle] = [
        DailyPuzzle(
            key: "", name: "Pip", tagline: "The calendar gremlin", 
            bio: "Pip has a backup itinerary for the backup itinerary. Their idea of chaos is lunch at 12:04.",
            emoji: "🗓️", promptIDs: [7, 19, 29, 3, 4], answers: [5, 5, 5, 4, 1],
            clues: [
                "Their last holiday spreadsheet had tabs for the tabs. This is peak Pip.",
                "Pip carries a snack, a backup snack, and a snack for the backup snack. Always.",
                "They have a favourite 'waiting to look on time' bench. Every appointment.",
                "Most replies get a quiet practice run. A simple thumbs-up escapes sometimes.",
                "An unscheduled squirrel? Absolutely outside the itinerary. Never."
            ]
        ),
        DailyPuzzle(
            key: "", name: "Nova", tagline: "The side-quest magnet",
            bio: "Nova says yes before hearing the question. Their last shortcut involved a canoe and a very patient goose.",
            emoji: "🛼", promptIDs: [4, 9, 14, 18, 27], answers: [5, 5, 4, 5, 5],
            clues: [
                "Nova has already named the squirrel's quest 'Operation Acorn'. An immediate yes.",
                "There is a microphone in Nova's emergency kit. They were born ready.",
                "The duck is on their wish list. Usually they'd buy it, unless a canoe sale wins.",
                "Nova watched one landing video and called it 'basically driving'. Total confidence.",
                "They already have a dragon name picked out. Parking is tomorrow's problem."
            ]
        ),
        DailyPuzzle(
            key: "", name: "Bean", tagline: "The blanket enthusiast",
            bio: "Bean's weekend plans are a warm drink, a familiar show, and becoming one with the sofa. The sofa approves.",
            emoji: "🧸", promptIDs: [8, 15, 21, 23, 5], answers: [5, 5, 4, 1, 4],
            clues: [
                "Bean knows every line and still laughs before the joke. Rewatching is the whole plan.",
                "One raindrop and the blanket comes out. Plans are officially cancelled.",
                "Usually it's one favourite song on repeat. Occasionally a second song gets a turn.",
                "No breakfast can outweigh a ghost. Bean won't even watch the trailer.",
                "Bean usually slips away quietly. A best friend's party still earns a goodbye."
            ]
        ),
        DailyPuzzle(
            key: "", name: "Miso", tagline: "Friend to small things",
            bio: "Miso hosts birthday parties for ferns. Their robot vacuum has a tiny bed, which it stubbornly refuses to use.",
            emoji: "🪴", promptIDs: [2, 17, 11, 28, 22], answers: [5, 5, 4, 5, 5],
            clues: [
                "The fern is called Captain Frond and has a complicated childhood. Naturally.",
                "Miso learns every dog's name first. The humans can introduce themselves later.",
                "Most walks get a coordinated scarf. Very early walks sometimes get pyjamas.",
                "The vacuum's name is Crumb. Miso calls it a member of the family.",
                "An abandoned cart is a lonely little cart. Miso brings it home in any weather."
            ]
        ),
        DailyPuzzle(
            key: "", name: "Kit", tagline: "The craft-supply dragon",
            bio: "Kit has six unfinished hobbies and a cupboard labelled 'future masterpieces'. No sticker has ever been worthy of a surface.",
            emoji: "🧶", promptIDs: [20, 25, 13, 16, 1], answers: [5, 5, 5, 1, 2],
            clues: [
                "Kit bought a pottery wheel before touching clay. Buying everything is the ritual.",
                "The sticker collection lives in a special box. Using one is unthinkable.",
                "Every cable is 'probably for something important'. Kit has never thrown one away.",
                "Kit covers blurbs to avoid spoilers. Reading the ending first? Absolutely never.",
                "Kit needs their phone for craft tutorials. A week away is unlikely, but maybe at a retreat."
            ]
        ),
        DailyPuzzle(
            key: "", name: "Dot", tagline: "The cosmic receptionist",
            bio: "Dot believes everything deserves a warm welcome, including visitors from space and a toaster that's having a difficult morning.",
            emoji: "🛸", promptIDs: [24, 6, 26, 12, 10], answers: [5, 4, 5, 5, 3],
            clues: [
                "Dot has prepared 'So, how was the journey?' for first contact. Of course they'd chat.",
                "Dot usually offers a pre-dinner nibble. A very big lunch can change the plan.",
                "Every safe landing gets a standing ovation, seatbelt permitting. Always applause.",
                "Dot gives the toaster encouraging speeches. Especially when it burns breakfast.",
                "Pineapple pizza? Dot can see both sides. They're sincerely on the fence."
            ]
        ),
        DailyPuzzle(
            key: "", name: "Roo", tagline: "The snack diplomat",
            bio: "Roo can solve almost any disagreement with food. Singing in public, however, is a disagreement they refuse to have.",
            emoji: "🥨", promptIDs: [19, 10, 6, 30, 9], answers: [5, 5, 5, 4, 1],
            clues: [
                "Roo has snacks for the walk to the snack shop. Every journey qualifies.",
                "Roo has a pineapple-pizza defence speech ready. They're passionately in favour.",
                "Pre-dinner snacks are mandatory at Roo's place. Dinner deserves a warm-up.",
                "Most busy chats stay muted. The family recipe chat sometimes gets checked.",
                "Roo once hid behind a vending machine to avoid karaoke. Never the microphone."
            ]
        )
    ]
}

/// Keep a newer day's score when a previously saved puzzle is finished later.
enum DailyBest {
    static func updating(savedDate: String, savedScore: Int, puzzleDate: String, score: Int) -> (date: String, score: Int) {
        if savedDate == puzzleDate { return (savedDate, max(savedScore, score)) }
        if savedDate < puzzleDate { return (puzzleDate, score) }
        return (savedDate, savedScore)
    }
}
