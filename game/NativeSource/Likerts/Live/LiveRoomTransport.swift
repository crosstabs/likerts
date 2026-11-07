import Foundation

enum LiveRoomTransportError: Error, Equatable, Sendable {
    case service(status: Int, code: String), invalidResponse, unavailable
    var endsSession: Bool {
        if case .service(let status, _) = self { return [401, 403, 404, 410].contains(status) }
        return false
    }
    var isDefiniteRejection: Bool {
        if case .service(let status, _) = self { return (400...499).contains(status) && status != 408 }
        return false
    }
    var message: String {
        switch self {
        case .service(let status, let code):
            if status == 429 { return "A few too many requests. Wait a moment, then reconnect." }
            if code == "room_locked" { return "This room is not accepting players. Ask the host to open the lobby, or enter another room code." }
            if code == "room_full" { return "This room is full. Ask the host about space, or enter another room code." }
            if [401, 403, 404, 410].contains(status) { return "This room has ended, expired, or your access has changed. You can join another room." }
            if code.contains("nickname") || code.contains("name") { return "Choose a different nickname: 1–20 letters or numbers, with no personal contact details." }
            if status == 409 { return "The room changed while that action was travelling. Reconnect to see the current round." }
            return "The room could not accept that action. Reconnect and try again." 
        case .invalidResponse: return "This room's data could not be verified. Update Likerts or try a new room."
        case .unavailable: return "The live service could not be reached. Check your connection, then reconnect."
        }
    }
}

