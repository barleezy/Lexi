import Foundation

struct IosSessionResponse {
    var token: String
    var realtimeUrl: String?
    var sampleRate: Int?
    var voice: String?
    var userId: String?
    var sessionId: String?
    var decayState: String?
    var memoryInstructions: String?
    var priorChat: String?
    var instructions: String?
    var sessionUpdate: [String: Any]?
}

struct AppleMusicStatus: Decodable {
    var ok: Bool?
    var configured: Bool?
    var connected: Bool?
    var developerToken: String?
    var error: String?
    var storefront: String?
}

struct ChannelStatus: Decodable {
    var ok: Bool?
    var platforms: [String: Bool]?
}

struct WatchResolveResult {
    var ok: Bool
    var kind: String
    var title: String
    var playable: String
    var mediaUrl: String
    var error: String
    var code: String
}

struct GeneratedMediaItem: Identifiable, Equatable {
    var id: String
    var kind: String
    var prompt: String
    var status: String
    var url: String?
    var dataUrl: String?
    var requestId: String?
    var error: String?
}

final class LexiAPIClient {
    private let account: AccountStore
    private let session: URLSession

    init(account: AccountStore = .shared) {
        self.account = account
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }

    func startRealtimeSession(
        sessionId: String?,
        previousSessionId: String?,
        timeZone: String,
        location: [String: Any]?,
        musicPlaying: Bool,
        musicTitle: String,
        musicSource: String
    ) async throws -> IosSessionResponse {
        var body: [String: Any] = [
            "userId": account.userId,
            "clientTimeZone": timeZone,
            "musicPlaying": musicPlaying,
            "musicTitle": musicTitle,
            "musicSource": musicSource,
        ]
        if let sessionId, !sessionId.isEmpty { body["sessionId"] = sessionId }
        if let previousSessionId, !previousSessionId.isEmpty { body["previousSessionId"] = previousSessionId }
        if let location { body["location"] = location }
        let raw = try await postJSON("/api/ios/session", body: body)
        guard let token = raw["token"] as? String, !token.isEmpty else {
            throw NSError(domain: "LexiAPI", code: 502, userInfo: [NSLocalizedDescriptionKey: (raw["error"] as? String) ?? "Could not start a voice session."])
        }
        return IosSessionResponse(
            token: token,
            realtimeUrl: raw["realtimeUrl"] as? String,
            sampleRate: raw["sampleRate"] as? Int,
            voice: raw["voice"] as? String,
            userId: raw["userId"] as? String,
            sessionId: raw["sessionId"] as? String,
            decayState: raw["decayState"] as? String,
            memoryInstructions: raw["memoryInstructions"] as? String,
            priorChat: raw["priorChat"] as? String,
            instructions: raw["instructions"] as? String,
            sessionUpdate: raw["sessionUpdate"] as? [String: Any]
        )
    }

    func appleMusicStatus() async throws -> AppleMusicStatus {
        try await get("/api/apple-music")
    }

    func appleMusic(action: String, extra: [String: Any] = [:]) async throws -> [String: Any] {
        var body = extra
        body["action"] = action
        return try await postJSON("/api/apple-music", body: body)
    }

    func memoryTool(name: String, args: [String: Any], sessionId: String?) async throws -> [String: Any] {
        var body = args
        body["tool"] = name
        body["userId"] = account.userId
        if let sessionId { body["sessionId"] = sessionId }
        return try await postJSON("/api/memory", body: body)
    }

    func recordTurn(userText: String, assistantText: String, sessionId: String?) async {
        var body: [String: Any] = [
            "userId": account.userId,
            "userText": userText,
            "assistantText": assistantText,
        ]
        if let sessionId { body["sessionId"] = sessionId }
        _ = try? await postJSON("/api/memory", body: body)
    }

    func endMemorySession(sessionId: String?) async {
        guard let sessionId, !sessionId.isEmpty else { return }
        _ = try? await postJSON("/api/memory", body: [
            "userId": account.userId,
            "sessionId": sessionId,
            "endSession": true,
        ])
    }

