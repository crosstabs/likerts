import Foundation

/// Release is deliberately unconfigured until the service and remote-data policy are approved.
struct LiveRoomConfiguration: Equatable, Sendable {
    let apiBaseURL: URL
    let inviteBaseURL: URL
    var credentialScope: String { apiBaseURL.absoluteString }

    static var current: LiveRoomConfiguration? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-live-testing"), let i = args.firstIndex(of: "-live-base-url"),
              args.indices.contains(i + 1), let url = URL(string: args[i + 1]) else { return nil }
        return debugLoopback(baseURL: url)
        #else
        return nil
        #endif
    }

    #if DEBUG
    static func debugLoopback(baseURL: URL) -> LiveRoomConfiguration? {
        guard ["http", "https"].contains(baseURL.scheme),
              ["localhost", "127.0.0.1", "[::1]", "::1"].contains(baseURL.host),
              baseURL.user == nil, baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil,
              baseURL.path.isEmpty || baseURL.path == "/" else { return nil }
        return LiveRoomConfiguration(apiBaseURL: baseURL.appendingPathComponent("api/live"),
                                     inviteBaseURL: baseURL.appendingPathComponent("play"))
    }
    #endif

    func inviteURL(code: String) -> URL? {
        guard LiveRoomState.validCode(code) else { return nil }
        var parts = URLComponents(url: inviteBaseURL, resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "room", value: code)]
        return parts?.url
    }
    var socketURL: URL {
        var parts = URLComponents(url: apiBaseURL.appendingPathComponent("socket"), resolvingAgainstBaseURL: false)!
        parts.scheme = apiBaseURL.scheme == "https" ? "wss" : "ws"
        return parts.url!
    }
}
