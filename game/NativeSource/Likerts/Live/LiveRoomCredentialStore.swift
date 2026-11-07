import Foundation
import Security
import CryptoKit

/// Only scoped access information is retained. No submitted answers or room snapshots.
struct LiveRoomCredential: Codable, Equatable, Sendable {
    let scope: String
    let code: String
    let token: String
    let memberId: String
    var expiresAt: Int64

    var isValid: Bool {
        !scope.isEmpty && LiveRoomState.validCode(code) && !memberId.isEmpty && memberId.count <= 100 &&
        (32...128).contains(token.utf8.count) && token.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95
        } && expiresAt > 0
    }
}

@MainActor protocol LiveRoomCredentialStoring {
    func load(scope: String) throws -> LiveRoomCredential?
    func save(_ credential: LiveRoomCredential) throws
    func remove(scope: String) throws
    func loadPending(scope: String) throws -> LiveRoomPendingAdmission?
    func savePending(_ admission: LiveRoomPendingAdmission) throws
    func removePending(scope: String) throws
}
enum LiveRoomCredentialError: Error { case unavailable, invalid }

struct LiveRoomPendingAdmission: Codable, Equatable, Sendable {
    static let maximumPendingBytes = 131_072
    let scope: String
    let admissionId: UUID
    let recoverySecret: String
    let code: String?
    let settings: LiveRoomSettings?
    let nickname: String?
    let expiresAt: Int64
    /// Exact frozen quiz upload, including recovery identity. Protected by the same
    /// device-only Keychain record and removed after admission; never a library reference.
    var quizRequest: Data? = nil
    var quizUpload: LiveQuizAdmissionPayload? {
        guard let quizRequest, quizRequest.count <= LiveQuizAdmissionPayload.maximumBytes else { return nil }
        return try? JSONDecoder().decode(LiveQuizAdmissionPayload.self, from: quizRequest)
    }
    var isValid: Bool {
        !scope.isEmpty && validPayload && recoverySecret.utf8.count == 43 &&
        recoverySecret.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 } && expiresAt > 0
    }
    private var validPayload: Bool {
        if let settings {
            guard settings.isValid, code == nil, nickname == nil else { return false }
            if quizRequest != nil {
                guard let payload = quizUpload else { return false }
                return payload.mode == "quiz" && payload.modeVersion == 1 &&
                    payload.admissionId == admissionId && payload.recoverySecret == recoverySecret &&
                    payload.settings.capacity == settings.capacity
            }
            return true
        }
        guard quizRequest == nil else { return false }
        guard let code, let nickname else { return false }
        return LiveRoomState.validCode(code) && LiveRoomState.validNickname(nickname)
    }
    static func make(scope: String, code: String? = nil, nickname: String? = nil, settings: LiveRoomSettings? = nil, quiz: QuizDocument? = nil) throws -> Self {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw LiveRoomCredentialError.unavailable }
        let secret = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        var pending = Self(scope: scope, admissionId: UUID(), recoverySecret: secret, code: code, settings: settings, nickname: nickname,
                    expiresAt: Int64(Date().timeIntervalSince1970 * 1_000) + 600_000)
        if let quiz {
            guard let settings, code == nil, nickname == nil else { throw LiveRoomCredentialError.invalid }
            let payload = LiveQuizAdmissionPayload(admissionId: pending.admissionId, recoverySecret: secret,
                mode: "quiz", modeVersion: 1, quiz: try quiz.normalized(), settings: LiveQuizSettings(capacity: settings.capacity))
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(payload)
            guard data.count <= LiveQuizAdmissionPayload.maximumBytes else { throw LiveRoomCredentialError.invalid }
            pending.quizRequest = data
        }
        guard pending.isValid else { throw LiveRoomCredentialError.invalid }
        return pending
    }
}

@MainActor final class KeychainLiveRoomCredentialStore: LiveRoomCredentialStoring {
    private let service = "studio.likerts.game.live.v1"
    private func query(scope: String, kind: String = "member") -> [String: Any] {
        let account = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service, kSecAttrAccount as String: kind + ":" + account,
                kSecAttrSynchronizable as String: false]
    }
    func load(scope: String) throws -> LiveRoomCredential? {
        var q = query(scope: scope); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count <= 4_096,
              let value = try? JSONDecoder().decode(LiveRoomCredential.self, from: data), value.scope == scope, value.isValid else {
            throw LiveRoomCredentialError.unavailable
        }
        return value
    }
    func save(_ credential: LiveRoomCredential) throws {
        guard credential.isValid else { throw LiveRoomCredentialError.invalid }
        let data = try JSONEncoder().encode(credential)
        let attributes: [String: Any] = [kSecValueData as String: data,
                                        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let q = query(scope: credential.scope)
        let status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var added = q; attributes.forEach { added[$0.key] = $0.value }
            guard SecItemAdd(added as CFDictionary, nil) == errSecSuccess else { throw LiveRoomCredentialError.unavailable }
        } else if status != errSecSuccess { throw LiveRoomCredentialError.unavailable }
    }
    func remove(scope: String) throws {
        let status = SecItemDelete(query(scope: scope) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw LiveRoomCredentialError.unavailable }
    }
    func loadPending(scope: String) throws -> LiveRoomPendingAdmission? {
        var q = query(scope: scope, kind: "admission"); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count <= LiveRoomPendingAdmission.maximumPendingBytes,
              let value = try? JSONDecoder().decode(LiveRoomPendingAdmission.self, from: data), value.scope == scope, value.isValid else {
            throw LiveRoomCredentialError.unavailable
        }
        return value
    }
    func savePending(_ admission: LiveRoomPendingAdmission) throws {
        guard admission.isValid else { throw LiveRoomCredentialError.invalid }
        let data = try JSONEncoder().encode(admission)
        guard data.count <= LiveRoomPendingAdmission.maximumPendingBytes else { throw LiveRoomCredentialError.invalid }
        let attributes: [String: Any] = [kSecValueData as String: data,
                                        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let q = query(scope: admission.scope, kind: "admission")
        let status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var added = q; attributes.forEach { added[$0.key] = $0.value }
            guard SecItemAdd(added as CFDictionary, nil) == errSecSuccess else { throw LiveRoomCredentialError.unavailable }
        } else if status != errSecSuccess { throw LiveRoomCredentialError.unavailable }
    }
    func removePending(scope: String) throws {
        let status = SecItemDelete(query(scope: scope, kind: "admission") as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw LiveRoomCredentialError.unavailable }
    }
}