    func channels() async -> [String] {
        do {
            let status: ChannelStatus = try await get("/api/channels")
            let platforms = status.platforms ?? [:]
            return ["discord", "telegram", "sms", "email"].filter { platforms[$0] == true }
        } catch {
            return []
        }
    }

    func resolveVideo(url raw: String) async throws -> WatchResolveResult {
        let encoded = raw.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? raw
        let rawJSON = try await getJSON("/api/video/resolve?url=\(encoded)")
        let ok = rawJSON["ok"] as? Bool ?? false
        let playable = (rawJSON["playable"] as? String) ?? (rawJSON["mediaUrl"] as? String) ?? ""
        if ok, !playable.isEmpty {
            return WatchResolveResult(
                ok: true,
                kind: (rawJSON["kind"] as? String) ?? "mp4",
                title: (rawJSON["title"] as? String) ?? "Watch together",
                playable: playable,
                mediaUrl: (rawJSON["mediaUrl"] as? String) ?? playable,
                error: "",
                code: ""
            )
        }
        let code = (rawJSON["code"] as? String) ?? ""
        let message: String
        if code == "blocked_page" {
            message = "That page will not play here. Paste a direct video URL."
        } else {
            message = (rawJSON["error"] as? String) ?? "Could not open that video."
        }
        return WatchResolveResult(ok: false, kind: "", title: "", playable: "", mediaUrl: "", error: message, code: code)
    }

    func generateImage(prompt: String, aspectRatio: String?, resolution: String?) async throws -> [String: Any] {
        var body: [String: Any] = ["prompt": prompt]
        if let aspectRatio { body["aspect_ratio"] = aspectRatio }
        if let resolution { body["resolution"] = resolution }
        return try await postJSON("/api/generate/image", body: body)
    }

    func generateVideo(
        prompt: String,
        duration: Any?,
        aspectRatio: String?,
        resolution: String?,
        silent: Bool?
    ) async throws -> [String: Any] {
        var body: [String: Any] = ["prompt": prompt]
        if let duration { body["duration"] = duration }
        if let aspectRatio { body["aspect_ratio"] = aspectRatio }
        if let resolution { body["resolution"] = resolution }
        if let silent { body["silent"] = silent }
        return try await postJSON("/api/generate/video", body: body)
    }

    func pollGeneratedVideo(requestId: String) async throws -> [String: Any] {
        try await getJSON("/api/generate/video/\(requestId)")
    }

    func toyCommand(_ body: [String: Any]) async throws -> [String: Any] {
        try await postJSON("/api/toys", body: body)
    }

    func videoContext(question: String, title: String, frames: [[String: Any]]) async throws -> [String: Any] {
        try await postJSON("/api/video/context", body: [
            "question": question,
            "title": title,
            "frames": frames,
        ])
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, response) = try await session.data(for: authorized(path, method: "GET"))
        try throwIfNeeded(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func getJSON(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await session.data(for: authorized(path, method: "GET"))
        try throwIfNeeded(response, data: data)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func postJSON(_ path: String, body: [String: Any]) async throws -> [String: Any] {
        var request = authorized(path, method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try throwIfNeeded(response, data: data)
        let raw = try JSONSerialization.jsonObject(with: data)
        return raw as? [String: Any] ?? ["ok": true]
    }

    private func authorized(_ path: String, method: String) -> URLRequest {
        let root = account.apiHost.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let url = URL(string: root + path)!
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(account.userId, forHTTPHeaderField: "x-lexi-user-id")
        if !account.token.isEmpty {
            request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
            request.setValue(account.token, forHTTPHeaderField: "x-lexi-ios-session")
        }
        return request
    }

    private func throwIfNeeded(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if (200...299).contains(http.statusCode) { return }
        let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        let message = (body["error"] as? String) ?? "HTTP \(http.statusCode)"
        throw NSError(domain: "LexiAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
