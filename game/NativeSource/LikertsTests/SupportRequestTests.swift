import XCTest
@testable import Likerts

final class SupportRequestTests: XCTestCase {
    func testDraftOnlyContainsProvidedTextVersionAndBuild() throws {
        let request = SupportRequest(kind: .content, message: "The statement was hard to understand.", version: "1.0", build: "1")
        XCTAssertEqual(request.copyableDraft, "To: support@crosstabs.com\nSubject: [Likerts] Content report\n\nLikerts 1.0 (1)\n\nThe statement was hard to understand.")
        let components = try XCTUnwrap(URLComponents(url: request.mailURL, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.scheme, "mailto")
        XCTAssertEqual(components.path, "support@crosstabs.com")
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "subject", value: "[Likerts] Content report"), URLQueryItem(name: "body", value: request.body)])
    }
    func testUserTextCannotCreateRecipientsHeadersOrQueryParameters() throws {
        let text = "hi+there &bcc=someone@example.com?subject=changed#fragment\nBcc: reader@example.com\n🍋 café"
        let request = SupportRequest(kind: .help, message: text, version: "1.0", build: "1")
        let components = try XCTUnwrap(URLComponents(url: request.mailURL, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, SupportRequest.address)
        XCTAssertEqual(components.queryItems?.count, 2)
        XCTAssertEqual(components.queryItems?.map(\.name), ["subject", "body"])
        XCTAssertEqual(components.queryItems?.last?.value, "Likerts 1.0 (1)\n\n" + text)
        XCTAssertNil(components.fragment)
    }
    func testDraftIsBoundedAndKindsKeepDistinctSubjects() {
        let request = SupportRequest(kind: .privacy, message: String(repeating: "é", count: 4_500), version: "1.0", build: "1")
        XCTAssertEqual(request.body, "Likerts 1.0 (1)\n\n" + String(repeating: "é", count: 4_000))
        XCTAssertEqual(Set(SupportRequest.Kind.allCases.map(\.subject)).count, 3)
    }
    func testPublicPolicyLinkRequiresConfiguredHTTPSDestination() {
        for invalid: String? in [nil, "", "$(LIKERTS_PRIVACY_POLICY_URL)", "http://likerts.com/game/privacy", "mailto:support@crosstabs.com", "https://example.invalid/privacy", "https://user:password@likerts.com/game/privacy"] {
            XCTAssertNil(SupportRequest.privacyPolicyURL(invalid))
        }
        XCTAssertEqual(SupportRequest.privacyPolicyURL("https://likerts.com/game/privacy")?.absoluteString, "https://likerts.com/game/privacy")
    }
}
