import Likerts
import SwiftUI

// The host loads the collection, owns submission/retry state and controls
// eligibility. Dismissing the sheet must cancel the host's submission task.
public struct CheckoutFeedback: View {
    let collection: Collection
    let eligible: Bool
    let submitting: Bool
    let submit: ([String: Answer]) -> Void
    let cancel: () -> Void
    @State private var visible = false
    public init(collection: Collection, eligible: Bool, submitting: Bool,
                submit: @escaping ([String: Answer]) -> Void, cancel: @escaping () -> Void) {
        self.collection = collection; self.eligible = eligible; self.submitting = submitting
        self.submit = submit; self.cancel = cancel
    }
    public var body: some View {
        Button("Give feedback") { visible = true }
            .disabled(!eligible)
            .sheet(isPresented: $visible, onDismiss: cancel) {
                SurveyView(collection: collection, disabled: submitting, onSubmit: submit)
            }
    }
}
