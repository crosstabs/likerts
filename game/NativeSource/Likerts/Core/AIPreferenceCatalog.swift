import Foundation

/// Frozen version 1: complete, reviewed preferences. The model selects references;
/// it cannot supply nouns, clauses or sentences. Keep old versions for saved games.
enum AIPreferenceCatalog {
    static let currentVersion = 1
    enum Frame: String, Hashable, Sendable { case choice, routine, initiative, style }
    struct Idea: Equatable, Sendable {
        let id: Int
        let family: String
        let frame: Frame
        let variants: [String]
    }
    struct Selection: Equatable, Sendable {
        let ideaID: Int
        let variantID: Int
    }

    static func ideas(for theme: PackTheme, version: Int = currentVersion) -> [Idea] {
        guard version == 1 else { return [] }
        func idea(_ slot: Int, _ family: String, _ frame: Frame, _ first: String, _ second: String) -> Idea {
            let base: Int
            switch theme { case .everydayChaos: base = 0; case .foodTakes: base = 100; case .socialBattery: base = 200; case .sideQuests: base = 300 }
            return Idea(id: base + slot, family: family, frame: frame, variants: [first, second])
        }
        switch theme {
        case .everydayChaos: return [
            idea(1, "energy", .choice, "I would choose a slow morning over a busy evening.", "I would choose a busy evening over a slow morning."),
            idea(2, "planning", .routine, "I would write tomorrow's to-do list before going to bed.", "I would make my day's plans after breakfast."),
            idea(3, "playfulness", .initiative, "I would turn a simple errand into a tiny adventure.", "I would keep my errands short and straightforward."),
            idea(4, "keepsakes", .style, "I would keep a souvenir even when it has no practical use.", "I would keep only souvenirs I can actually use."),
            idea(5, "energy", .choice, "I would choose music while getting ready over complete quiet.", "I would choose complete quiet over music while getting ready."),
            idea(6, "planning", .routine, "I would finish one household task before starting another.", "I would switch between household tasks to keep things interesting."),
            idea(7, "playfulness", .initiative, "I would give my houseplants dramatic names.", "I would leave my houseplants without names."),
            idea(8, "keepsakes", .style, "I would save a small box of ticket stubs and notes.", "I would save photos instead of boxes of keepsakes.")
        ]
        case .foodTakes: return [
            idea(1, "flavour", .choice, "I would choose a savoury breakfast over a sweet one.", "I would choose a sweet breakfast over a savoury one."),
            idea(2, "ritual", .routine, "I would save my favourite bite until the end of a meal.", "I would eat my favourite bite first."),
            idea(3, "sharing", .initiative, "I would suggest one dish for everyone at the table to share.", "I would choose separate dishes so everyone gets their own."),
            idea(4, "texture", .style, "I would dip crispy fries into a milkshake.", "I would keep crispy fries separate from sweet food."),
            idea(5, "flavour", .choice, "I would choose mild flavour over extra chilli.", "I would choose extra chilli over mild flavour."),
            idea(6, "ritual", .routine, "I would arrange my snacks in little bowls before eating.", "I would eat my snacks straight from the packet."),
            idea(7, "sharing", .initiative, "I would offer everyone a taste before finishing my snack.", "I would keep my snack to myself unless someone asked."),
            idea(8, "texture", .style, "I would pick the crispest cookie on a plate.", "I would pick the softest cookie on a plate.")
        ]
        case .socialBattery: return [
            idea(1, "groupSize", .choice, "I would choose a quiet catch-up with one friend over a big party.", "I would choose a big party over a quiet catch-up with one friend."),
            idea(2, "planning", .routine, "I would arrive at a gathering with an exact plan for the evening.", "I would leave room for last-minute plans at a gathering."),
            idea(3, "participation", .initiative, "I would start a conversation with someone new.", "I would let new people come over to talk to me."),
            idea(4, "communication", .style, "I would send a short text instead of a voice note.", "I would send a voice note instead of a short text."),
            idea(5, "groupSize", .choice, "I would welcome an extra guest even after making the guest list.", "I would keep a gathering to its original guest list."),
            idea(6, "planning", .routine, "I would check all the gathering details a day early.", "I would check the gathering details just before leaving."),
            idea(7, "participation", .initiative, "I would volunteer to pick the background music.", "I would happily let someone else pick the background music."),
            idea(8, "communication", .style, "I would let a funny story grow into a long chat.", "I would keep stories brief and leave room for others.")
        ]
        case .sideQuests: return [
            idea(1, "exploring", .choice, "I would choose a tiny garden museum over a busy city square.", "I would choose a busy city square over a tiny garden museum."),
            idea(2, "creating", .routine, "I would draw a map for an imaginary town before writing its story.", "I would write an imaginary town's story before sketching its map."),
            idea(3, "collecting", .initiative, "I would start a collection of unusual pebbles.", "I would collect postcards instead of pebbles."),
            idea(4, "company", .style, "I would let a tiny dragon choose our book club's next story.", "I would choose our book club's next story myself."),
            idea(5, "exploring", .choice, "I would choose a scenic route to an ordinary destination.", "I would take the most direct route to an ordinary destination."),
            idea(6, "creating", .routine, "I would make a miniature village from cardboard boxes.", "I would sketch a miniature village on a sheet of paper."),
            idea(7, "collecting", .initiative, "I would look for interesting stamps on the day's post.", "I would collect small sketches in a notebook."),
            idea(8, "company", .style, "I would join a snail parade with a friend.", "I would watch a snail parade quietly on my own.")
        ]
        }
    }

    static func render(_ selections: [Selection], theme: PackTheme, version: Int = currentVersion) throws -> [String] {
        let menu = ideas(for: theme, version: version)
        guard selections.count == 5, !menu.isEmpty else { throw PackValidationError.qualityNotEstablished }
        let byID = Dictionary(uniqueKeysWithValues: menu.map { ($0.id, $0) })
        var chosen: [Idea] = [], statements: [String] = []
        for selection in selections {
            guard let idea = byID[selection.ideaID], idea.variants.indices.contains(selection.variantID) else {
                throw PackValidationError.qualityNotEstablished
            }
            chosen.append(idea); statements.append(idea.variants[selection.variantID])
        }
        guard Set(chosen.map(\.id)).count == 5,
              Set(chosen.map(\.family)).count >= 3, Set(chosen.map(\.frame)).count >= 3,
              Dictionary(grouping: chosen, by: \.family).values.allSatisfy({ $0.count <= 2 }),
              Dictionary(grouping: chosen, by: \.frame).values.allSatisfy({ $0.count <= 2 }) else {
            throw PackValidationError.qualityNotEstablished
        }
        return try PackValidator.validate(statements)
    }

    /// A second gate at the service/save boundary rejects free-form output even
    /// if its spelling/grammar is valid. No silent replacement earns an AI label.
    static func validate(_ statements: [String], theme: PackTheme, version: Int = currentVersion) throws {
        let menu = ideas(for: theme, version: version)
        var references: [Selection] = []
        for statement in statements {
            let matches = menu.flatMap { idea in
                idea.variants.enumerated().compactMap { index, text in
                    text == statement ? Selection(ideaID: idea.id, variantID: index) : nil
                }
            }
            guard matches.count == 1, let match = matches.first else { throw PackValidationError.qualityNotEstablished }
            references.append(match)
        }
        guard try render(references, theme: theme, version: version) == statements else { throw PackValidationError.qualityNotEstablished }
    }
}
