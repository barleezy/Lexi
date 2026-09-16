import AVFoundation
import Combine
import Foundation

@MainActor
final class LexiAppController: NSObject, ObservableObject, RealtimeSessionDelegate {
    let account = AccountStore.shared
    let api = LexiAPIClient()
    let realtime = RealtimeSession()
    let music = MusicController()
    let watch = WatchController()
    let camera = CameraController()
    let location = LocationController()
    let generate = GenerateController()
    let toys = ToyController()
    let signIn = SignInCoordinator()

    @Published var draft = ""
    @Published private(set) var lastError = ""
    @Published private(set) var statusLine = "Signed out"
    @Published private(set) var phase: VoicePhase = .idle
    @Published private(set) var caption = ""
    @Published private(set) var rows: [TranscriptRow] = []
    @Published private(set) var isLive = false
    @Published private(set) var isSignedIn = false
    @Published private(set) var isConnecting = false
    @Published private(set) var channelNames: [String] = []
    @Published private(set) var routeThroughPS5PartyChat = false
    @Published private(set) var ps5ChatPortStatus = ""
    @Published private(set) var psnOnlineId = "Barleezybaby"
    @Published private(set) var psnLoginName = "barleezyfbaby"

    private var connectGeneration = 0
    private var refreshGeneration = 0
    private var authRefreshCount = 0
    private var cancellables = Set<AnyCancellable>()

    var phaseLabel: String {
        if isConnecting { return "Connecting" }
        return isLive ? (LexiTheme.phaseHints[phase] ?? phase.rawValue.capitalized) : "Idle"
    }

    var connectTitle: String {
        if isConnecting { return "Connecting…" }
        return isLive ? "End" : "Connect"
    }

    var latestText: String {
        if !caption.isEmpty { return caption }
        return rows.reversed().first(where: { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })?.text ?? ""
    }

    override init() {
        super.init()
        realtime.delegate = self
        bindChildren()
        music.onChange = { [weak self] in
            self?.syncDuck()
        }
        watch.onFrame = { [weak self] frame in
            self?.realtime.sendVisionFrame(source: "watch", dataUrl: frame.dataUrl, timeSec: frame.timeSec)
        }
        watch.onLoadedChange = { [weak self] active, title in
            guard let self, self.realtime.isLive else { return }
            self.realtime.notifyVideo(active: active, title: title)
        }
        camera.onFrame = { [weak self] dataUrl in
            guard let self, self.realtime.isLive else { return }
            self.realtime.sendVisionFrame(source: "camera", dataUrl: dataUrl)
        }
        camera.onShareChange = { [weak self] active in
            guard let self, self.realtime.isLive else { return }
            self.realtime.notifyVision(source: "camera", active: active)
        }
        routeThroughPS5PartyChat = account.routeThroughPS5PartyChat
        account.useBackupPsnAccount()
        psnOnlineId = account.psnOnlineId
        psnLoginName = account.psnLoginName
        refreshStatus()
        Task { await refreshExtras() }
    }

    func setRouteThroughPS5PartyChat(_ on: Bool) {
        routeThroughPS5PartyChat = on
        account.routeThroughPS5PartyChat = on
        Task { await realtime.applyAudioRouting() }
    }

    private func bindChildren() {
        bind(music)
        bind(watch)
        bind(camera)
        bind(location)
        bind(generate)
        bind(toys)
    }

    private func bind<T: ObservableObject>(_ object: T) {
        object.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
    }

    func refreshStatus() {
        isSignedIn = account.isSignedIn
        isLive = realtime.isLive
        phase = realtime.phase
        caption = realtime.caption
        rows = realtime.rows
        statusLine = account.isSignedIn ? "Signed in as \(account.userId)" : "Sign in on talktolexi.app"
    }

    func refreshExtras() async {
        if account.isSignedIn {
            await music.refreshStatus(using: api)
            channelNames = await api.channels()
        }
        refreshStatus()
    }

