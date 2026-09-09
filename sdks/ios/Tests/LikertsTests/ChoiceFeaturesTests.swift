import Foundation
import XCTest
@testable import Likerts

final class ChoiceFeaturesTests: XCTestCase {
  private func fixture() throws -> [String: Any] {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("contracts/choice-features.json"))) as? [String: Any])
  }
  func testSharedValidValuesEncodeWithoutChangingWireShape() throws {
    let values = try fixture()
    let q = try JSONDecoder().decode(Question.self, from: JSONSerialization.data(withJSONObject: values["question"]!))
    for object in try XCTUnwrap(values["valid"] as? [[String: Any]]) {
      let selected = try XCTUnwrap(object["selected"] as? [String])
      let text = try XCTUnwrap(object["otherText"] as? [String: String])
      XCTAssertNil(q.choiceError(selected: selected, otherText: text))
      let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(q.choiceAnswer(selected: selected, otherText: text))) as? NSDictionary
      XCTAssertEqual(encoded, object as NSDictionary)
    }
    for object in try XCTUnwrap(values["invalid"] as? [Any]).compactMap({ $0 as? [String: Any] }) {
      let selected = try XCTUnwrap(object["selected"] as? [String])
      let text = try XCTUnwrap(object["otherText"] as? [String: String])
      XCTAssertNotNil(q.choiceError(selected: selected, otherText: text))
    }
    XCTAssertEqual(q.toggledChoices(["quality", "other"], option: "none"), ["none"])
    XCTAssertEqual(q.toggledChoices(["none"], option: "quality"), ["quality"])
  }

  @available(iOS 15.0, macOS 12.0, *)
  func testFormStateClearsOtherWhileKeepingPresentationValues() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    var schema = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("contracts/choice-survey.example.json"))) as? [String:Any])
    schema["schemaVersion"] = 3
    let collection = try JSONDecoder().decode(Collection.self, from: JSONSerialization.data(withJSONObject: ["id":"c","surveyId":"s","version":1,"placement":"p","schema":schema]))
    let q = collection.schema.questions[0]
    var state = SurveyFormState()
    state.selectChoice(question:q,option:"quality")
    state.selectChoice(question:q,option:"other")
    state.values["rating"]="4";state.values["channel"]="app"
    XCTAssertNotNil(state.validationError(collection:collection,strings:SurveyStrings()))
    state.otherText[q.id]=["other":"Speed"]
    XCTAssertNil(state.validationError(collection:collection,strings:SurveyStrings()))
    let data = try JSONEncoder().encode(state.answers(collection:collection))
    let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with:data) as? [String:Any])
    XCTAssertEqual(encoded["rating"] as? Int,4);XCTAssertEqual(encoded["channel"] as? String,"app")
    state.selectChoice(question:q,option:"none");state.discardHidden(collection:collection)
    XCTAssertTrue(state.otherText[q.id]?.isEmpty == true)
    XCTAssertNil(state.validationError(collection:collection,strings:SurveyStrings()))
    state.selectChoice(question:q,option:"quality");state.selectChoice(question:q,option:"other")
    XCTAssertNotNil(state.validationError(collection:collection,strings:SurveyStrings()))
    state.reset();XCTAssertTrue(state.otherText.isEmpty)
  }
}
