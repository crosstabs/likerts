import CryptoKit
import Foundation
import Likerts
import Security
import XCTest

private enum AdapterError: Error { case keychain(OSStatus), missingCombinedCiphertext }

/// Test-only adapter: actual Keychain/CryptoKit APIs and backup-excluded durable storage.
private actor DeviceQueueAdapter: OfflineSecureAdapter {
    nonisolated let protectionProfile = "keychain_device_only_aes_gcm"
    let service: String
    let file: URL
    init(service: String, file: URL) { self.service = service; self.file = file }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "queue-key"]
    }
    func createKey() throws {
        var values = query
        values[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        values[kSecValueData as String] = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        let status = SecItemAdd(values as CFDictionary, nil)
        guard status == errSecSuccess else { throw AdapterError.keychain(status) }
    }
    private func key() throws -> SymmetricKey {
        var values = query
        values[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(values as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { throw AdapterError.keychain(status) }
        return SymmetricKey(data: data)
    }
    func keyProtection() throws -> String {
        var values = query
        values[kSecReturnAttributes as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(values as CFDictionary, &result)
        guard status == errSecSuccess, let attributes = result as? [String: Any],
              let protection = attributes[kSecAttrAccessible as String] as? String
        else { throw AdapterError.keychain(status) }
        return protection
    }
    func deleteKey() { SecItemDelete(query as CFDictionary) }
    func load() throws -> [Data] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        return try PropertyListDecoder().decode([Data].self, from: Data(contentsOf: file))
    }
    func replace(_ records: [Data]) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        var directory = file.deletingLastPathComponent()
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try PropertyListEncoder().encode(records).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func seal(_ clear: Data) throws -> Data {
        guard let combined = try AES.GCM.seal(clear, using: key()).combined else { throw AdapterError.missingCombinedCiphertext }
        return combined
    }
    func open(_ sealed: Data) throws -> Data { try AES.GCM.open(AES.GCM.SealedBox(combined: sealed), using: key()) }
    func cleanup() { deleteKey(); try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
}

final class KeychainOfflineTests: XCTestCase {
    private func adapter() throws -> DeviceQueueAdapter {
        let id = "likerts-test-\(UUID().uuidString)"
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return DeviceQueueAdapter(service: id, file: root.appendingPathComponent(id).appendingPathComponent("queue.plist"))
    }
    func testKeychainCiphertextReopensAndRequiresAcceptedReceipt() async throws {
        let storage = try adapter()
        try await storage.createKey()
        do {
            let protection = try await storage.keyProtection()
            XCTAssertEqual(protection, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
            let queue = try OfflineQueue(adapter: storage)
            let payload = Data("{\"answers\":{\"private\":\"sensitive native answer\"}}".utf8)
            let id = try await queue.enqueue(collectionId: "native-collection", submission: payload, idempotencyKey: "native-id")
            let raw = try Data(contentsOf: storage.file)
            XCTAssertNil(raw.range(of: Data("native-collection".utf8)))
            XCTAssertNil(raw.range(of: payload))
            XCTAssertEqual(try storage.file.deletingLastPathComponent().resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)

            let reopenedStorage = DeviceQueueAdapter(service: storage.service, file: storage.file)
            let reopened = try OfflineQueue(adapter: reopenedStorage)
            let reopenedStatus = try await reopened.snapshot()
            XCTAssertEqual(reopenedStatus.pending, 1)
            let sameId = try await reopened.enqueue(collectionId: "native-collection", submission: payload, idempotencyKey: "native-id")
            XCTAssertEqual(sameId, id)
            let token = "ephemeral-test-credential-never-persist"
            let retry = try await reopened.flush(credential: { _ in token }, send: { collection, credential, actual in
                XCTAssertEqual(collection, "native-collection")
                XCTAssertEqual(credential, token)
                XCTAssertEqual(actual, payload)
                return OfflineAttempt(status: 503, retryAfterSeconds: 5)
            })
            XCTAssertEqual(retry.accepted, 0)
            XCTAssertEqual(retry.status.pending, 1)
            let clear = try await reopenedStorage.open(reopenedStorage.load().first!)
            XCTAssertNil(clear.range(of: Data(token.utf8)))
            let invalid = try await reopened.flush(credential: { _ in token }, send: { _, _, _ in
                OfflineAttempt(status: 200, responseId: "response", receiptCollectionId: "wrong", accepted: true)
            })
            XCTAssertEqual(invalid.status.pending, 1)
            let accepted = try await reopened.flush(credential: { _ in token }, send: { collection, _, actual in
                XCTAssertEqual(actual, payload)
                return OfflineAttempt(status: 201, responseId: "response", receiptCollectionId: collection, accepted: true)
            })
            XCTAssertEqual(accepted.accepted, 1)
            let final = try await OfflineQueue(adapter: DeviceQueueAdapter(service: storage.service, file: storage.file)).snapshot()
            XCTAssertEqual(final.pending, 0)
            await storage.cleanup()
        } catch { await storage.cleanup(); throw error }
    }
    func testTamperingAndLostKeyQuarantineWithoutSending() async throws {
        let storage = try adapter()
        try await storage.createKey()
        do {
            let queue = try OfflineQueue(adapter: storage)
            _ = try await queue.enqueue(collectionId: "collection", submission: Data("{}".utf8), idempotencyKey: "tamper")
            var damaged = try await storage.load().first!
            damaged[damaged.count - 1] ^= 1
            try await storage.replace([damaged])
            let status = try await queue.snapshot()
            XCTAssertEqual(status.quarantined, 1)
            let result = try await queue.flush(credential: { _ in XCTFail("Quarantine requested a credential"); return nil }, send: { _, _, _ in
                XCTFail("Quarantined record was sent"); return OfflineAttempt(status: 0)
            })
            XCTAssertEqual(result.attempted, 0)
            let purged = try await queue.purgeQuarantined()
            XCTAssertEqual(purged, 1)
            _ = try await queue.enqueue(collectionId: "collection", submission: Data("{}".utf8), idempotencyKey: "lost-key")
            await storage.deleteKey()
            let reopened = try OfflineQueue(adapter: DeviceQueueAdapter(service: storage.service, file: storage.file))
            let lost = try await reopened.snapshot()
            XCTAssertEqual(lost.pending, 0)
            XCTAssertEqual(lost.quarantined, 1)
            let lostPurged = try await reopened.purgeQuarantined()
            XCTAssertEqual(lostPurged, 1)
            await storage.cleanup()
        } catch { await storage.cleanup(); throw error }
    }
}
