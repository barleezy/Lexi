import Foundation
import os

enum VoiceRealtimeConfig {
    static let model = "grok-voice-think-fast-1.0"
    static let url = "wss://api.x.ai/v1/realtime?model=\(model)"
    static let maxDuration: TimeInterval = 30 * 60
    static let maxSpendUsd = 5.0
    static let usdPerAudioMinute = 0.08

    static func estimatedSpendUsd(elapsed: TimeInterval) -> Double {
        max(0, elapsed) / 60.0 * usdPerAudioMinute
    }

    static func limitMessage(elapsed: TimeInterval) -> String? {
        if elapsed >= maxDuration { return "Call time limit reached." }
        if estimatedSpendUsd(elapsed: elapsed) >= maxSpendUsd { return "Call spend limit reached." }
        return nil
    }

    static func secondsUntilLimit(elapsed: TimeInterval) -> TimeInterval {
        let durationLeft = maxDuration - elapsed
        let spendLeft = maxSpendUsd - estimatedSpendUsd(elapsed: elapsed)
        let spendLeftSeconds = usdPerAudioMinute > 0 ? (spendLeft / usdPerAudioMinute) * 60.0 : durationLeft
        return max(0, min(durationLeft, spendLeftSeconds))
    }
}

struct IosSessionResponse {
    var token: String
    var realtimeUrl: String?
    var sampleRate: Int?
    var voice: String?
    var userId: String?
    var sessionId: String?
    var voiceSessionId: String?
    var holdSeconds: Int?
    var voiceSeconds: Int?
    var startedAt: String?
    var capAtMs: Double?
    var maxDurationSeconds: Int?
    var maxSpendUsd: Double?
    var decayState: String?
    var memoryInstructions: String?
    var priorChat: String?
    var instructions: String?
    var sessionUpdate: [String: Any]?
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

struct BillingBalance {
    var voiceSeconds: Int
    var label: String
    var subscribed: Bool
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
    private static let log = Logger(subsystem: "app.talktolexi.ios", category: "http")

    private let account: AccountStore
    private let session: URLSession

    init(account: AccountStore = .shared) {
        self.account = account
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)
    }

    static func isAuthError(_ error: Error) -> Bool {
        let code = (error as NSError).code
        if code == 401 || code == 403 { return true }
        return error.localizedDescription.range(
            of: #"401|403|unauthor|expired|sign-?in"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
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
            "userId": account.sessionUserId,
            "clientTimeZone": timeZone,
            "musicPlaying": musicPlaying,
            "musicTitle": musicTitle,
            "musicSource": musicSource,
        ]
        if let sessionId, !sessionId.isEmpty { body["sessionId"] = sessionId }
        if let previousSessionId, !previousSessionId.isEmpty { body["previousSessionId"] = previousSessionId }
        if let location { body["location"] = location }
        return try await postIosSession(body)
    }

    func extendRealtimeSession(
        voiceSessionId: String,
        sessionId: String?,
        timeZone: String,
        location: [String: Any]?,
        musicPlaying: Bool,
        musicTitle: String,
        musicSource: String
    ) async throws -> IosSessionResponse {
        var body: [String: Any] = [
            "userId": account.sessionUserId,
            "clientTimeZone": timeZone,
            "musicPlaying": musicPlaying,
            "musicTitle": musicTitle,
            "musicSource": musicSource,
            "extend": true,
            "voiceSessionId": voiceSessionId,
        ]
        if let sessionId, !sessionId.isEmpty { body["sessionId"] = sessionId }
        if let location { body["location"] = location }
        return try await postIosSession(body)
    }

