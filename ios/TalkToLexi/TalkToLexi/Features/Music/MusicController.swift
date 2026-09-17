import AVFoundation
import MediaPlayer
import MusicKit
import StoreKit

@MainActor
final class MusicController: ObservableObject {
    static let ourSongQuery = "Down Low Astrid S"

    @Published private(set) var playing = false
    @Published private(set) var title = ""
    @Published private(set) var source = "none"
    @Published private(set) var connected = false
    @Published private(set) var configured = false
    @Published var query = ""
    @Published var hint = ""
    @Published var busy = false

    private var developerToken = ""
    private var urlPlayer: AVPlayer?
    private let nowPlaying = NowPlayingCenter()
    private var interruptionObserver: NSObjectProtocol?
    var onChange: (() -> Void)?

    init() {
        nowPlaying.onToggle = { [weak self] in
            self?.togglePaused()
        }
        nowPlaying.onNext = { [weak self] in
            guard let self else { return }
            Task { await self.skipNext(using: LexiAPIClient(), allowOurSong: AccountStore.shared.isAdmin) }
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

    /// Voice playAndRecord can briefly interrupt MusicKit. Resume if we still own playback.
    func resumeIfNeeded() {
        guard playing else { return }
        if source == "url" {
            urlPlayer?.play()
            nowPlaying.setPlaying(true)
            notify()
            return
        }
        Task { @MainActor in
            guard playing, source == "apple" else { return }
            if ApplicationMusicPlayer.shared.state.playbackStatus != .playing {
                try? await ApplicationMusicPlayer.shared.play()
            }
            nowPlaying.setPlaying(true)
            notify()
        }
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

    func refreshStatus(using api: LexiAPIClient) async {
        do {
            let status = try await api.appleMusicStatus()
            configured = status.configured == true
            connected = status.connected == true
            developerToken = status.developerToken ?? developerToken
        } catch {
            configured = false
        }
        notify()
    }

    func connect(using api: LexiAPIClient) async -> String {
        busy = true
        defer { busy = false }
        do {
            let status = try await api.appleMusicStatus()
            configured = status.configured == true
            developerToken = status.developerToken ?? ""
            if !configured || developerToken.isEmpty {
                hint = status.error ?? "Apple Music is not configured on talktolexi.app."
                return hint
            }
            let auth = await MusicAuthorization.request()
            guard auth == .authorized else {
                hint = "Apple Music authorization was declined."
                return hint
            }
            let userToken = try await requestUserToken(developerToken)
            let result = try await api.appleMusic(action: "connect", extra: ["userToken": userToken])
            connected = (result["connected"] as? Bool) ?? true
            hint = connected ? "" : ((result["error"] as? String) ?? "Could not connect Apple Music.")
            notify()
            return connected ? "Apple Music connected." : hint
        } catch {
            hint = error.localizedDescription
            return hint
        }
    }

    func disconnect() {
        connected = false
        hint = ""
        notify()
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
        let term = query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let song = songId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let playlist = playlistId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if term.isEmpty && song.isEmpty && playlist.isEmpty {
            if allowOurSong {
                return await playApple(query: Self.ourSongQuery, songId: nil, playlistId: nil, using: api)
            }
            return "Search a song or playlist first."
        }
        return await playApple(
            query: term,
            songId: song.isEmpty ? nil : song,
            playlistId: playlist.isEmpty ? nil : playlist,
            using: api
        )
    }

    func playFromUser(using api: LexiAPIClient, allowOurSong: Bool) async {
        busy = true
        defer { busy = false }
        if playing && source == "apple" {
            togglePaused()
            return
        }
        if source == "apple" && !playing && !title.isEmpty {
            togglePaused()
            return
        }
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        hint = await play(url: nil, query: term, songId: nil, allowOurSong: allowOurSong, using: api)
    }

    func skipNext(using api: LexiAPIClient, allowOurSong: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await ApplicationMusicPlayer.shared.skipToNextEntry()
            playing = true
            source = "apple"
            nowPlaying.setPlaying(true)
            notify()
            hint = "Skipped."
        } catch {
            let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if term.isEmpty && !allowOurSong {
                hint = "Nothing else is queued. Search a song or playlist, then tap Next."
                return
            }
            hint = await playApple(
                query: term.isEmpty && allowOurSong ? Self.ourSongQuery : term,
                songId: nil,
                playlistId: nil,
                using: api
            )
        }
    }

    func playOurSong(using api: LexiAPIClient) async -> String {
        await play(url: nil, query: Self.ourSongQuery, songId: nil, allowOurSong: true, using: api)
    }

    func stop() {
        urlPlayer?.pause()
        urlPlayer = nil
        Task { @MainActor in
            ApplicationMusicPlayer.shared.stop()
        }
        playing = false
        title = ""
        source = "none"
        nowPlaying.clear()
        notify()
    }

    func togglePaused() {
        if source == "url" {
            if playing {
                urlPlayer?.pause()
                playing = false
            } else {
                urlPlayer?.play()
                playing = true
            }
            nowPlaying.setPlaying(playing)
            notify()
            return
        }
        Task { @MainActor in
            if ApplicationMusicPlayer.shared.state.playbackStatus == .playing {
                ApplicationMusicPlayer.shared.pause()
                playing = false
            } else {
                try? await ApplicationMusicPlayer.shared.play()
                playing = true
            }
            nowPlaying.setPlaying(playing)
            notify()
        }
    }

    func love(query: String?, songId: String?, using api: LexiAPIClient) async -> String {
        await musicAction("love", query: query, songId: songId, using: api)
    }

    func addToLibrary(query: String?, songId: String?, using api: LexiAPIClient) async -> String {
        await musicAction("library", query: query, songId: songId, using: api)
    }

    func addToPlaylist(query: String?, songId: String?, playlist: String?, using api: LexiAPIClient) async -> String {
        var extra: [String: Any] = [:]
        if let query { extra["query"] = query }
        if let songId { extra["songId"] = songId }
        if let playlist { extra["playlist"] = playlist }
        do {
            let result = try await api.appleMusic(action: "playlist", extra: extra)
            return (result["error"] as? String) ?? "Added to playlist."
        } catch {
            return error.localizedDescription
        }
    }

    private func musicAction(_ action: String, query: String?, songId: String?, using api: LexiAPIClient) async -> String {
        var extra: [String: Any] = [:]
        if let query { extra["query"] = query }
        if let songId { extra["songId"] = songId }
        do {
            let result = try await api.appleMusic(action: action, extra: extra)
            return (result["error"] as? String) ?? "Done."
        } catch {
            return error.localizedDescription
        }
    }

    private func playURL(_ url: URL, title: String) -> String {
        ApplicationMusicPlayer.shared.stop()
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

    private func playApple(query: String, songId: String?, playlistId: String?, using api: LexiAPIClient) async -> String {
        do {
            let auth = await MusicAuthorization.request()
            guard auth == .authorized else { return "Authorize Apple Music on the phone first." }
            if let playlist = try await resolvePlaylist(query: query, playlistId: playlistId) {
                urlPlayer?.pause()
                urlPlayer = nil
                ApplicationMusicPlayer.shared.queue = ApplicationMusicPlayer.Queue(for: [playlist])
                try await ApplicationMusicPlayer.shared.play()
                playing = true
                title = playlist.name
                source = "apple"
                nowPlaying.update(title: playlist.name, artist: "Apple Music", playing: true)
                notify()
                return "Playing \(playlist.name)."
            }
            let song: Song?
            if let songId, !songId.isEmpty {
                let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
                song = try await request.response().items.first
            } else if !query.isEmpty {
                var request = MusicCatalogSearchRequest(term: query, types: [Song.self, Playlist.self])
                request.limit = 5
                let response = try await request.response()
                let wantPlaylist = query.localizedCaseInsensitiveContains("playlist") || response.songs.isEmpty
                if wantPlaylist, let playlist = response.playlists.first {
                    urlPlayer?.pause()
                    urlPlayer = nil
                    ApplicationMusicPlayer.shared.queue = ApplicationMusicPlayer.Queue(for: [playlist])
                    try await ApplicationMusicPlayer.shared.play()
                    playing = true
                    title = playlist.name
                    source = "apple"
                    nowPlaying.update(title: playlist.name, artist: "Apple Music", playing: true)
                    notify()
                    return "Playing \(playlist.name)."
                }
                song = response.songs.first
            } else {
                song = nil
            }
            guard let song else { return "No Apple Music match for that song or playlist." }
            urlPlayer?.pause()
            urlPlayer = nil
            ApplicationMusicPlayer.shared.queue = ApplicationMusicPlayer.Queue(for: [song])
            try await ApplicationMusicPlayer.shared.play()
            playing = true
            title = [song.title, song.artistName].filter { !$0.isEmpty }.joined(separator: " — ")
            source = "apple"
            nowPlaying.update(title: song.title, artist: song.artistName, playing: true)
            notify()
            return "Playing \(song.title)."
        } catch {
            if !query.isEmpty {
                do {
                    let found = try await api.appleMusic(action: "search", extra: ["query": query])
                    return (found["error"] as? String) ?? "Apple Music play failed: \(error.localizedDescription)"
                } catch {
                    return error.localizedDescription
                }
            }
            return error.localizedDescription
        }
    }

    private func resolvePlaylist(query: String, playlistId: String?) async throws -> Playlist? {
        let id = playlistIdFromInput(playlistId ?? "") ?? playlistIdFromInput(query)
        guard let id else { return nil }
        let request = MusicCatalogResourceRequest<Playlist>(matching: \.id, equalTo: MusicItemID(id))
        return try await request.response().items.first
    }

    private func playlistIdFromInput(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.range(of: #"^(pl|p)\.[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil {
            return text
        }
        guard let url = URL(string: text), let host = url.host?.lowercased() else { return nil }
        guard host == "music.apple.com" || host.hasSuffix(".music.apple.com") || host == "itunes.apple.com" else {
            return nil
        }
        let parts = url.path.split(separator: "/").map(String.init)
        if let last = parts.last, last.range(of: #"^(pl|p)\.[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil {
            return last
        }
        return nil
    }

    private func requestUserToken(_ developerToken: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            SKCloudServiceController().requestUserToken(forDeveloperToken: developerToken) { token, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let token, !token.isEmpty {
                    continuation.resume(returning: token)
                } else {
                    continuation.resume(throwing: NSError(domain: "LexiMusic", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apple Music user token missing."]))
                }
            }
        }
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
        remote.nextTrackCommand.isEnabled = true
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
        remote.nextTrackCommand.addTarget { [weak self] _ in
            self?.onNext?()
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
