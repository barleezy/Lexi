import AVFoundation
import Combine
import Foundation
import UIKit

enum ChatMode: String {
    case voice
    case text
}

@MainActor
final class LexiAppController: NSObject, ObservableObject, RealtimeSessionDelegate {
    static let shared = LexiAppController()

    let account = AccountStore.shared
    let api = LexiAPIClient()
    let realtime = RealtimeSession()
    let music = MusicController()
    let watch = WatchController()
    let camera = CameraController()
    let screen = ScreenCaptureController()
    let location = LocationController()
    let generate = GenerateController()
    let toys = ToyController()
    let signIn = SignInCoordinator()

    @Published var draft = ""
    @Published private(set) var lastError = ""
    @Published private(set) var chatMode: ChatMode = .text
    @Published private(set) var textBusy = false
    @Published private(set) var statusLine = "Signed out"
    @Published private(set) var phase: VoicePhase = .idle
    @Published private(set) var caption = ""
    @Published private(set) var rows: [TranscriptRow] = []
    @Published private(set) var isLive = false
    @Published private(set) var isSignedIn = false
    @Published private(set) var isConnecting = false
    @Published private(set) var channelNames: [String] = []
    @Published private(set) var minutesLabel = ""
    @Published private(set) var voiceSeconds = 0
    @Published private(set) var subscribed = false
    @Published private(set) var billingMessage = ""