    private func postIosSession(_ body: [String: Any]) async throws -> IosSessionResponse {
        let raw = try await postJSON("/api/ios/session", body: body)
        guard let token = raw["token"] as? String, !token.isEmpty else {
            let code = raw["code"] as? String
            if code == "out_of_minutes" {
                throw NSError(domain: "LexiAPI", code: 402, userInfo: [NSLocalizedDescriptionKey: "Out of minutes."])
            }
            if code == "session_limit" {
                throw NSError(
                    domain: "LexiAPI",
                    code: 402,
                    userInfo: [NSLocalizedDescriptionKey: (raw["error"] as? String) ?? "Call limit reached."]
                )
            }
            throw NSError(domain: "LexiAPI", code: 502, userInfo: [NSLocalizedDescriptionKey: (raw["error"] as? String) ?? "Could not start a voice session."])
        }
        return IosSessionResponse(
            token: token,
            realtimeUrl: raw["realtimeUrl"] as? String,
            sampleRate: raw["sampleRate"] as? Int,
            voice: raw["voice"] as? String,
            userId: raw["userId"] as? String,
            sessionId: raw["sessionId"] as? String,
            voiceSessionId: raw["voiceSessionId"] as? String,
            holdSeconds: raw["holdSeconds"] as? Int,
            voiceSeconds: raw["voiceSeconds"] as? Int,
            startedAt: raw["startedAt"] as? String,
            capAtMs: raw["capAtMs"] as? Double,
            maxDurationSeconds: raw["maxDurationSeconds"] as? Int,
            maxSpendUsd: raw["maxSpendUsd"] as? Double,
            decayState: raw["decayState"] as? String,
            memoryInstructions: raw["memoryInstructions"] as? String,
            priorChat: raw["priorChat"] as? String,
            instructions: raw["instructions"] as? String,
            sessionUpdate: raw["sessionUpdate"] as? [String: Any]
        )
    }

    func billingBalance() async throws -> BillingBalance {
        let raw = try await getJSON("/api/billing/balance")
        return BillingBalance(
            voiceSeconds: (raw["voiceSeconds"] as? Int) ?? 0,
            label: (raw["label"] as? String) ?? "0s",
            subscribed: (raw["subscribed"] as? Bool) ?? false
        )
    }

    func memoryTool(name: String, args: [String: Any], sessionId: String?) async throws -> [String: Any] {
        var body = args
        body["tool"] = name
        body["userId"] = account.sessionUserId
        if let sessionId { body["sessionId"] = sessionId }
        return try await postJSON("/api/memory", body: body)
    }

