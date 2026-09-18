import ReplayKit
import UIKit

/// In-app screen frames via ReplayKit `RPScreenRecorder.startCapture`.
/// ScreenCaptureKit is macOS-only; this iOS target has no Mac/Catalyst destination.
@MainActor
final class ScreenCaptureController: NSObject, ObservableObject {
    @Published private(set) var isOn = false
    @Published var hint: String?

    var onFrame: ((String) -> Void)?
    var onShareChange: ((Bool) -> Void)?

    private let recorder = RPScreenRecorder.shared()
    private let pump = CameraFramePump()

    func toggle() {
        if isOn {
            stop()
        } else {
            Task { await start() }
        }
    }

    func start() async {
        hint = nil
        guard recorder.isAvailable else {
            hint = "Screen capture is not available on this device."
            return
        }
        recorder.isMicrophoneEnabled = false
        pump.isPaused = false
        pump.resetClock()
        pump.onJPEG = { [weak self] dataUrl in
            Task { @MainActor in
                guard let self, self.isOn else { return }
                self.onFrame?(dataUrl)
            }
        }
        do {
            try await startCapture()
            let wasOn = isOn
            isOn = true
            if !wasOn {
                onShareChange?(true)
            }
        } catch {
            pump.onJPEG = nil
            pump.isPaused = true
            hint = error.localizedDescription
        }
    }

    func stop(notify: Bool = true) {
        let wasOn = isOn
        isOn = false
        hint = nil
        pump.onJPEG = nil
        pump.isPaused = true
        pump.resetClock()
        if recorder.isRecording {
            recorder.stopCapture { _ in }
        }
        if wasOn && notify {
            onShareChange?(false)
        }
    }

    private func startCapture() async throws {
        let pump = self.pump
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            recorder.startCapture { sampleBuffer, type, error in
                if error != nil { return }
                guard type == .video else { return }
                // Encode on this callback thread — CMSampleBuffer is invalid after hop.
                pump.ingest(sampleBuffer)
            } completionHandler: { error in
                if let error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume()
                }
            }
        }
    }
}