    func toggleSignIn() {
        if account.isSignedIn {
            signOut()
        } else {
            Task { await signInFromPhone() }
        }
    }

    func signInFromPhone() async {
        do {
            let result = try await signIn.signIn(host: account.apiHost)
            account.apply(token: result.token, userId: result.userId)
            lastError = ""
            await refreshExtras()
        } catch {
            lastError = error.localizedDescription
            refreshStatus()
        }
    }

    func signOut() {
        connectGeneration += 1
        realtime.stop()
        music.stop()
        watch.clear(notify: false)
        camera.stop(notify: false)
        toys.reset()
        isConnecting = false
        account.signOut()
        channelNames = []
        refreshStatus()
    }

    func toggleCall() {
        if realtime.isLive || isConnecting {
            endCall()
        } else {
            connectCall()
        }
    }

    func sendDraftOrToggle() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            Task { await sendText(text) }
            return
        }
        toggleCall()
    }

    func sendText(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ""
        lastError = ""
        if !realtime.isReady {
            if !realtime.isLive && !isConnecting {
                connectCall()
            }
            for _ in 0..<160 where !realtime.isReady && lastError.isEmpty {
                try? await Task.sleep(nanoseconds: 150_000_000)
            }
        }
        if !lastError.isEmpty {
            refreshStatus()
            return
        }
        guard realtime.isReady else {
            lastError = "Voice link did not open."
            refreshStatus()
            return
        }
        toys.noteUtterance(trimmed)
        realtime.sendText(trimmed)
        refreshStatus()
    }

    func sendPhoto(_ dataUrl: String) {
        guard realtime.isLive else {
            lastError = "Connect first, then send a photo."
            return
        }
        realtime.sendVisionFrame(source: "upload", dataUrl: dataUrl, respond: true)
    }

    func toggleCameraShare() {
        if camera.isOn {
            camera.stop()
            return
        }
        guard realtime.isLive else {
            camera.hint = "Connect first, then share the camera."
            return
        }
        Task { await camera.start() }
    }

    func connectCall() {
        guard account.isSignedIn else {
            lastError = "Sign in first."
            refreshStatus()
            return
        }
        lastError = ""
        connectGeneration += 1
        authRefreshCount = 0
        let gen = connectGeneration
        isConnecting = true
        refreshStatus()
        location.start(silent: true)
        Task {
            let micOK = await requestMicrophone()
            guard gen == connectGeneration else { return }
            guard micOK else {
                isConnecting = false
                lastError = "Microphone access is required to talk to Lexi."
                refreshStatus()
                return
            }
            do {
                try await openRealtime(generation: gen)
            } catch {
                guard gen == connectGeneration else { return }
                isConnecting = false
                lastError = error.localizedDescription
                refreshStatus()
            }
        }
    }

    func endCall() {
        connectGeneration += 1
        isConnecting = false
        let sessionId = realtime.memorySessionId
        realtime.stop()
        camera.stop(notify: false)
        toys.reset()
        refreshStatus()
        Task { await api.endMemorySession(sessionId: sessionId) }
    }

    private func openRealtime(generation gen: Int) async throws {
        let session = try await api.startRealtimeSession(
            sessionId: realtime.memorySessionId,
            previousSessionId: nil,
            timeZone: TimeZone.current.identifier,
            location: location.payload(),
            musicPlaying: music.playing,
            musicTitle: music.title,
            musicSource: music.source
        )
        guard gen == connectGeneration else { return }
        realtime.memorySessionId = session.sessionId
        var update = session.sessionUpdate
        if update == nil {
            update = [
                "type": "session.update",
                "session": [
                    "voice": "aria",
                    "instructions": session.instructions ?? "",
                    "turn_detection": ["type": "server_vad"],
                ],
            ]
        }
        isConnecting = false
        realtime.start(
            token: session.token,
            realtimeURL: session.realtimeUrl ?? "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
            sessionUpdate: update ?? [:]
        )
        if watch.isLoaded {
            realtime.notifyVideo(active: true, title: watch.title)
        }
        if camera.isOn {
            realtime.notifyVision(source: "camera", active: true)
        }
        refreshStatus()
    }

    private func refreshVoiceSession() {
        guard account.isSignedIn else {
            lastError = "Sign-in expired. Sign in again."
            refreshStatus()
            return
        }
        if authRefreshCount >= 1 {
            lastError = "Voice auth failed. Sign in again."
            refreshStatus()
            return
        }
        authRefreshCount += 1
        refreshGeneration += 1
        let refresh = refreshGeneration
        connectGeneration += 1
        let gen = connectGeneration
        isConnecting = true
        lastError = ""
        realtime.stop(notify: false)
        refreshStatus()
        Task {
            do {
                try await openRealtime(generation: gen)
            } catch {
                guard refresh == refreshGeneration, gen == connectGeneration else { return }
                isConnecting = false
                lastError = error.localizedDescription
                refreshStatus()
            }
        }
    }

    func connectAppleMusic() {
        Task {
            lastError = ""
            if music.connected {
                music.disconnect()
                return
            }
            let message = await music.connect(using: api)
            if !music.connected { lastError = message }
            refreshStatus()
        }
    }

    func playAppleMusic() {
        Task {
            await music.playFromUser(using: api)
            syncDuck()
        }
    }

    func skipAppleMusic() {
        Task {
            await music.skipNext(using: api)
            syncDuck()
        }
    }

    func loadVideo() {
        Task { await watch.load(using: api) }
    }

    private func syncDuck() {
        realtime.voiceDucked = music.playing
    }

    private func requestMicrophone() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, didChange phase: VoicePhase) {
        Task { @MainActor in
            self.phase = phase
            self.isLive = session.isLive
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, caption: String) {
        Task { @MainActor in
            self.caption = caption
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, rows: [TranscriptRow]) {
        Task { @MainActor in
            self.rows = rows
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, error: String) {
        Task { @MainActor in
            self.lastError = error
            self.isLive = session.isLive
            self.phase = session.phase
            self.isConnecting = false
            if !session.isLive {
                self.camera.stop(notify: false)
            }
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, chatPortStatus: String) {
        Task { @MainActor in
            self.ps5ChatPortStatus = chatPortStatus
        }
    }

    nonisolated func realtimeNeedsSessionRefresh(_ session: RealtimeSession) {
        Task { @MainActor in
            self.refreshVoiceSession()
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, completedTurn user: String, assistant: String) {
        Task { @MainActor in
            if !user.isEmpty { self.toys.noteUtterance(user) }
            await api.recordTurn(userText: user, assistantText: assistant, sessionId: session.memorySessionId)
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, handleTool name: String, callId: String, arguments: [String: Any]) async -> String {
        await handleToolOnMain(name: name, arguments: arguments, sessionId: session.memorySessionId)
    }

    private func handleToolOnMain(name: String, arguments: [String: Any], sessionId: String?) async -> String {
        switch name {
        case "upsert_fact", "set_affect":
            do {
                let result = try await api.memoryTool(name: name, args: arguments, sessionId: sessionId)
                return stringify(result)
            } catch {
                return stringify(["error": error.localizedDescription])
            }
        case "play_music":
            let message = await music.play(
                url: arguments["url"] as? String,
                query: arguments["query"] as? String,
                songId: (arguments["song_id"] as? String) ?? (arguments["songId"] as? String),
                using: api
            )
            syncDuck()
            return stringify(["ok": true, "message": message])
        case "stop_music":
            music.stop()
            syncDuck()
            return stringify(["ok": true])
        case "apple_music_connect":
            let message = await music.connect(using: api)
            return stringify(["ok": music.connected, "message": message])
        case "apple_music_love":
            let message = await music.love(
                query: arguments["query"] as? String,
                songId: arguments["song_id"] as? String ?? arguments["songId"] as? String,
                using: api
            )
            return stringify(["ok": true, "message": message])
        case "apple_music_library":
            let message = await music.addToLibrary(
                query: arguments["query"] as? String,
                songId: arguments["song_id"] as? String ?? arguments["songId"] as? String,
                using: api
            )
            return stringify(["ok": true, "message": message])
        case "apple_music_playlist":
            let message = await music.addToPlaylist(
                query: arguments["query"] as? String,
                songId: arguments["song_id"] as? String ?? arguments["songId"] as? String,
                playlist: arguments["playlist"] as? String,
                using: api
            )
            return stringify(["ok": true, "message": message])
        case "generate_image":
            let result = await generate.generateImage(arguments, using: api)
            if let dataUrl = result["dataUrl"] as? String, !dataUrl.isEmpty {
                realtime.sendVisionFrame(source: "upload", dataUrl: dataUrl)
            }
            return stringify(result)
        case "generate_video":
            return stringify(await generate.generateVideo(arguments, using: api))
        case "get_video_context":
            let frames = watch.framesForContext().map { frame -> [String: Any] in
                ["dataUrl": frame.dataUrl, "timeSec": frame.timeSec]
            }
            guard !frames.isEmpty else {
                return stringify(["ok": false, "error": "No video is loaded."])
            }
            do {
                let result = try await api.videoContext(
                    question: (arguments["question"] as? String) ?? "",
                    title: watch.title,
                    frames: frames
                )
                return stringify(result)
            } catch {
                return stringify(["error": error.localizedDescription])
            }
        case "request_toy_control":
            return stringify(toys.handleRequest(arguments, lastUserUtterance: realtime.lastUserUtterance))
        case "toy_command",
             "lovense_function",
             "lovense_vibrate",
             "lovense_stop",
             "lovense_pattern",
             "joyhub_vibrate",
             "joyhub_stop",
             "joyhub_pattern":
            return stringify(await toys.command(name: name, arguments: arguments, using: api))
        case "fortnite_add_friend",
             "fortnite_status",
             "fortnite_invite",
             "fortnite_sign_in",
             "fortnite_join_party",
             "fortnite_sit_out",
             "fortnite_leave_party":
            return stringify(await fortniteTool(name, arguments: arguments))
        default:
            return stringify(["error": "\(name) is not available in the iPhone app."])
        }
    }

    private func fortniteTool(_ name: String, arguments: [String: Any]) async -> [String: Any] {
        let action: String
        switch name {
        case "fortnite_add_friend": action = "add_friend"
        case "fortnite_invite": action = "invite"
        case "fortnite_sign_in": action = "sign_in"
        case "fortnite_join_party": action = "join_party"
        case "fortnite_sit_out": action = "sit_out"
        case "fortnite_leave_party": action = "leave_party"
        default: action = "status"
        }
        let displayName = (arguments["display_name"] as? String) ?? (arguments["displayName"] as? String)
        do {
            return sanitizeFortniteResult(try await api.fortnite(action: action, displayName: displayName))
        } catch {
            return ["ok": false, "canPlayInGame": false, "visibleInFortnite": false, "inIanParty": false, "error": error.localizedDescription]
        }
    }

    private func sanitizeFortniteResult(_ raw: [String: Any]) -> [String: Any] {
        var result = raw
        result.removeValue(forKey: "signedIn")
        result["canPlayInGame"] = false
        if result["epicHttpReady"] == nil {
            result["epicHttpReady"] = false
        }
        if let party = raw["party"] as? [String: Any] {
            let withFriend = (party["withFriend"] as? Bool) == true
                || (party["inIanParty"] as? Bool) == true
                || (party["visibleInFortnite"] as? Bool) == true
            result["inIanParty"] = withFriend
            result["visibleInFortnite"] = withFriend
        }
        return result
    }

    private func stringify(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"ok\":true}"
        }
        return text
    }
}