    func sendChat(_ text: String, sessionId: String? = nil, platform: String = "ios") async throws -> (reply: String, sessionId: String?) {
        var body: [String: Any] = [
            "text": text,
            "userId": account.sessionUserId,
            "platform": platform,
        ]
        if let sessionId, !sessionId.isEmpty { body["sessionId"] = sessionId }
        var request = authorized("/api/chat", method: "POST")
        request.timeoutInterval = 90
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 90
        config.timeoutIntervalForResource = 90
        let chatSession = URLSession(configuration: config)
        let (data, response) = try await chatSession.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "LexiAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "No HTTP response from /api/chat."])
        }
        try throwIfNeeded(http, data: data)
        let raw = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard let reply = raw["reply"] as? String, !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NSError(domain: "LexiAPI", code: 502, userInfo: [NSLocalizedDescriptionKey: (raw["error"] as? String) ?? "Could not write a reply."])
        }
        return (reply.trimmingCharacters(in: .whitespacesAndNewlines), raw["sessionId"] as? String)
    }

    func logVoiceFailure(reason: String, sessionId: String? = nil) async {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var body: [String: Any] = [
            "reason": trimmed,
            "platform": "ios",
            "kind": "connect.fail",
            "userId": account.sessionUserId,
        ]
        if let sessionId, !sessionId.isEmpty { body["sessionId"] = sessionId }
        _ = try? await postJSON("/api/voice/log", body: body)
    }

    func recordTurn(userText: String, assistantText: String, sessionId: String?) async {
        var body: [String: Any] = [
            "userId": account.sessionUserId,
            "userText": userText,
            "assistantText": assistantText,
        ]
        if let sessionId { body["sessionId"] = sessionId }
        _ = try? await postJSON("/api/memory", body: body)
    }

    func endMemorySession(sessionId: String?) async {
        guard let sessionId, !sessionId.isEmpty else { return }
        _ = try? await postJSON("/api/memory", body: [
            "userId": account.sessionUserId,
            "sessionId": sessionId,
            "endSession": true,
        ])
    }

    func settleVoiceSession(voiceSessionId: String?) async {
        guard let voiceSessionId, !voiceSessionId.isEmpty else { return }
        account.rememberPendingVoiceSession(voiceSessionId)
        var delayNs: UInt64 = 400_000_000
        for attempt in 1...5 {
            do {
                let raw = try await postJSON("/api/voice/settle", body: [
                    "userId": account.sessionUserId,
                    "voiceSessionId": voiceSessionId,
                ])
                let ok = raw["ok"] as? Bool ?? false
                let already = raw["alreadySettled"] as? Bool ?? false
                if ok || already {
                    account.forgetPendingVoiceSession(voiceSessionId)
                    return
                }
            } catch {
                if (error as NSError).code == 404 {
                    account.forgetPendingVoiceSession(voiceSessionId)
                    return
                }
            }
            if attempt < 5 {
                try? await Task.sleep(nanoseconds: delayNs)
                delayNs *= 2
            }
        }
    }

    func settlePendingVoiceSessions() async {
        for id in account.pendingVoiceSessionIds {
            await settleVoiceSession(voiceSessionId: id)
        }
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

    func fortnite(action: String, displayName: String?) async throws -> [String: Any] {
        var body: [String: Any] = [
            "action": action,
            "userId": account.sessionUserId,
        ]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        return try await postJSON("/api/fortnite", body: body)
    }

    func videoContext(question: String, title: String, frames: [[String: Any]]) async throws -> [String: Any] {
        try await postJSON("/api/video/context", body: [
            "question": question,
            "title": title,
            "frames": frames,
        ])
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, http) = try await perform(authorized(path, method: "GET"))
        try throwIfNeeded(http, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func getJSON(_ path: String) async throws -> [String: Any] {
        let (data, http) = try await perform(authorized(path, method: "GET"))
        try throwIfNeeded(http, data: data)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func postJSON(_ path: String, body: [String: Any]) async throws -> [String: Any] {
        var request = authorized(path, method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, http) = try await perform(request)
        try throwIfNeeded(http, data: data)
        let raw = try JSONSerialization.jsonObject(with: data)
        return raw as? [String: Any] ?? ["ok": true]
    }

    private func authorized(_ path: String, method: String) -> URLRequest {
        let root = account.apiHost.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let url = URL(string: root + path)!
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(account.sessionUserId, forHTTPHeaderField: "x-lexi-user-id")
        if !account.token.isEmpty {
            request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
            request.setValue(account.token, forHTTPHeaderField: "x-lexi-ios-session")
        }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let method = request.httpMethod ?? "GET"
        let path = request.url?.path ?? "?"
        Self.log.info("http.send \(method, privacy: .public) \(path, privacy: .public)")
        let started = Date()
        do {
            let (data, response) = try await session.data(for: request)
            let http = response as? HTTPURLResponse
            let status = http?.statusCode ?? -1
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            Self.log.info("http.recv \(method, privacy: .public) \(path, privacy: .public) status=\(status, privacy: .public) ms=\(ms, privacy: .public)")
            guard let http else {
                throw NSError(domain: "LexiAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "No HTTP response from \(path)."])
            }
            return (data, http)
        } catch {
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            let timedOut = (error as? URLError)?.code == .timedOut
            Self.log.error("http.fail \(method, privacy: .public) \(path, privacy: .public) timeout=\(timedOut, privacy: .public) ms=\(ms, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            if timedOut {
                throw NSError(
                    domain: "LexiAPI",
                    code: NSURLErrorTimedOut,
                    userInfo: [NSLocalizedDescriptionKey: "\(path) timed out."]
                )
            }
            throw error
        }
    }

    private func throwIfNeeded(_ http: HTTPURLResponse, data: Data) throws {
        if (200...299).contains(http.statusCode) { return }
        let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        let code = body["code"] as? String
        let server = (body["error"] as? String) ?? "HTTP \(http.statusCode)"
        let message: String
        if http.statusCode == 402 || code == "out_of_minutes" {
            message = code == "session_limit" ? (body["error"] as? String) ?? "Call limit reached." : "Out of minutes."
        } else if code == "session_limit" {
            message = (body["error"] as? String) ?? "Call limit reached."
        } else if http.statusCode == 401 || http.statusCode == 403 {
            message = "Sign-in expired. Sign in again. (\(http.statusCode))"
        } else {
            message = server
        }
        throw NSError(domain: "LexiAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
