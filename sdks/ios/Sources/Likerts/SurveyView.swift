#if canImport(SwiftUI)
  import SwiftUI
  #if canImport(UIKit)
    import UIKit
  #endif

  @available(iOS 15.0, macOS 12.0, *)
  public struct SurveyStrings: Sendable {
    public var selectAnswer: String
    public var requiredSuffix: String
    public var requiredError: String
    public var minimumSelectionsError: String
    public var maximumSelectionsError: String
    public var datePlaceholder: String
    public var otherError: String
    public var moveUp:String
    public var moveDown:String
    public var remaining:String
    public var advancedError:String
    public var back: String
    public var next: String
    public var progress: String
    public var submit: String
    public init(
      selectAnswer: String = "Select an answer", requiredSuffix: String = "required",
      requiredError: String = "{question}: an answer is required.",
      minimumSelectionsError: String = "{question}: choose at least {min} options.",
      maximumSelectionsError: String = "{question}: choose at most {max} options.",
      datePlaceholder: String = "YYYY-MM-DD", back: String = "Back", next: String = "Next",
      progress: String = "Page {current} of {total}", submit: String = "Submit",
      otherError: String = "{question}: enter valid text for the selected Other option.",
      moveUp:String="Move up",moveDown:String="Move down",remaining:String="{remaining} remaining",advancedError:String="{question}: complete the answer."
    ) {
      self.selectAnswer = selectAnswer
      self.requiredSuffix = requiredSuffix
      self.requiredError = requiredError
      self.minimumSelectionsError = minimumSelectionsError
      self.maximumSelectionsError = maximumSelectionsError
      self.datePlaceholder = datePlaceholder
      self.back = back
      self.next = next
      self.progress = progress
      self.submit = submit
      self.otherError = otherError
      self.moveUp=moveUp;self.moveDown=moveDown;self.remaining=remaining;self.advancedError=advancedError
    }
    func format(_ template: String, _ values: [String: String]) -> String {
      values.reduce(template) { result, pair in
        result.replacingOccurrences(of: "{\(pair.key)}", with: pair.value)
      }
    }
  }

  @available(iOS 15.0, macOS 12.0, *)
  public struct SurveyTheme {
    public var accentColor: Color
    public var titleFont: Font
    public var errorColor: Color
    public init(
      accentColor: Color = .accentColor, titleFont: Font = .headline, errorColor: Color = .red
    ) {
      self.accentColor = accentColor
      self.titleFont = titleFont
      self.errorColor = errorColor
    }
  }

  @available(iOS 15.0, macOS 12.0, *)
  struct SurveyFormState {
    var values: [String: String] = [:]
    var choices: [String: Set<String>] = [:]
    var otherText: [String: [String: String]] = [:]
    var rankings:[String:[String]]=[:]
    var matrices:[String:[String:[String]]]=[:]
    var allocations:[String:[String:Int]]=[:]
    mutating func reset() {
      values = [:]
      choices = [:]
      otherText = [:]
      rankings=[:];matrices=[:];allocations=[:]
    }
    mutating func toggle(question: String, option: String, selected: Bool) {
      if selected {
        choices[question, default: []].insert(option)
      } else {
        choices[question, default: []].remove(option)
      }
    }
    func selectedChoices(_ question: Question) -> [String] {
      question.type == "single_choice" ? (values[question.id].flatMap { $0.isEmpty ? nil : [$0] } ?? []) : (choices[question.id]?.sorted() ?? [])
    }
    func choiceDisabled(question: Question, option: Question.Option) -> Bool {
      let selected = choices[question.id, default: []]
      let hasExclusive = (question.options ?? []).contains { $0.exclusive == true && selected.contains($0.id) }
      return !selected.contains(option.id) && option.exclusive != true && !hasExclusive && selected.count >= (question.maxSelections ?? Int.max)
    }
    mutating func selectChoice(question: Question, option: String) {
      if question.type == "single_choice" { values[question.id] = option }
      else { choices[question.id] = Set(question.toggledChoices(selectedChoices(question), option: option)) }
      let selected = selectedChoices(question)
      otherText[question.id] = otherText[question.id, default: [:]].filter { selected.contains($0.key) }
    }
    mutating func setAllocation(question:String,item:String,text:String){var result=allocations[question] ?? [:];if let number=Int(text){result[item]=number}else{result.removeValue(forKey:item)};allocations[question]=result}
    func allAnswers(collection: Collection) -> [String: Answer] {
      var answers: [String: Answer] = [:]
      for q in collection.schema.questions {
        if q.type == "ranking", let value = rankings[q.id] { answers[q.id] = .ranking(value) }
        else if q.type == "matrix", let value = matrices[q.id], !value.isEmpty {
          if q.matrixMode == "single" { answers[q.id] = .matrixSingle(value.compactMapValues(\.first)) }
          else { answers[q.id] = .matrixMultiple(value) }
        }
        else if q.type == "constant_sum", let value = allocations[q.id], !value.isEmpty { answers[q.id] = .allocation(value) }
        else if q.type == "multiple_choice", let selected = choices[q.id], !selected.isEmpty {
          answers[q.id] = q.choiceAnswer(selected: selected.sorted(), otherText: otherText[q.id] ?? [:])
        } else if let value = values[q.id], !value.isEmpty {
          if q.type == "number" || q.type == "scale", let number = Double(value), number.isFinite {
            answers[q.id] = .number(number)
          } else if q.type == "single_choice" { answers[q.id] = q.choiceAnswer(selected: [value], otherText: otherText[q.id] ?? [:]) } else { answers[q.id] = .text(value) }
        }
      }
      return answers
    }
    mutating func discardHidden(collection: Collection) {
      let visible = Set(routedAnswers(collection.schema, answers: allAnswers(collection: collection)).keys)
      values = values.filter { visible.contains($0.key) }
      choices = choices.filter { visible.contains($0.key) }
      otherText = otherText.filter { visible.contains($0.key) }
      rankings=rankings.filter{visible.contains($0.key)};matrices=matrices.filter{visible.contains($0.key)};allocations=allocations.filter{visible.contains($0.key)}
    }
    func validationError(collection: Collection, strings: SurveyStrings, questionIDs: Set<String>? = nil) -> String? {
      let visible = visibleQuestionIDs(collection.schema.questions, answers: allAnswers(collection: collection))
      for q in collection.schema.questions {
        if !visible.contains(q.id) || !(questionIDs?.contains(q.id) ?? true) { continue }
        let selected = choices[q.id]
        let value = values[q.id]
        if ["ranking","matrix","constant_sum"].contains(q.type) {
          let valid:Bool
          if q.type=="ranking" { valid=rankings[q.id].map{AdvancedQuestions.validRanking($0,options:(q.options ?? []).map(\.id))} ?? false }
          else if q.type=="matrix" { valid=matrices[q.id].map{AdvancedQuestions.validMatrix($0,rows:(q.rows ?? []).map(\.id),columns:(q.columns ?? []).map(\.id),multiple:q.matrixMode=="multiple",required:q.required==true)} ?? (q.required != true) }
          else { valid=allocations[q.id].map{AdvancedQuestions.validAllocation($0,items:(q.items ?? []).map(\.id),total:q.total ?? 0)} ?? (q.required != true) }
          if !valid{return strings.format(strings.advancedError,["question":q.label])};continue
        }
        if q.required == true
          && (q.type == "multiple_choice" ? selected?.isEmpty != false : value?.isEmpty != false)
        {
          return strings.format(strings.requiredError, ["question": q.label])
        }
        if q.type == "single_choice" || q.type == "multiple_choice" {
          let ids = selectedChoices(q)
          if let error = q.choiceError(selected: ids, otherText: otherText[q.id] ?? [:]) {
            if error == "range" {
              let minimum = Swift.max(q.minSelections ?? 0, q.required == true ? 1 : 0)
              return strings.format(ids.count < minimum ? strings.minimumSelectionsError : strings.maximumSelectionsError, ["question":q.label,"min":String(minimum),"max":String(q.maxSelections ?? q.options?.count ?? 0)])
            }
            return strings.format(strings.otherError, ["question":q.label])
          }
        }
      }
      return nil
    }
    func answers(collection: Collection) -> [String: Answer] {
      routedAnswers(collection.schema, answers: allAnswers(collection: collection))
    }
  }

  @available(iOS 15.0, macOS 12.0, *)
  private struct ConstantSumField:View {
    let question:Question
    let item:PromptItem
    let collection:Collection
    @Binding var state:SurveyFormState
    @Binding var validationError:String?
    var body:some View {
      TextField(item.label,text:Binding(
        get:{state.allocations[question.id]?[item.id].map(String.init) ?? ""},
        set:{text in state.setAllocation(question:question.id,item:item.id,text:text);state.discardHidden(collection:collection);validationError=nil}
      )).accessibilityLabel("\(question.label): \(item.label)")
    }
  }

  /// Native renderer. The host owns network lifecycle, placement, dismissal and server-error presentation.
  @available(iOS 15.0, macOS 12.0, *)
  public struct SurveyView: View {
    let collection: Collection
    let disabled: Bool
    let strings: SurveyStrings
    let theme: SurveyTheme
    let accessibilityIdentifierPrefix: String
    let onSubmit: ([String: Answer]) -> Void
    @State private var validationError: String?
    @State private var state = SurveyFormState()
    @State private var currentPage = 0
    @State private var history = [0]
    public init(
      collection: Collection, disabled: Bool = false, strings: SurveyStrings = SurveyStrings(),
      theme: SurveyTheme = SurveyTheme(), accessibilityIdentifierPrefix: String = "likerts",
      onSubmit: @escaping ([String: Answer]) -> Void
    ) {
      self.collection = collection
      self.disabled = disabled
      self.strings = strings
      self.theme = theme
      self.accessibilityIdentifierPrefix = accessibilityIdentifierPrefix
      self.onSubmit = onSubmit
    }
    public var body: some View {
      let pages = collection.schema.pages ?? [SurveyPage(id: "survey", questionIds: collection.schema.questions.map(\.id))]
      let answers = state.allAnswers(collection: collection)
      let route = pageRoute(collection.schema, answers: answers)
      let currentIDs = Set(pages[currentPage].questionIds)
      Form {
        Text(collection.schema.title).font(theme.titleFont).accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("\(accessibilityIdentifierPrefix).title")
        if collection.schema.pages != nil {
          Text(strings.format(strings.progress, ["current": String(currentPage + 1), "total": String(pages.count)]))
            .accessibilityIdentifier("\(accessibilityIdentifierPrefix).progress")
        }
        ForEach(collection.schema.questions.filter { currentIDs.contains($0.id) && visibleQuestionIDs(collection.schema.questions, answers: state.allAnswers(collection: collection)).contains($0.id) }, id: \.id) { q in
          Section(
            header: Text(q.label + (q.required == true ? " (\(strings.requiredSuffix))" : ""))
              .accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id).label")
          ) {
            if q.type=="ranking" {
              let order = state.rankings[q.id] ?? (q.options ?? []).map(\.id)
              ForEach(Array(order.enumerated()),id:\.element){index,id in
                let itemLabel = q.options?.first{$0.id == id}?.label ?? id
                HStack {
                  Text("\(index + 1). \(itemLabel)")
                  Button(strings.moveUp) { state.rankings[q.id] = AdvancedQuestions.move(order,id:id,offset:-1);validationError = nil }
                    .disabled(index == 0).accessibilityLabel("\(strings.moveUp): \(itemLabel)")
                  Button(strings.moveDown) { state.rankings[q.id] = AdvancedQuestions.move(order,id:id,offset:1);validationError = nil }
                    .disabled(index == order.count - 1).accessibilityLabel("\(strings.moveDown): \(itemLabel)")
                }
              }
            } else if q.type=="matrix" {
              ForEach(q.rows ?? [],id:\.id){row in VStack(alignment:.leading){Text(row.label);ForEach(q.columns ?? [],id:\.id){column in let selected=state.matrices[q.id]?[row.id]?.contains(column.id)==true;Toggle(column.label,isOn:Binding(get:{selected},set:{on in var values=state.matrices[q.id] ?? [:];if q.matrixMode=="single"{if on{values[row.id]=[column.id]}else{values.removeValue(forKey:row.id)}}else{values=AdvancedQuestions.setMatrix(values,row:row.id,column:column.id,multiple:true)};state.matrices[q.id]=values;state.discardHidden(collection:collection);validationError=nil})).accessibilityLabel("\(row.label): \(column.label)")}}
              }
            } else if q.type=="constant_sum" {
              ForEach(q.items ?? [],id:\.id){item in ConstantSumField(question:q,item:item,collection:collection,state:$state,validationError:$validationError)}
              let remaining = AdvancedQuestions.remaining(total:q.total ?? 0,answer:state.allocations[q.id] ?? [:])
              Text(strings.format(strings.remaining,["remaining":String(remaining)]))
            } else if q.type == "single_choice" {
              Picker(
                q.label,
                selection: Binding(
                  get: { state.values[q.id] ?? "" },
                  set: {
                    state.selectChoice(question: q, option: $0)
                    state.discardHidden(collection: collection)
                    validationError = nil
                  })
              ) {
                Text(strings.selectAnswer).tag("")
                ForEach(q.options ?? [], id: \.id) { option in Text(option.label).tag(option.id) }
              }.likertsChoicePresentation(q.presentation).accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id)")
                .accessibilityLabel(q.label)
            } else if q.type == "multiple_choice" {
              ForEach(q.options ?? [], id: \.id) { option in
                let selected = state.choices[q.id, default: []].contains(option.id)
                Toggle(
                  option.label,
                  isOn: Binding(
                    get: { selected },
                    set: { _ in
                      state.selectChoice(question: q, option: option.id)
                      state.discardHidden(collection: collection)
                      validationError = nil
                    })
                ).disabled(state.choiceDisabled(question: q, option: option)).accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id).\(option.id)")
                  .accessibilityLabel("\(q.label): \(option.label)")
              }
            } else if q.presentation == "stars" {
              ForEach(1...Int(q.max ?? 5), id: \.self) { value in
                Button(String(repeating: "★", count: value)) {
                  state.values[q.id] = String(value)
                  state.discardHidden(collection: collection)
                  validationError = nil
                }.buttonStyle(.borderless).accessibilityLabel("\(q.label): \(q.scaleLabel(value))")
                  .accessibilityValue(state.values[q.id] == String(value) ? "✓" : "")
                  .accessibilityAddTraits(state.values[q.id] == String(value) ? .isSelected : [])
                  .accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id).\(value)")
              }
            } else if !q.scaleValues.isEmpty {
              Picker(
                q.label,
                selection: Binding(
                  get: { state.values[q.id] ?? "" },
                  set: {
                    state.values[q.id] = $0
                    state.discardHidden(collection: collection)
                    validationError = nil
                  })
              ) {
                Text(strings.selectAnswer).tag("")
                ForEach(q.scaleValues, id: \.self) { value in
                  Text(q.scaleLabel(value)).tag(String(value))
                }
              }.accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id)")
                .accessibilityLabel(q.label)
            } else {
              TextField(
                q.type == "date" ? strings.datePlaceholder : q.label,
                text: Binding(
                  get: { state.values[q.id] ?? "" },
                  set: {
                    state.values[q.id] = $0
                    state.discardHidden(collection: collection)
                    validationError = nil
                  })
              ).accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id)")
                .accessibilityLabel(
                  q.label + (q.required == true ? ", \(strings.requiredSuffix)" : ""))
            }
            ForEach((q.options ?? []).filter { $0.other != nil && state.selectedChoices(q).contains($0.id) }, id: \.id) { option in
              TextField("\(q.label): \(option.label)", text: Binding(
                get: { state.otherText[q.id]?[option.id] ?? "" },
                set: { state.otherText[q.id, default: [:]][option.id] = $0; state.discardHidden(collection: collection); validationError = nil }
              )).accessibilityLabel("\(q.label): \(option.label)")
                .accessibilityIdentifier("\(accessibilityIdentifierPrefix).\(q.id).\(option.id).text")
            }
          }
        }
        if let validationError {
          Text(validationError).foregroundColor(theme.errorColor).accessibilityIdentifier(
            "\(accessibilityIdentifierPrefix).error"
          ).accessibilityLabel(validationError)
        }
        if collection.schema.pages != nil && history.count > 1 {
          Button(strings.back) {
            history.removeLast()
            currentPage = history.last!
            validationError = nil
          }.accessibilityIdentifier("\(accessibilityIdentifierPrefix).back")
        }
        Button((route.firstIndex(of: currentPage) ?? 0) + 1 < route.count ? strings.next : strings.submit) {
          validationError = state.validationError(collection: collection, strings: strings, questionIDs: currentIDs)
          guard validationError == nil else {
            announce(validationError!)
            return
          }
          if let at = route.firstIndex(of: currentPage), at + 1 < route.count {
            currentPage = route[at + 1]
            history = Array(route.prefix(at + 2))
          } else {
            onSubmit(state.answers(collection: collection))
          }
        }.accessibilityIdentifier("\(accessibilityIdentifierPrefix).\((route.firstIndex(of: currentPage) ?? 0) + 1 < route.count ? "next" : "submit")")
      }.tint(theme.accentColor).disabled(disabled).likertsOnChange(of: collection.id) {
        state.reset()
        currentPage = 0
        history = [0]
        validationError = nil
      }
    }
    private func announce(_ message: String) {
      #if canImport(UIKit)
        UIAccessibility.post(notification: .announcement, argument: message)
      #endif
    }
  }

  @available(iOS 15.0, macOS 12.0, *)
  extension View {
    @ViewBuilder fileprivate func likertsChoicePresentation(_ presentation: String?) -> some View {
      if presentation == "dropdown" { self.pickerStyle(.menu) } else { self }
    }

    @ViewBuilder fileprivate func likertsOnChange<Value: Equatable>(
      of value: Value, action: @escaping () -> Void
    ) -> some View {
      if #available(iOS 17.0, macOS 14.0, *) {
        self.onChange(of: value) { _, _ in action() }
      } else {
        self.onChange(of: value) { _ in action() }
      }
    }
  }
#endif
