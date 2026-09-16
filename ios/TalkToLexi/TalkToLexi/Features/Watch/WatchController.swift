import AVFoundation
import Combine
import ImageIO
import UniformTypeIdentifiers

struct WatchFrame {
    var dataUrl: String
    var timeSec: Double
}

@MainActor
final class WatchController: ObservableObject {
    @Published var draft = ""
    @Published var title = ""
    @Published var hint: String?
    @Published var isLoaded = false
    @Published var isBusy = false

    private(set) var player = AVPlayer()
    private var timeObserver: Any?
    private var recent: [WatchFrame] = []
    var onFrame: ((WatchFrame) -> Void)?
    var onLoadedChange: ((Bool, String) -> Void)?

    func load(using api: LexiAPIClient) async {
        let raw = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else {
            hint = "Paste a video URL."
            return
        }
        isBusy = true
        hint = nil
        do {
            let resolved = try await api.resolveVideo(url: raw)
            guard resolved.ok, let url = URL(string: resolved.playable) else {
                hint = resolved.error.isEmpty ? "Could not open that video." : resolved.error
                isBusy = false
                return
            }
            replacePlayer(url: url, title: resolved.title)
        } catch {
            hint = error.localizedDescription
        }
        isBusy = false
    }

    func clear(notify: Bool = true) {
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        player.pause()
        player.replaceCurrentItem(with: nil)
        recent.removeAll()
        title = ""
        let wasLoaded = isLoaded
        isLoaded = false
        hint = nil
        if wasLoaded && notify {
            onLoadedChange?(false, "")
        }
    }

    func framesForContext(limit: Int = 4) -> [WatchFrame] {
        Array(recent.suffix(limit))
    }

    private func replacePlayer(url: URL, title: String) {
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        self.title = title.isEmpty ? "Watch together" : title
        isLoaded = true
        recent.removeAll()
        player.play()
        onLoadedChange?(true, self.title)
        let interval = CMTime(seconds: 2.4, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor in
                self?.captureStill(at: time)
            }
        }
    }

    private func captureStill(at time: CMTime) {
        guard let asset = player.currentItem?.asset else { return }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 640, height: 360)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.4, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.4, preferredTimescale: 600)
        generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { [weak self] _, image, actual, _, _ in
            guard let image, let dataUrl = Self.jpegDataURL(image) else { return }
            let seconds = actual.seconds.isFinite ? actual.seconds : time.seconds
            Task { @MainActor in
                guard let self else { return }
                let frame = WatchFrame(dataUrl: dataUrl, timeSec: seconds)
                self.recent.append(frame)
                if self.recent.count > 8 { self.recent.removeFirst(self.recent.count - 8) }
                self.onFrame?(frame)
            }
        }
    }

    nonisolated private static func jpegDataURL(_ image: CGImage) -> String? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(
            data,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { return nil }
        CGImageDestinationAddImage(
            dest,
            image,
            [kCGImageDestinationLossyCompressionQuality: 0.62] as CFDictionary
        )
        guard CGImageDestinationFinalize(dest) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }
}
