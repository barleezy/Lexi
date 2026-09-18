import AVFoundation
import MediaPlayer

/// URL-only background audio. Apple Music / MusicKit / StoreKit are not in this target.
@MainActor
final class MusicController: ObservableObject {
    @Published private(set) var playing = false
    @Published private(set) var title = ""
    @Published private(set) var source = "none"
    @Published var query = ""
    @Published var hint = ""
    @Published var busy = false

    private var urlPlayer: AVPlayer?
    private let nowPlaying = NowPlayingCenter()
    private var interruptionObserver: NSObjectProtocol?
    var onChange: (() -> Void)?

    init() {
        nowPlaying.onToggle = { [weak self] in
            self?.togglePaused()
        }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self else { return }
            Task { @MainActor in
                self.handleInterruption(notification)
            }
        }
    }

    func resumeIfNeeded() {
        guard playing, source == "url" else { return }
        urlPlayer?.play()
        nowPlaying.setPlaying(true)
        notify()
    }

    private func handleInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        if type == .ended {
            resumeIfNeeded()
        }
    }

    func play(
        url: String?,
        query: String?,
        songId: String?,
        playlistId: String? = nil,
        allowOurSong: Bool = false,
        using api: LexiAPIClient
    ) async -> String {
        if let url, let parsed = URL(string: url), parsed.scheme == "http" || parsed.scheme == "https" {
            return playURL(parsed, title: query ?? url)
        }
        _ = query
        _ = songId
        _ = playlistId
        _ = allowOurSong
        _ = api
        return "Pass a direct audio URL. Apple Music is not available in the iPhone app."
    }

    func stop() {
        urlPlayer?.pause()
        urlPlayer = nil
        playing = false
        title = ""
        source = "none"
        nowPlaying.clear()
        notify()
    }

    func togglePaused() {
        guard source == "url" else { return }
        if playing {
            urlPlayer?.pause()
            playing = false
        } else {
            urlPlayer?.play()
            playing = true
        }
        nowPlaying.setPlaying(playing)
        notify()
    }

    private func playURL(_ url: URL, title: String) -> String {
        let player = AVPlayer(url: url)
        player.play()
        urlPlayer = player
        playing = true
        self.title = title
        source = "url"
        nowPlaying.update(title: title, artist: "Lexi", playing: true)
        notify()
        return "Playing \(title)."
    }

    private func notify() {
        onChange?()
        objectWillChange.send()
    }
}

final class NowPlayingCenter {
    var onToggle: (() -> Void)?
    var onNext: (() -> Void)?

    init() {
        let remote = MPRemoteCommandCenter.shared()
        remote.playCommand.isEnabled = true
        remote.pauseCommand.isEnabled = true
        remote.togglePlayPauseCommand.isEnabled = true
        remote.nextTrackCommand.isEnabled = false
        remote.previousTrackCommand.isEnabled = false
        remote.playCommand.addTarget { [weak self] _ in
            self?.onToggle?()
            return .success
        }
        remote.pauseCommand.addTarget { [weak self] _ in
            self?.onToggle?()
            return .success
        }
        remote.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onToggle?()
            return .success
        }
    }

    func update(title: String, artist: String, playing: Bool) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = artist
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func setPlaying(_ playing: Bool) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}

extension Notification.Name {
    static let lexiToggleMusic = Notification.Name("lexi.toggleMusic")
    static let lexiSessionChanged = Notification.Name("lexi.sessionChanged")
}
