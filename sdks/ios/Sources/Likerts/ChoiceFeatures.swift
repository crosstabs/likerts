import Foundation

extension Question {
  public var hasOther: Bool { options?.contains { $0.other != nil } == true }

  public func choiceAnswer(selected: [String], otherText: [String: String] = [:]) -> Answer {
    if hasOther {
      let text = Dictionary(uniqueKeysWithValues: (options ?? []).filter {
        $0.other != nil && selected.contains($0.id)
      }.map { ($0.id, otherText[$0.id] ?? "") })
      return .other(selected: selected, otherText: text)
    }
    return type == "single_choice" ? .text(selected.first ?? "") : .choices(selected)
  }

  public func toggledChoices(_ current: [String], option id: String) -> [String] {
    guard let option = options?.first(where: { $0.id == id }) else { return current }
    if type == "single_choice" { return [id] }
    if current.contains(id) { return current.filter { $0 != id } }
    if option.exclusive == true { return [id] }
    return current.filter { id in options?.first(where: { $0.id == id })?.exclusive != true } + [id]
  }

  /// Returns a stable local-feedback code; hosts/renderers supply localized copy.
  public func choiceError(selected: [String], otherText: [String: String] = [:]) -> String? {
    if selected.isEmpty { return required == true ? "required" : nil }
    if Set(selected).count != selected.count || selected.contains(where: { id in
      options?.contains(where: { $0.id == id }) != true
    }) { return "invalid" }
    let exclusive = selected.contains { id in options?.contains { $0.id == id && $0.exclusive == true } == true }
    if exclusive && selected.count != 1 { return "invalid" }
    if type == "single_choice" {
      if selected.count != 1 { return "range" }
    } else if selected.count > (maxSelections ?? options?.count ?? 0)
      || (!exclusive && selected.count < Swift.max(minSelections ?? 0, required == true ? 1 : 0)) {
      return "range"
    }
    let expected = (options ?? []).filter { $0.other != nil && selected.contains($0.id) }
    if otherText.count != expected.count { return "other" }
    for option in expected {
      guard let text = otherText[option.id], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        text.unicodeScalars.count <= option.other!.maxLength else { return "other" }
    }
    return nil
  }
}
