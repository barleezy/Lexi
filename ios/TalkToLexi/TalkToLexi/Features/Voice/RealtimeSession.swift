import Foundation

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
}

final class RealtimeSession: NSObject, URLSessionWebSocketDelegate {
    private(set) var phase: VoicePhase = .idle {
        didSet {
            if oldValue != phase {
                DispatchQueue.main.async { self.delegate?.realtime(self, didChange: self.phase) }
            }
        }
    }

    private(set) var isLive = false
    var memorySessionId: String?
    private(set) var caption = ""
    private(set) var rows: [TranscriptRow] = []
    private(set) var lastUserUtterance = ""

    weak var delegate: RealtimeSessionDelegate?
    private let audio = VoiceAudioEngine()
    private var urlSession: URLSession?
    private var socket: URLSessionWebSocketTask?
    private var pendingAudio: [Data] = []
    private var deferredLiveFrames: [(source: String, dataUrl: String, timeSec: Double?)] = []
    private var userText = ""
    private var assistantText = ""
    private var generation = 0

    var voiceDucked: Bool = false {
        didSet { audio.setVoiceDucked(voiceDucked) }
    }

    func start(token: String, realtimeURL: String, sessionUpdate: [String: Any]) {
        stop(notify: false)
        generation += 1
        let gen = generation
        phase = .connecting
        isLive = true
        userText = ""
        assistantText = ""
        caption = ""
        audio.onPCM = { [weak self] data in
            self?.sendAudio(data)
        }
        do {
            try audio.start()
        } catch {
            delegate?.realtime(self, error: error.localizedDescription)
            stop()
            return
        }

        guard let url = URL(string: realtimeURL) else {
            delegate?.realtime(self, error: "Bad realtime URL.")
            stop()
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        urlSession = session
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        receiveLoop(generation: gen)
        sendJSON(sessionUpdate)
        for chunk in pendingAudio {
            sendJSON(["type": "input_audio_buffer.append", "audio": chunk.base64EncodedString()])
        }
        pendingAudio.removeAll()
        phase = .listening
    }

    func stop(notify: Bool = true) {
        generation += 1
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        audio.stop()
        pendingAudio.removeAll()
        deferredLiveFrames.removeAll()
        isLive = false
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
        sendJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": trimmed]],
            ],
        ])
        sendJSON(["type": "response.create"])
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
                labels.append("Camera viewfinder frame (user allowed).")
            }
        }
        let preface = watchTotal > 0
            ? "The user is watching a video with you. These are separate recent stills from that video. Talk while it plays. On-screen voices are not Ian. Soundtrack may be absent. "
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
            sendJSON(["type": "response.create"])
        }
    }

    func notifyVideo(active: Bool, title: String) {
        let text = active
            ? "The user is watching a video with you titled \(title.isEmpty ? "Watch together" : title). Talk while it plays. On-screen voices are not Ian. Soundtrack may be absent."
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
                ? "The user allowed camera viewfinder frames. You can see what the camera shows when a frame is attached. Comment only when relevant."
                : "The user stopped the camera. You can no longer see the viewfinder."
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
        if let socket {
            socket.send(.string(text)) { _ in }
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
                    self.delegate?.realtime(self, error: error.localizedDescription)
                    self.stop()
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
        case "input_audio_buffer.speech_started":
            audio.stopPlayback()
            assistantText = ""
            phase = .listening
            flushDeferredLiveFrames()
        case "input_audio_buffer.speech_stopped", "input_audio_buffer.committed":
            if phase == .listening { phase = .thinking }
        case "conversation.item.input_audio_transcription.updated",
             "conversation.item.input_audio_transcription.completed":
            if let transcript = object["transcript"] as? String {
                userText = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                lastUserUtterance = userText
            }
        case "response.output_audio.delta":
            phase = .speaking
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
            finishTurn()
            if isLive {
                phase = .listening
                flushDeferredLiveFrames()
            }
        case "error":
            let message = ((object["error"] as? [String: Any])?["message"] as? String)
                ?? (object["message"] as? String)
                ?? "Realtime error"
            delegate?.realtime(self, error: message)
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
            self.sendJSON(["type": "response.create"])
        }
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
        // Camera / screen stay live for the whole share. Only watch stills wait out thinking.
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

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        if isLive {
            delegate?.realtime(self, error: "Voice socket closed.")
            stop()
        }
    }
}