protocol LiveRoomTransporting: Sendable {
    func create(settings: LiveRoomSettings, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission
    func createQuiz(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission
    func join(code: String, nickname: String, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission
    func recover(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission
    func snapshot(credential: LiveRoomCredential) async throws -> LiveRoomState
    func perform(_ command: LiveRoomCommand, credential: LiveRoomCredential) async throws -> LiveRoomState?
    func states(credential: LiveRoomCredential) -> AsyncThrowingStream<LiveRoomState, Error>
}

extension LiveRoomTransporting {
    /// Legacy transport doubles remain valid for mind-reading tests. A transport
    /// must explicitly implement quiz creation before it can upload creator data.
    func createQuiz(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        throw LiveRoomTransportError.invalidResponse
    }
}

/// Reject extra state fields as well as invalid role projections. No raw response is logged.
enum LiveRoomWireDecoder {
    static let maximumBytes = 262_144
    private static let stateKeys: Set<String> = ["protocolVersion", "code", "matchId", "revision", "serverTime", "expiresAt", "catalogVersion", "catalogHash", "role", "self", "phase", "joinLocked", "settings", "hostConnected", "players", "round", "reveal", "leaderboard", "completion", "notice"]
    private static let quizStateKeys: Set<String> = ["protocolVersion", "mode", "modeVersion", "code", "matchId", "revision", "serverTime", "expiresAt", "role", "self", "phase", "joinLocked", "settings", "hostConnected", "players", "round", "reveal", "leaderboard", "completion", "notice", "quiz"]
    private static func object(_ data: Data) throws -> [String: Any] {
        guard !data.isEmpty, data.count <= maximumBytes,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw LiveRoomTransportError.invalidResponse }
        return value
    }
    private static func keys(_ object: [String: Any], _ allowed: Set<String>) throws {
        guard Set(object.keys).isSubset(of: allowed) else { throw LiveRoomTransportError.invalidResponse }
    }
    private static func exactKeys(_ object: [String: Any], _ allowed: Set<String>) throws {
        guard Set(object.keys) == allowed else { throw LiveRoomTransportError.invalidResponse }
    }
    private static func inspectState(_ raw: Any?) throws {
        guard let state = raw as? [String: Any] else { throw LiveRoomTransportError.invalidResponse }
        if state["protocolVersion"] as? Int == 2 { try inspectQuizState(state); return }
        try keys(state, stateKeys)
        if let viewer = state["self"] as? [String: Any] { try keys(viewer, ["id", "nickname"]) }
        if let settings = state["settings"] as? [String: Any] { try keys(settings, ["topic", "cycles", "capacity", "answerSeconds", "predictSeconds"]) }
        for player in state["players"] as? [[String: Any]] ?? [] { try keys(player, ["id", "nickname", "avatar", "connected"]) }
        if let round = state["round"] as? [String: Any] {
            try keys(round, ["id", "index", "total", "subjectId", "subjectName", "prompt", "deadline", "paused", "answerLocked", "submittedCount", "eligibleCount", "ownAnswer", "ownGuess"])
            if let prompt = round["prompt"] as? [String: Any] { try keys(prompt, ["id", "text", "topic", "sceneSummary"]) }
        }
        if let reveal = state["reveal"] as? [String: Any] {
            try keys(reveal, ["answer", "valid", "reason", "guesses", "groupAccuracy"])
            for guess in reveal["guesses"] as? [[String: Any]] ?? [] { try keys(guess, ["playerId", "nickname", "value", "points"]) }
        }
        for row in state["leaderboard"] as? [[String: Any]] ?? [] { try keys(row, ["playerId", "nickname", "points", "opportunities", "accuracy", "rank"]) }
    }
    private static func inspectQuizState(_ state: [String: Any]) throws {
        guard Set(state.keys) == quizStateKeys else { throw LiveRoomTransportError.invalidResponse }
        try keys(state, quizStateKeys)
        if let viewer = state["self"] as? [String: Any] { try exactKeys(viewer, ["id", "nickname"]) }
        if let settings = state["settings"] as? [String: Any] { try exactKeys(settings, ["capacity"]) }
        if let quiz = state["quiz"] as? [String: Any] { try exactKeys(quiz, ["id", "title", "questionCount"]) }
        for player in state["players"] as? [[String: Any]] ?? [] { try exactKeys(player, ["id", "nickname", "avatar", "connected"]) }
        if let round = state["round"] as? [String: Any] {
            try exactKeys(round, ["id", "index", "total", "questionId", "prompt", "answers", "deadline", "submittedCount", "eligibleCount", "ownAnswer"])
        }
        if let reveal = state["reveal"] as? [String: Any] {
            try exactKeys(reveal, ["correctAnswer", "explanation", "valid", "reason", "results", "groupAccuracy"])
            for result in reveal["results"] as? [[String: Any]] ?? [] { try exactKeys(result, ["playerId", "nickname", "value", "points"]) }
        }
        for row in state["leaderboard"] as? [[String: Any]] ?? [] { try exactKeys(row, ["playerId", "nickname", "points", "opportunities", "accuracy", "rank"]) }
    }
    static func admission(_ data: Data) throws -> LiveRoomAdmission {
        let raw = try object(data); try keys(raw, ["code", "token", "memberId", "state"]); try inspectState(raw["state"])
        let value = try JSONDecoder().decode(LiveRoomAdmission.self, from: data)
        _ = try value.state.validated(code: value.code, memberId: value.memberId)
        return value
    }
    static func state(_ data: Data) throws -> LiveRoomState {
        let raw = try object(data); try keys(raw, ["state"]); try inspectState(raw["state"])
        return try JSONDecoder().decode(LiveRoomStateResponse.self, from: data).state.validated()
    }
    static func action(_ data: Data) throws -> LiveRoomState? {
        let raw = try object(data); try keys(raw, ["state", "closed", "left"])
        if raw["state"] is NSNull || raw["state"] == nil {
            guard raw["closed"] as? Bool == true || raw["left"] as? Bool == true else { throw LiveRoomTransportError.invalidResponse }
            return nil
        }
        try inspectState(raw["state"])
        return try JSONDecoder().decode(LiveRoomStateResponse.self, from: data).state.validated()
    }
    static func socket(_ data: Data) throws -> LiveRoomState {
        let raw = try object(data); try keys(raw, ["type", "state", "error"])
        let message = try JSONDecoder().decode(LiveRoomSocketMessage.self, from: data)
        if message.type == "error" {
            throw LiveRoomTransportError.service(status: 400, code: message.error?.code ?? "socket_error")
        }
        guard message.type == "state", let state = message.state else { throw LiveRoomTransportError.invalidResponse }
        try inspectState(raw["state"])
        return try state.validated()
    }
}

private final class LiveRoomNoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class URLSessionLiveRoomTransport: LiveRoomTransporting, @unchecked Sendable {
    private let configuration: LiveRoomConfiguration
    private let session: URLSession
    private let delegate: LiveRoomNoRedirectDelegate
    init(configuration: LiveRoomConfiguration) {
        self.configuration = configuration
        let settings = URLSessionConfiguration.ephemeral
        settings.urlCache = nil; settings.httpShouldSetCookies = false; settings.httpCookieStorage = nil
        settings.requestCachePolicy = .reloadIgnoringLocalCacheData
        settings.timeoutIntervalForRequest = 12; settings.timeoutIntervalForResource = 18
        settings.waitsForConnectivity = false
        let delegate = LiveRoomNoRedirectDelegate(); self.delegate = delegate
        session = URLSession(configuration: settings, delegate: delegate, delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    private func request(path: String, method: String, token: String? = nil, body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: configuration.apiBaseURL.appendingPathComponent(path))
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }
    private func data(for request: URLRequest) async throws -> Data {
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw LiveRoomTransportError.invalidResponse }
        if let length = response.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init), length > LiveRoomWireDecoder.maximumBytes {
            throw LiveRoomTransportError.invalidResponse
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < LiveRoomWireDecoder.maximumBytes else { throw LiveRoomTransportError.invalidResponse }
            data.append(byte)
            if data.count.isMultiple(of: 4_096) { try Task.checkCancellation() }
        }
        try Task.checkCancellation()
        guard (200...299).contains(response.statusCode) else {
            let code = (try? JSONDecoder().decode(LiveRoomErrorResponse.self, from: data).error.code) ?? "request_failed"
            throw LiveRoomTransportError.service(status: response.statusCode, code: String(code.prefix(80)))
        }
        guard response.value(forHTTPHeaderField: "Content-Type")?.lowercased().hasPrefix("application/json") == true else { throw LiveRoomTransportError.invalidResponse }
        return data
    }
    func create(settings: LiveRoomSettings, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        struct Body: Encodable { let admissionId: UUID; let recoverySecret: String; let settings: LiveRoomSettings }
        guard settings.isValid, pending.isValid else { throw LiveRoomTransportError.invalidResponse }
        return try LiveRoomWireDecoder.admission(await data(for: request(path: "rooms", method: "POST", body: JSONEncoder().encode(Body(admissionId: pending.admissionId, recoverySecret: pending.recoverySecret, settings: settings)))))
    }
    func createQuiz(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        guard pending.isValid, let body = pending.quizRequest else { throw LiveRoomTransportError.invalidResponse }
        return try LiveRoomWireDecoder.admission(await data(for: request(path: "rooms", method: "POST", body: body)))
    }
    func join(code: String, nickname: String, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        struct Body: Encodable { let admissionId: UUID; let recoverySecret: String; let nickname: String; let acceptRoomSharing = true }
        guard LiveRoomState.validCode(code), pending.isValid else { throw LiveRoomTransportError.invalidResponse }
        return try LiveRoomWireDecoder.admission(await data(for: request(path: "rooms/\(code)/join", method: "POST", body: JSONEncoder().encode(Body(admissionId: pending.admissionId, recoverySecret: pending.recoverySecret, nickname: nickname)))))
    }
    func recover(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        struct Body: Encodable { let admissionId: UUID; let recoverySecret: String }
        guard pending.isValid else { throw LiveRoomTransportError.invalidResponse }
        return try LiveRoomWireDecoder.admission(await data(for: request(path: "admissions/recover", method: "POST", body: JSONEncoder().encode(Body(admissionId: pending.admissionId, recoverySecret: pending.recoverySecret)))))
    }
    func snapshot(credential: LiveRoomCredential) async throws -> LiveRoomState {
        let state = try LiveRoomWireDecoder.state(await data(for: request(path: "rooms/\(credential.code)", method: "GET", token: credential.token)))
        return try state.validated(code: credential.code, memberId: credential.memberId)
    }
    func perform(_ command: LiveRoomCommand, credential: LiveRoomCredential) async throws -> LiveRoomState? {
        let state = try LiveRoomWireDecoder.action(await data(for: request(path: "rooms/\(credential.code)/actions", method: "POST", token: credential.token, body: JSONEncoder().encode(command))))
        return try state?.validated(code: credential.code, memberId: credential.memberId)
    }
    func states(credential: LiveRoomCredential) -> AsyncThrowingStream<LiveRoomState, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let socket = session.webSocketTask(with: configuration.socketURL)
            socket.maximumMessageSize = LiveRoomWireDecoder.maximumBytes
            socket.resume()
            let reader = Task {
                do {
                    struct Auth: Encodable { let type = "authenticate"; let code: String; let token: String }
                    let auth = try JSONEncoder().encode(Auth(code: credential.code, token: credential.token))
                    try await socket.send(.string(String(decoding: auth, as: UTF8.self)))
                    while !Task.isCancelled {
                        let frame = try await socket.receive()
                        let bytes: Data
                        switch frame {
                        case .string(let string): bytes = Data(string.utf8)
                        case .data(let data): bytes = data
                        @unknown default: throw LiveRoomTransportError.invalidResponse
                        }
                        let state = try LiveRoomWireDecoder.socket(bytes).validated(code: credential.code, memberId: credential.memberId)
                        continuation.yield(state)
                    }
                    continuation.finish()
                } catch {
                    if Task.isCancelled { continuation.finish() }
                    else { continuation.finish(throwing: error) }
                }
                socket.cancel(with: .goingAway, reason: nil)
            }
            continuation.onTermination = { @Sendable _ in reader.cancel(); socket.cancel(with: .goingAway, reason: nil) }
        }
    }
}
