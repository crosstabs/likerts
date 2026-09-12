import Likerts
import SwiftUI

@main
struct LikertsSampleApp: App {
  var body: some Scene { WindowGroup { SampleSurveyScreen() } }
}

struct SampleSurveyScreen: View {
  @State private var submitted = false
  private let collection = try! Collection(
    id: "sample", surveyId: "sample-survey", version: 1, placement: "sample-app",
    schema: SurveySchema(
      schemaVersion: 1, title: "Experiencia de compra",
      questions: [
        Question(id: "comment", type: "text", label: "Comentario", required: true, maxLength: 200)
      ]))

  var body: some View {
    if submitted {
      Text("Respuesta preparada").accessibilityIdentifier("sample.completed")
    } else {
      SurveyView(
        collection: collection,
        strings: SurveyStrings(
          requiredSuffix: "obligatorio", requiredError: "Falta {question}", submit: "Enviar"),
        theme: SurveyTheme(accentColor: .purple),
        onSubmit: { _ in submitted = true })
    }
  }
}
