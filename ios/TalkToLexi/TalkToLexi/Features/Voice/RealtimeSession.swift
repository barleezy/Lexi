import Foundation
import os

enum VoicePhase: String {
    case idle
    case connecting
    case listening
    case thinking
    case speaking
}

struct TranscriptRow: Identifiable, Equatable {
    let id: UUID
    let role: String
    var text: String
}

protocol RealtimeSessionDelegate: AnyObject {
    func realtime(_ session: RealtimeSession, didChange phase: VoicePhase)
    func realtime(_ session: RealtimeSession, caption: String)
    func realtime(_ session: RealtimeSession, rows: [TranscriptRow])
    func realtime(_ session: RealtimeSession, error: String)
    func realtime(_ session: RealtimeSession, handleTool name: String, callId: String, arguments: [String: Any]) async -> String
    func realtime(_ session: RealtimeSession, completedTurn user: String, assistant: String)
    func realtime(_ session: RealtimeSession, chatPortStatus: String)
    func realtimeNeedsSessionRefresh(_ session: RealtimeSession)
}

extension RealtimeSessionDelegate {
    func realtime(_ session: RealtimeSession, chatPortStatus: String) {}
    func realtimeNeedsSessionRefresh(_ session: RealtimeSession) {}
}

final class RealtimeSession: NSObject, URLSessionWebSocketDelegate {
    private static let log = Logger(subsystem: "app.talktolexi.ios", category: "realtime")
    private static let createStall: TimeInterval = 1.8
    private static let expectStall: TimeInterval = 8
    private static let openTimeout: TimeInterval = 12

    private(set) var phase: VoicePhase = .idle {
        didSet {
            if oldValue != phase {
                DispatchQueue.main.async { self.delegate?.realtime(self, didChange: self.phase) }
            }
        }
    }

    private(set) var isLive = false
    private(set) var isReady = false
    var memorySessionId: String?
    private(set) var caption = ""
    private(set) var rows: [TranscriptRow] = []
    private(set) var lastUserUtterance = ""

    weak var delegate: RealtimeSessionDelegate?
    private let audio = VoiceAudioEngine()
    private var urlSession: URLSession?
    private var socket: URLSessionWebSocketTask?
    private var pendingAudio: [Data] = []
    private var pendingOutbound: [[String: Any]] = []
    private var queuedSessionUpdate: [String: Any] = [:]
    private var deferredLiveFrames: [(source: String, dataUrl: String, timeSec: Double?)] = []
    private var userText = ""
    private var assistantText = ""
    private var generation = 0
    private var expectSpoken = false
    private var createInFlight = false
    private var createAttempts = 0
    private var stallWork: DispatchWorkItem?
    private var openTimeoutWork: DispatchWorkItem?
    private var connectHost = ""

    var voiceDucked: Bool = false {
        didSet { audio.setVoiceDucked(voiceDucked) }
    }

    override init() {
        super.init()
        audio.onChatPortStatus = { [weak self] status in
            guard let self else { return }
            DispatchQueue.main.async {
                self.delegate?.realtime(self, chatPortStatus: status)
            }
        }
    }

    func applyAudioRouting() async {
        await audio.applyRouting(routeThroughPS5PartyChat: AccountStore.shared.routeThroughPS5PartyChat)
    }

    func start(token: String, realtimeURL: String, sessionUpdate: [String: Any]) {
        tearDown(notify: false, stopAudio: false)
        generation += 1
        let gen = generation
        phase = .connecting
        isLive = true
        isReady = false
        expectSpoken = false
        createInFlight = false
        createAttempts = 0
        pendingOutbound.removeAll()
        queuedSessionUpdate = sessionUpdate
        userText = ""
        assistantText = ""
        caption = ""
        audio.onPCM = { [weak self] data in
            self?.sendAudio(data)
        }

        Task { [weak self] in
            guard let self else { return }
            await self.audio.stop()
            guard self.generation == gen, self.isLive else { return }
            do {
                try await self.audio.start(
                    routeThroughPS5PartyChat: AccountStore.shared.routeThroughPS5PartyChat
                )
            } catch {
                await MainActor.run {
                    self.delegate?.realtime(self, error: error.localizedDescription)
                    self.stop()
                }
                return
            }
            guard self.generation == gen, self.isLive else {
                await self.audio.stop()
                return
            }
            await MainActor.run {
                self.openSocket(token: token, realtimeURL: realtimeURL, generation: gen)
            }
        }
    }

