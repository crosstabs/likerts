import Foundation
import Likerts
import XCTest

private struct HostedConfig: Decodable {
    let target, sdkVersion, baseUrl, collectionId, collectionToken, idempotencyKey: String
    let responseCap: Int
    let disposable: Bool
}

final class HostedTransportTests: XCTestCase {
    func testNativeClientFetchSubmitAndIdenticalRetry() async throws {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let input = directory.appendingPathComponent("likerts-hosted.json")
        guard FileManager.default.fileExists(atPath: input.path) else { throw XCTSkip("Hosted acceptance not configured") }
        var stage = "configuration"
        do {
            let config = try JSONDecoder().decode(HostedConfig.self, from: Data(contentsOf: input))
            guard config.target == "ios", config.sdkVersion == likertsSDKCapability.sdkVersion,
                  config.disposable, config.responseCap == 1, let base = URL(string: config.baseUrl), base.scheme == "https"
            else { throw HostedFailure.invalid }
            let sessionConfig = URLSessionConfiguration.ephemeral
            sessionConfig.timeoutIntervalForRequest = 10
            sessionConfig.timeoutIntervalForResource = 15
            let session = URLSession(configuration: sessionConfig)
            defer { session.invalidateAndCancel() }
            let client = LikertsClient(baseURL: base, collectionToken: config.collectionToken, timeout: 10, session: session)
            stage = "collection"
            let collection = try await client.collection(config.collectionId, refresh: true)
            guard collection.id == config.collectionId, collection.schema.questions.contains(where: { $0.id == "rating" && $0.type == "scale" }) else { throw HostedFailure.invalid }
            let submission = Submission(idempotencyKey: config.idempotencyKey, answers: ["rating": .number(5)], metadata: ["source": "synthetic-native-hosted", "target": "ios"])
            stage = "submit"
            let receipt = try await client.submit(collectionId: config.collectionId, submission: submission)
            guard receipt.collectionId == config.collectionId, receipt.accepted, receipt.chargedCents == 1, !receipt.responseId.isEmpty else { throw HostedFailure.invalid }
            stage = "identical_retry"
            let retry = try await client.submit(collectionId: config.collectionId, submission: submission)
            guard retry == receipt else { throw HostedFailure.invalid }
            let result: [String: Any] = ["target": "ios", "sdkVersion": "0.0.3", "result": "passed", "collectionId": receipt.collectionId,
                                       "responseId": receipt.responseId, "chargedCents": 1, "identicalRetrySameReceipt": true, "sdkRequests": 3,
                                       "boundary": "same-team synthetic native transport; ledger verified separately"]
            try JSONSerialization.data(withJSONObject: result, options: .sortedKeys).write(to: directory.appendingPathComponent("likerts-hosted-result.json"), options: .atomic)
        } catch { XCTFail("Hosted transport acceptance failed at \(stage) (details redacted)") }
    }
}
private enum HostedFailure: Error { case invalid }