    private var connectGeneration = 0
    private var refreshGeneration = 0
    private var authRefreshCount = 0
    private var walletLeftover = 0
    private var extendingHold = false
    private var callStartedAt: Date?
    private var limitWorkItem: DispatchWorkItem?
    private var cancellables = Set<AnyCancellable>()
    private var launchWorkStarted = false
    private var allowIdleBillingRefresh = false
    private var billingInFlight: Task<Int?, Never>?
    private var captureMicEnabled = true
    private var textRows: [TranscriptRow] = []
    private var textSessionId: String?

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
        screen.onFrame = { [weak self] dataUrl in
            guard let self, self.realtime.isLive else { return }
            self.realtime.sendVisionFrame(source: "screen", dataUrl: dataUrl)
        }
        screen.onShareChange = { [weak self] active in
            guard let self, self.realtime.isLive else { return }
            self.realtime.notifyVision(source: "screen", active: active)
        }
        refreshStatus()
    }

    /// Chat chrome paints first. One balance fetch after VoiceHome composer appears.
    func scheduleLaunchWork() {
        guard !launchWorkStarted else { return }
        launchWorkStarted = true
        Task {
            await Task.yield()
            await api.settlePendingVoiceSessions()
            await refreshExtras()
            allowIdleBillingRefresh = true
        }
    }

    private func bindChildren() {
        bind(music)
        bind(watch)
        bind(camera)
        bind(screen)
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
        if realtime.isLive {
            caption = realtime.caption
            rows = realtime.rows
        } else {
            rows = textRows
            caption = textRows.last?.text ?? ""
        }
        statusLine = account.isSignedIn ? "Signed in as \(account.userId)" : "Ready to talk"
    }

    func refreshExtras() async {
        if account.isSignedIn {
            channelNames = await api.channels()
            await refreshBilling()
        } else {
            clearBilling()
        }
        refreshStatus()
    }

    @discardableResult
    func refreshBilling() async -> Int? {
        if let billingInFlight {
            return await billingInFlight.value
        }
        let task = Task { await self.loadBilling() }
        billingInFlight = task
        let value = await task.value
        billingInFlight = nil
        return value
    }

    private func loadBilling() async -> Int? {
        guard account.isSignedIn else {
            clearBilling()
            return nil
        }
        do {
            let balance = try await api.billingBalance()
            voiceSeconds = balance.voiceSeconds
            minutesLabel = "\(voiceSeconds / 60) min"
            subscribed = balance.subscribed
            billingMessage = ""
            return voiceSeconds
        } catch {
            if minutesLabel.isEmpty {
                billingMessage = error.localizedDescription
            }
            return nil
        }
    }

    func openBuyMinutes() {
        Task { await openSitePath("/buy") }
    }

    func openSubscribe() {
        Task { await openSitePath("/subscribe") }
    }

    func openManageAccount() {
        Task { await openSitePath("/account") }
    }

    private func openSitePath(_ path: String) async {
        if !account.isSignedIn {
            await signInFromPhone()
            if !account.isSignedIn { return }
        }
        guard let url = URL(string: path, relativeTo: account.apiHost)?.absoluteURL else { return }
        await UIApplication.shared.open(url)
    }

    private func clearBilling() {
        minutesLabel = ""
        voiceSeconds = 0
        subscribed = false
        billingMessage = ""
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
        isConnecting = false
        extendingHold = false
        walletLeftover = 0
        limitWorkItem?.cancel()
        limitWorkItem = nil
        callStartedAt = nil
        let voiceSessionId = realtime.voiceSessionId
        realtime.stop()
        realtime.memorySessionId = nil
        realtime.voiceSessionId = nil
        music.stop()
        watch.clear(notify: false)
        camera.stop(notify: false)
        screen.stop(notify: false)
        toys.reset()
        textRows = []
        textSessionId = nil
        textBusy = false
        chatMode = .text
        lastError = ""
        account.signOut()
        channelNames = []
        clearBilling()
        refreshStatus()
        Task { await api.settleVoiceSession(voiceSessionId: voiceSessionId) }
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
        if chatMode == .text { return }
        toggleCall()
    }

    func setChatMode(_ mode: ChatMode) {
        chatMode = mode
    }

    func sendText(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ""
        lastError = ""
        if realtime.isReady {
            toys.noteUtterance(trimmed)
            realtime.sendText(trimmed)
            refreshStatus()
            return
        }
        await sendTextChat(trimmed)
    }

    private func sendTextChat(_ text: String) async {
        if !account.isSignedIn {
            lastError = "Sign in first."
            refreshStatus()
            return
        }
        if textBusy { return }
        textBusy = true
        lastError = ""
        chatMode = .text
        toys.noteUtterance(text)
        appendTextRow(role: "user", text: text)
        do {
            let result = try await api.sendChat(text, sessionId: textSessionId)
            if let next = result.sessionId, !next.isEmpty { textSessionId = next }
            appendTextRow(role: "assistant", text: result.reply)
        } catch {
            lastError = error.localizedDescription
        }
        textBusy = false
        refreshStatus()
    }

    private func appendTextRow(role: String, text: String) {
        textRows.append(TranscriptRow(id: UUID(), role: role, text: text))
        rows = textRows
        caption = text
    }

    private func enterTextModeSilently(reason: String) {
        if textRows.isEmpty && !realtime.rows.isEmpty {
            textRows = realtime.rows
        }
        chatMode = .text
        lastError = ""
        isConnecting = false
        Task { await api.logVoiceFailure(reason: reason, sessionId: realtime.memorySessionId) }
        refreshStatus()
    }

    private static func isVoiceConnectFailure(_ message: String) -> Bool {
        if message.range(of: #"^out of minutes\.?$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return false
        }
        if message.localizedCaseInsensitiveContains("time limit") { return false }
        if message.localizedCaseInsensitiveContains("spend limit") { return false }
        if message.localizedCaseInsensitiveContains("Sign in") { return false }
        return true
    }

    private static func isAuthFailure(_ message: String) -> Bool {
        message.range(
            of: #"401|403|unauthor|expired|invalid.?token|forbidden|Voice auth failed"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
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

    func toggleScreenShare() {
        if screen.isOn {
            screen.stop()
            return
        }
        Task { await startScreenShare() }
    }

    private func startScreenShare() async {
        await screen.start()
        guard screen.isOn else { return }
        if !realtime.isLive {
            await connectRealtimeForVision()
        }
        if screen.isOn, realtime.isLive {
            realtime.notifyVision(source: "screen", active: true)
        }
    }

    /// Open the voice socket so screen frames can send. Mic stays off; failures stay silent.
    private func connectRealtimeForVision() async {
        if realtime.isLive || isConnecting { return }
        lastError = ""
        connectGeneration += 1
        authRefreshCount = 0
        captureMicEnabled = false
        let gen = connectGeneration
        isConnecting = true
        refreshStatus()
        do {
            try await openRealtime(generation: gen)
            guard gen == connectGeneration else { return }
        } catch {
            guard gen == connectGeneration else { return }
            enterTextModeSilently(reason: error.localizedDescription)
        }
    }

    func connectCall() {
        lastError = ""
        connectGeneration += 1
        authRefreshCount = 0
        captureMicEnabled = true
        let gen = connectGeneration
        isConnecting = true
        refreshStatus()
        location.start(silent: true)
        Task {
            let micOK = await requestMicrophone()
            guard gen == connectGeneration else { return }
            guard micOK else {
                enterTextModeSilently(reason: "Microphone access is required to talk to Lexi.")
                return
            }
            do {
                try await openRealtime(generation: gen)
                guard gen == connectGeneration, realtime.isLive else { return }
                chatMode = .voice
            } catch {
                guard gen == connectGeneration else { return }
                enterTextModeSilently(reason: error.localizedDescription)
            }
        }
    }

    func endCall() {
        connectGeneration += 1
        isConnecting = false
        extendingHold = false
        walletLeftover = 0
        limitWorkItem?.cancel()
        limitWorkItem = nil
        callStartedAt = nil
        let sessionId = realtime.memorySessionId
        let voiceSessionId = realtime.voiceSessionId
        realtime.stop()
        realtime.memorySessionId = nil
        realtime.voiceSessionId = nil
        // Hang up: clear previousSessionId. Next Call sends null + empty prior; facts stay.
        AccountStore.shared.clearCallContinuity()
        camera.stop(notify: false)
        screen.stop(notify: false)
        toys.reset()
        refreshStatus()
        Task {
            await api.settleVoiceSession(voiceSessionId: voiceSessionId)
            await api.settlePendingVoiceSessions()
            await api.endMemorySession(sessionId: sessionId)
        }
    }

    func settleIfIdle() {
        guard launchWorkStarted else { return }
        guard !realtime.isLive, !isConnecting, !extendingHold else { return }
        Task {
            await api.settlePendingVoiceSessions()
            guard allowIdleBillingRefresh else { return }
            await refreshBilling()
        }
    }

    private func openRealtime(generation gen: Int) async throws {
        // Fresh Call: no previousSessionId, no prior transcript. Recalled facts still load server-side.
        await api.settlePendingVoiceSessions()
        AccountStore.shared.clearCallContinuity()
        realtime.memorySessionId = nil
        realtime.voiceSessionId = nil
        callStartedAt = nil
        let seconds = await refreshBilling()
        if let seconds, seconds <= 0 {
            throw NSError(domain: "LexiAPI", code: 402, userInfo: [NSLocalizedDescriptionKey: "Out of minutes."])
        }
        let session = try await api.startRealtimeSession(
            sessionId: nil,
            previousSessionId: nil,
            timeZone: TimeZone.current.identifier,
            location: location.payload(),
            musicPlaying: music.playing,
            musicTitle: music.title,
            musicSource: music.source
        )
        guard gen == connectGeneration else { return }
        realtime.memorySessionId = session.sessionId
        realtime.voiceSessionId = session.voiceSessionId
        if let voiceSessionId = session.voiceSessionId {
            account.rememberPendingVoiceSession(voiceSessionId)
        }
        applyVoiceHold(session)
        applySessionLimits(session)
        isConnecting = false
        realtime.start(
            token: session.token,
            realtimeURL: VoiceRealtimeConfig.url,
            sessionUpdate: pinnedSessionUpdate(session),
            captureMic: captureMicEnabled
        )
        if watch.isLoaded {
            realtime.notifyVideo(active: true, title: watch.title)
        }
        if camera.isOn {
            realtime.notifyVision(source: "camera", active: true)
        }
        if screen.isOn {
            realtime.notifyVision(source: "screen", active: true)
        }
        refreshStatus()
    }

    private func applyVoiceHold(_ session: IosSessionResponse) {
        walletLeftover = session.voiceSeconds ?? 0
        guard let capAtMs = session.capAtMs else { return }
        let lead: Double = walletLeftover > 0 ? 12 : 0
        realtime.armVoiceCap(capAtMs: capAtMs - lead * 1000) { [weak self] in
            guard let self else { return }
            if let message = self.sessionLimitMessage() {
                self.enterTextModeSilently(reason: message)
                self.endCall()
                return
            }
            if self.walletLeftover > 0 {
                self.extendHoldOrHangup()
            } else {
                self.enterTextModeSilently(reason: "Out of minutes.")
                self.endCall()
            }
        }
    }

    private func applySessionLimits(_ session: IosSessionResponse) {
        if callStartedAt == nil {
            callStartedAt = parseStartedAt(session.startedAt) ?? Date()
        }
        armSessionLimits()
    }

    private func armSessionLimits() {
        limitWorkItem?.cancel()
        guard callStartedAt != nil else { return }
        if let message = sessionLimitMessage() {
            enterTextModeSilently(reason: message)
            endCall()
            return
        }
        let wait = VoiceRealtimeConfig.secondsUntilLimit(elapsed: callElapsed())
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if let message = self.sessionLimitMessage() {
                self.enterTextModeSilently(reason: message)
                self.endCall()
            }
        }
        limitWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: work)
    }

    private func callElapsed() -> TimeInterval {
        guard let callStartedAt else { return 0 }
        return Date().timeIntervalSince(callStartedAt)
    }

    private func sessionLimitMessage() -> String? {
        VoiceRealtimeConfig.limitMessage(elapsed: callElapsed())
    }

    private func parseStartedAt(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: raw)
    }

    private func pinnedSessionUpdate(_ session: IosSessionResponse) -> [String: Any] {
        var update = session.sessionUpdate ?? [
            "type": "session.update",
            "session": [
                "voice": "aria",
                "instructions": session.instructions ?? "",
                "turn_detection": ["type": "server_vad"],
            ] as [String: Any],
        ]
        var payload = update["session"] as? [String: Any] ?? [:]
        payload["model"] = VoiceRealtimeConfig.model
        payload["reasoning"] = ["effort": "none"]
        update["type"] = "session.update"
        update["session"] = payload
        return update
    }

    private func extendHoldOrHangup() {
        if extendingHold { return }
        extendingHold = true
        let voiceSessionId = realtime.voiceSessionId ?? ""
        let sessionId = realtime.memorySessionId
        Task {
            defer { extendingHold = false }
            do {
                guard !voiceSessionId.isEmpty else {
                    enterTextModeSilently(reason: "Out of minutes.")
                    endCall()
                    return
                }
                let session = try await api.extendRealtimeSession(
                    voiceSessionId: voiceSessionId,
                    sessionId: sessionId,
                    timeZone: TimeZone.current.identifier,
                    location: location.payload(),
                    musicPlaying: music.playing,
                    musicTitle: music.title,
                    musicSource: music.source
                )
                guard realtime.isLive else { return }
                realtime.memorySessionId = session.sessionId ?? sessionId
                realtime.voiceSessionId = session.voiceSessionId ?? voiceSessionId
                if let nextId = session.voiceSessionId ?? (voiceSessionId.isEmpty ? nil : voiceSessionId) {
                    account.rememberPendingVoiceSession(nextId)
                }
                applyVoiceHold(session)
                applySessionLimits(session)
                realtime.start(
                    token: session.token,
                    realtimeURL: VoiceRealtimeConfig.url,
                    sessionUpdate: pinnedSessionUpdate(session),
                    captureMic: captureMicEnabled
                )
            } catch {
                enterTextModeSilently(reason: error.localizedDescription)
                endCall()
            }
        }
    }

    private func refreshVoiceSession() {
        if authRefreshCount >= 1 {
            enterTextModeSilently(reason: "Voice auth failed after retry.")
            endCall()
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
                enterTextModeSilently(reason: error.localizedDescription)
                endCall()
            }
        }
    }

    func loadVideo() {
        Task { await watch.load(using: api) }
    }

    private func syncDuck() {
        realtime.voiceDucked = music.playing
    }

    private func requestMicrophone() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    nonisolated func realtime(_ session: RealtimeSession, didChange phase: VoicePhase) {
        Task { @MainActor in
            self.phase = phase
            self.isLive = session.isLive
            if session.isLive {
                self.music.resumeIfNeeded()
                self.syncDuck()
            }
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, caption: String) {
        Task { @MainActor in
            if session.isLive {
                self.caption = caption
            }
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, rows: [TranscriptRow]) {
        Task { @MainActor in
            if session.isLive {
                self.rows = rows
            }
        }
    }

    nonisolated func realtime(_ session: RealtimeSession, error: String) {
        Task { @MainActor in
            self.isLive = session.isLive
            self.phase = session.phase
            self.isConnecting = false
            if session.isLive {
                self.lastError = ""
                Task { await self.api.logVoiceFailure(reason: error, sessionId: session.memorySessionId) }
                return
            }
            if Self.isAuthFailure(error), self.authRefreshCount < 1 {
                self.lastError = ""
                return
            }
            self.enterTextModeSilently(reason: error)
            self.camera.stop(notify: false)
            self.screen.stop(notify: false)
            if !self.extendingHold {
                self.endCall()
            }
        }
    }

    nonisolated func realtimeNeedsSessionRefresh(_ session: RealtimeSession) {
        Task { @MainActor in
            self.refreshVoiceSession()
        }
    }

    nonisolated func realtimeDidDisconnect(_ session: RealtimeSession) {
        Task { @MainActor in
            self.isLive = false
            self.isConnecting = false
            self.camera.stop(notify: false)
            self.screen.stop(notify: false)
            if self.extendingHold { return }
            await self.api.settleVoiceSession(voiceSessionId: session.voiceSessionId)
            await self.api.settlePendingVoiceSessions()
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
                playlistId: (arguments["playlist_id"] as? String) ?? (arguments["playlistId"] as? String),
                allowOurSong: account.isAdmin,
                using: api
            )
            syncDuck()
            return stringify(["ok": true, "message": message])
        case "stop_music":
            music.stop()
            syncDuck()
            return stringify(["ok": true])
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
            if frames.isEmpty {
                if camera.isOn {
                    return stringify([
                        "ok": true,
                        "live": true,
                        "source": "camera",
                        "description": "The camera is already a live 30fps video stream in this session. Describe what you see from that live camera video. Do not ask for stills.",
                    ])
                }
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