    private func openSocket(token: String, realtimeURL: String, generation gen: Int) {
        guard generation == gen, isLive else { return }
        guard let url = URL(string: realtimeURL) else {
            delegate?.realtime(self, error: "Bad realtime URL.")
            stop()
            return
        }
        connectHost = url.host ?? ""
        Self.log.info("ws.connect host=\(self.connectHost, privacy: .public) path=\(url.path, privacy: .public)")
        var request = URLRequest(url: url)
        request.timeoutInterval = Self.openTimeout
        // URLSession often drops Authorization on the WS handshake. Match the web client.
        request.setValue("xai-client-secret.\(token)", forHTTPHeaderField: "Sec-WebSocket-Protocol")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        urlSession = session
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        receiveLoop(generation: gen)
        armOpenTimeout(generation: gen)
    }

    func stop(notify: Bool = true) {
        tearDown(notify: notify, stopAudio: true)
    }

    private func tearDown(notify: Bool, stopAudio: Bool) {
        generation += 1
        clearWatchdogs()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        if stopAudio {
            Task { await audio.stop() }
        }
        pendingAudio.removeAll()
        pendingOutbound.removeAll()
        deferredLiveFrames.removeAll()
        isLive = false
        isReady = false
        expectSpoken = false
        createInFlight = false
        phase = .idle
        if notify {
            delegate?.realtime(self, caption: "")
        }
    }

    func sendText(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lastUserUtterance = trimmed
        appendRow(role: "user", text: trimmed)
        expectSpoken = true
        createAttempts = 0
        phase = .thinking
        sendJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": trimmed]],
            ],
        ])
        requestSpokenResponse()
    }

    func sendVisionFrame(source: String, dataUrl: String, timeSec: Double? = nil, respond: Bool = false) {
        sendVisionFrames([(source, dataUrl, timeSec)], respond: respond)
    }

    func sendVisionFrames(_ parts: [(source: String, dataUrl: String, timeSec: Double?)], respond: Bool = false) {
        guard isLive, !parts.isEmpty else { return }
        if shouldDeferLiveVision(respond: respond, parts: parts) {
            deferredLiveFrames = parts
            return
        }
        var content: [[String: Any]] = []
        var labels: [String] = []
        let watchTotal = parts.filter { $0.source == "watch" }.count
        var watchIndex = 0
        for part in parts {
            content.append(["type": "input_image", "image_url": part.dataUrl])
            if part.source == "watch" {
                watchIndex += 1
                let time = part.timeSec.map { " at \(Self.timecode($0))" } ?? ""
                labels.append("Watch-together frame \(watchIndex) of \(watchTotal)\(time) (video, not the user).")
            } else if part.source == "upload" {
                labels.append("Uploaded photo (user allowed).")
            } else {
                labels.append("Live 30fps camera video (exactly what the camera sees).")
            }
        }
        let preface = watchTotal > 0
            ? "The user is watching a video with you. These are separate recent stills from that video. Talk while it plays. On-screen voices are not the user. Soundtrack may be absent. "
            : ""
        content.append(["type": "input_text", "text": "\(preface)\(labels.joined(separator: " "))"])
        sendJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": content,
            ],
        ])
        if respond {
            expectSpoken = true
            createAttempts = 0
            phase = .thinking
            requestSpokenResponse()
        }
    }

    func notifyVideo(active: Bool, title: String) {
        let text = active
            ? "The user is watching a video with you titled \(title.isEmpty ? "Watch together" : title). Talk while it plays. On-screen voices are not the user. Soundtrack may be absent."
            : "The watch-together video stopped."
        sendJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": text]],
            ],
        ])
    }

    func notifyVision(source: String, active: Bool) {
        guard isLive else { return }
        let text: String
        if source == "camera" {
            text = active
                ? "The user started the camera. You are receiving a live 30fps video stream of exactly what the camera sees — not stills. Comment only when relevant."
                : "The user stopped the camera. You can no longer see the live camera video."
        } else {
            text = active
                ? "The user started sharing their screen. You can see the shared screen when a frame is attached. Voices or audio from the shared screen, TV, or other media are not the user. Comment only when relevant."
                : "The user stopped screen sharing. You can no longer see the screen."
        }
        sendJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": text]],
            ],
        ])
    }

    func sendJSON(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        let type = (object["type"] as? String) ?? "unknown"
        guard let socket, isReady else {
            pendingOutbound.append(object)
            Self.log.info("ws.queue type=\(type, privacy: .public) pending=\(self.pendingOutbound.count, privacy: .public)")
            return
        }
        Self.log.info("ws.send type=\(type, privacy: .public)")
        socket.send(.string(text)) { [weak self] error in
            guard let error else { return }
            Self.log.error("ws.send.fail type=\(type, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            self?.failOpen("Voice send failed: \(error.localizedDescription)")
        }
    }

    private func sendAudio(_ data: Data) {
        let payload: [String: Any] = [
            "type": "input_audio_buffer.append",
            "audio": data.base64EncodedString(),
        ]
        if socket == nil {
            pendingAudio.append(data)
            if pendingAudio.count > 100 { pendingAudio.removeFirst(pendingAudio.count - 100) }
            return
        }
        sendJSON(payload)
    }

    private func receiveLoop(generation gen: Int) {
        socket?.receive { [weak self] result in
            guard let self, gen == self.generation else { return }
            switch result {
            case .success(.string(let text)):
                self.handleMessage(text)
            case .success(.data(let data)):
                if let text = String(data: data, encoding: .utf8) {
                    self.handleMessage(text)
                }
            case .failure(let error):
                if self.isLive {
                    let timedOut = (error as NSError).code == NSURLErrorTimedOut
                    Self.log.error("ws.recv.fail timeout=\(timedOut, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
                    self.failOpen(timedOut ? "Voice link timed out." : error.localizedDescription, auth: Self.isAuthMessage(error.localizedDescription))
                }
                return
            @unknown default:
                break
            }
            self.receiveLoop(generation: gen)
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }

        switch type {
        case "session.updated", "session.created":
            Self.log.info("ws.event type=\(type, privacy: .public)")
        case "input_audio_buffer.speech_started":
            audio.stopPlayback()
            assistantText = ""
            phase = .listening
            flushDeferredLiveFrames()
        case "input_audio_buffer.speech_stopped", "input_audio_buffer.committed":
            if phase == .listening { phase = .thinking }
            expectSpoken = true
            createAttempts = 0
            armSpokenWatchdog()
        case "conversation.item.input_audio_transcription.updated",
             "conversation.item.input_audio_transcription.completed":
            if let transcript = object["transcript"] as? String {
                userText = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                lastUserUtterance = userText
            }
        case "response.created":
            createInFlight = false
            createAttempts = 0
            if phase != .speaking { phase = .thinking }
            Self.log.info("ws.event type=response.created")
            armGiveUpWatchdog()
        case "response.output_audio.delta":
            phase = .speaking
            clearWatchdogs()
            if let audioB64 = object["delta"] as? String, let pcm = Data(base64Encoded: audioB64) {
                audio.schedulePCM16(pcm)
            }
        case "response.output_audio_transcript.delta":
            if let delta = object["delta"] as? String {
                assistantText += delta
                caption = assistantText
                delegate?.realtime(self, caption: caption)
            }
        case "response.output_audio_transcript.done":
            if let transcript = object["transcript"] as? String, !transcript.isEmpty {
                assistantText = transcript
                caption = assistantText
                delegate?.realtime(self, caption: caption)
            }
        case "response.function_call_arguments.done":
            handleTool(object)
        case "response.done":
            expectSpoken = false
            createInFlight = false
            clearWatchdogs()
            finishTurn()
            if isLive {
                phase = .listening
                flushDeferredLiveFrames()
            }
        case "error":
            let message = ((object["error"] as? [String: Any])?["message"] as? String)
                ?? (object["message"] as? String)
                ?? "Realtime error"
            Self.log.error("ws.event type=error error=\(message, privacy: .public)")
            if Self.isIgnorable(message) { return }
            if Self.isAuthMessage(message) {
                failOpen(message, auth: true)
                return
            }
            if expectSpoken, !createInFlight {
                requestSpokenResponse()
                return
            }
            leaveThinking(message)
        default:
            break
        }
    }

    private func handleTool(_ object: [String: Any]) {
        let name = (object["name"] as? String) ?? ""
        let callId = (object["call_id"] as? String) ?? ""
        var args: [String: Any] = [:]
        if let raw = object["arguments"] as? String,
           let data = raw.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            args = parsed
        } else if let parsed = object["arguments"] as? [String: Any] {
            args = parsed
        }
        Task {
            let output = await self.delegate?.realtime(self, handleTool: name, callId: callId, arguments: args)
                ?? "{\"error\":\"no handler\"}"
            self.sendJSON([
                "type": "conversation.item.create",
                "item": [
                    "type": "function_call_output",
                    "call_id": callId,
                    "output": output,
                ],
            ])
            self.expectSpoken = true
            self.createAttempts = 0
            self.requestSpokenResponse()
        }
    }

    private func requestSpokenResponse() {
        if createInFlight {
            Self.log.info("ws.response.create skip in_flight")
            armSpokenWatchdog()
            return
        }
        expectSpoken = true
        createInFlight = true
        createAttempts += 1
        if phase == .listening || phase == .connecting { phase = .thinking }
        sendJSON(["type": "response.create"])
        armSpokenWatchdog()
    }

    private func armSpokenWatchdog() {
        stallWork?.cancel()
        let gen = generation
        let work = DispatchWorkItem { [weak self] in
            guard let self, gen == self.generation, self.expectSpoken, self.phase != .speaking else { return }
            if self.createAttempts >= 2 {
                self.giveUpWaiting()
                return
            }
            Self.log.info("ws.recover reason=create_stall attempt=\(self.createAttempts + 1, privacy: .public)")
            self.createInFlight = false
            self.requestSpokenResponse()
        }
        stallWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.createStall, execute: work)
    }

    private func armGiveUpWatchdog() {
        stallWork?.cancel()
        let gen = generation
        let work = DispatchWorkItem { [weak self] in
            guard let self, gen == self.generation, self.expectSpoken, self.phase != .speaking else { return }
            self.giveUpWaiting()
        }
        stallWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.expectStall, execute: work)
    }

    private func giveUpWaiting() {
        Self.log.error("ws.recover reason=expect_stall attempts=\(self.createAttempts, privacy: .public)")
        expectSpoken = false
        createInFlight = false
        phase = .listening
        DispatchQueue.main.async {
            self.delegate?.realtime(self, error: "No reply from Lexi. Try again.")
        }
    }

    private func armOpenTimeout(generation gen: Int) {
        openTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, gen == self.generation, !self.isReady else { return }
            Self.log.error("ws.open.timeout host=\(self.connectHost, privacy: .public)")
            self.failOpen("Voice link timed out.")
        }
        openTimeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.openTimeout, execute: work)
    }

    private func clearWatchdogs() {
        stallWork?.cancel()
        stallWork = nil
        openTimeoutWork?.cancel()
        openTimeoutWork = nil
    }

    private func flushPending() {
        let queued = pendingOutbound
        pendingOutbound.removeAll()
        for object in queued {
            sendJSON(object)
        }
        for chunk in pendingAudio {
            sendJSON(["type": "input_audio_buffer.append", "audio": chunk.base64EncodedString()])
        }
        pendingAudio.removeAll()
    }

    private func failOpen(_ message: String, auth: Bool = false) {
        let authFail = auth || Self.isAuthMessage(message)
        Self.log.error("ws.fail auth=\(authFail, privacy: .public) error=\(message, privacy: .public)")
        leaveThinking(message)
        if authFail {
            DispatchQueue.main.async { self.delegate?.realtimeNeedsSessionRefresh(self) }
        }
        if isLive { stop() }
    }

    private func leaveThinking(_ message: String) {
        expectSpoken = false
        createInFlight = false
        clearWatchdogs()
        if phase == .thinking { phase = isReady ? .listening : .idle }
        DispatchQueue.main.async { self.delegate?.realtime(self, error: message) }
    }

    private func finishTurn() {
        let user = userText.trimmingCharacters(in: .whitespacesAndNewlines)
        let assistant = assistantText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !user.isEmpty {
            lastUserUtterance = user
            appendRow(role: "user", text: user)
        }
        if !assistant.isEmpty {
            appendRow(role: "assistant", text: assistant)
        }
        if !user.isEmpty || !assistant.isEmpty {
            delegate?.realtime(self, completedTurn: user, assistant: assistant)
        }
        userText = ""
        assistantText = ""
    }

    private func shouldDeferLiveVision(
        respond: Bool,
        parts: [(source: String, dataUrl: String, timeSec: Double?)]
    ) -> Bool {
        if respond || phase != .thinking { return false }
        if parts.contains(where: { $0.source == "upload" || $0.source == "camera" || $0.source == "screen" }) {
            return false
        }
        return true
    }

    private func flushDeferredLiveFrames() {
        let parts = deferredLiveFrames
        guard !parts.isEmpty else { return }
        deferredLiveFrames = []
        sendVisionFrames(parts)
    }

    private func appendRow(role: String, text: String) {
        rows.append(TranscriptRow(id: UUID(), role: role, text: text))
        if rows.count > 40 {
            rows.removeFirst(rows.count - 40)
        }
        delegate?.realtime(self, rows: rows)
    }

    private static func timecode(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private static func isAuthMessage(_ message: String) -> Bool {
        message.range(of: #"401|403|unauthor|expired|invalid.?token|forbidden"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func isIgnorable(_ message: String) -> Bool {
        message.range(
            of: #"cancel|no (active|in[- ]progress) response|nothing to cancel|response not found|already.{0,40}(active|in[- ]progress)"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard isLive else { return }
        let negotiated = `protocol`?.isEmpty == false
        Self.log.info("ws.open host=\(self.connectHost, privacy: .public) protocol_set=\(negotiated, privacy: .public)")
        isReady = true
        openTimeoutWork?.cancel()
        openTimeoutWork = nil
        sendJSON(queuedSessionUpdate)
        flushPending()
        if phase == .connecting { phase = .listening }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let code = closeCode.rawValue
        Self.log.error("ws.close code=\(code, privacy: .public)")
        if isLive {
            failOpen("Voice socket closed (\(code)).", auth: code == 1008 || code == 4001)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? -1
        if status > 0 {
            Self.log.info("ws.handshake status=\(status, privacy: .public)")
        }
        if let error, isLive, !isReady {
            let timedOut = (error as NSError).code == NSURLErrorTimedOut
            Self.log.error("ws.handshake.fail status=\(status, privacy: .public) timeout=\(timedOut, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            failOpen(
                timedOut ? "Voice link timed out." : error.localizedDescription,
                auth: status == 401 || status == 403 || Self.isAuthMessage(error.localizedDescription)
            )
        } else if (status == 401 || status == 403), isLive, !isReady {
            failOpen("Voice auth failed (\(status)).", auth: true)
        }
    }
}
