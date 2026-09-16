import AVFoundation
import UIKit

enum CameraFacing: String {
    case front
    case rear
}

enum CameraFlipOutcome {
    case switched
    case unavailable
}

/// Encodes viewfinder stills on the capture queue. `CMSampleBuffer` is only valid
/// during `captureOutput`; hopping to the main actor first drops the frame.
final class CameraFramePump: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onJPEG: ((String) -> Void)?
    var isPaused = false

    private var lastSent: TimeInterval = 0
    /// Video-like cadence. Grok realtime has no live video item — only `input_image`.
    private let minInterval: TimeInterval = 0.25
    private let maxEdge: CGFloat = 640
    private let jpegQuality: CGFloat = 0.55
    private let context = CIContext(options: [.useSoftwareRenderer: false])

    func resetClock() {
        lastSent = 0
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        if isPaused { return }
        let now = CACurrentMediaTime()
        guard now - lastSent >= minInterval else { return }
        guard let dataUrl = jpegDataURL(from: sampleBuffer) else { return }
        lastSent = now
        onJPEG?(dataUrl)
    }

    private func jpegDataURL(from sampleBuffer: CMSampleBuffer) -> String? {
        guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        var image = CIImage(cvPixelBuffer: pixel)
        let extent = image.extent
        let longest = max(extent.width, extent.height)
        guard longest > 0 else { return nil }
        let scale = min(1, maxEdge / longest)
        if scale < 1 {
            image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        let bounds = image.extent.integral
        guard let cg = context.createCGImage(image, from: bounds) else { return nil }
        let ui = UIImage(cgImage: cg)
        guard let data = ui.jpegData(compressionQuality: jpegQuality) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }
}

/// AVCaptureSession work stays off the main actor so sample buffers stay valid.
final class CameraCapturePipeline {
    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    let pump = CameraFramePump()
    private let queue = DispatchQueue(label: "app.talktolexi.ios.camera")

    func start(facing: CameraFacing, orientation: AVCaptureVideoOrientation) {
        queue.async { [weak self] in
            guard let self else { return }
            self.installOutputIfNeeded()
            _ = self.swapInput(facing: facing, orientation: orientation, allowFallback: true)
            if self.session.isRunning == false {
                self.session.startRunning()
            }
            self.pump.isPaused = false
            self.pump.resetClock()
        }
    }

    func flip(
        facing: CameraFacing,
        orientation: AVCaptureVideoOrientation,
        completion: @escaping (CameraFlipOutcome) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else { return }
            self.pump.isPaused = true
            let outcome = self.swapInput(facing: facing, orientation: orientation, allowFallback: false)
            if self.session.inputs.isEmpty == false, self.session.isRunning == false {
                self.session.startRunning()
            }
            self.pump.isPaused = false
            if outcome == .switched {
                self.pump.resetClock()
            }
            completion(outcome)
        }
    }

    func stop() {
        pump.onJPEG = nil
        pump.isPaused = true
        pump.resetClock()
        queue.async { [weak self] in
            guard let self else { return }
            if self.session.isRunning {
                self.session.stopRunning()
            }
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            self.session.commitConfiguration()
        }
    }

    private func installOutputIfNeeded() {
        if session.outputs.contains(output) { return }
        session.beginConfiguration()
        if session.canSetSessionPreset(.vga640x480) {
            session.sessionPreset = .vga640x480
        } else {
            session.sessionPreset = .medium
        }
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(pump, queue: queue)
        if session.canAddOutput(output) {
            session.addOutput(output)
        }
        session.commitConfiguration()
    }

    private func swapInput(
        facing: CameraFacing,
        orientation: AVCaptureVideoOrientation,
        allowFallback: Bool
    ) -> CameraFlipOutcome {
        installOutputIfNeeded()
        let position: AVCaptureDevice.Position = facing == .front ? .front : .back
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
            ?? (allowFallback ? AVCaptureDevice.default(for: .video) : nil)
        guard let device, let newInput = try? AVCaptureDeviceInput(device: device) else {
            return .unavailable
        }

        let existing = session.inputs.compactMap { $0 as? AVCaptureDeviceInput }
        if let current = existing.first, current.device.uniqueID == device.uniqueID {
            applyOrientation(orientation)
            return allowFallback ? .switched : .unavailable
        }

        let wasRunning = session.isRunning
        let oldInputs = session.inputs

        if session.canAddInput(newInput) {
            session.beginConfiguration()
            session.addInput(newInput)
            oldInputs.forEach { session.removeInput($0) }
            applyOrientation(orientation)
            session.commitConfiguration()
            return .switched
        }

        if wasRunning {
            session.stopRunning()
        }
        session.beginConfiguration()
        oldInputs.forEach { session.removeInput($0) }
        if session.canAddInput(newInput) {
            session.addInput(newInput)
            applyOrientation(orientation)
            session.commitConfiguration()
            if wasRunning {
                session.startRunning()
            }
            return .switched
        }

        for old in oldInputs {
            if session.canAddInput(old) {
                session.addInput(old)
            }
        }
        applyOrientation(orientation)
        session.commitConfiguration()
        if wasRunning, session.inputs.isEmpty == false {
            session.startRunning()
        }
        return .unavailable
    }

    private func applyOrientation(_ orientation: AVCaptureVideoOrientation) {
        if let connection = output.connection(with: .video), connection.isVideoOrientationSupported {
            connection.videoOrientation = orientation
        }
    }
}

@MainActor
final class CameraController: NSObject, ObservableObject {
    @Published private(set) var isOn = false
    @Published private(set) var facing: CameraFacing = .front
    @Published var hint: String?

    var onFrame: ((String) -> Void)?
    var onShareChange: ((Bool) -> Void)?

    private let pipeline = CameraCapturePipeline()
    private var isFlipping = false

    var session: AVCaptureSession { pipeline.session }

    func toggle() {
        if isOn {
            stop()
        } else {
            Task { await start() }
        }
    }

    func flip() {
        guard isOn, isFlipping == false else { return }
        let next: CameraFacing = facing == .front ? .rear : .front
        isFlipping = true
        pipeline.flip(facing: next, orientation: currentVideoOrientation()) { [weak self] outcome in
            Task { @MainActor in
                guard let self else { return }
                self.isFlipping = false
                if outcome == .switched {
                    self.facing = next
                    self.hint = nil
                    return
                }
                self.hint = next == .rear ? "Rear camera is not available." : "Front camera is not available."
            }
        }
    }

    func start() async {
        let granted = await requestAccess()
        guard granted else {
            hint = "Camera access is required for vision."
            return
        }
        hint = nil
        let wasOn = isOn
        isOn = true
        pipeline.pump.onJPEG = { [weak self] dataUrl in
            Task { @MainActor in
                guard let self, self.isOn else { return }
                self.onFrame?(dataUrl)
            }
        }
        pipeline.start(facing: facing, orientation: currentVideoOrientation())
        if !wasOn {
            onShareChange?(true)
        }
    }

    func stop(notify: Bool = true) {
        let wasOn = isOn
        isOn = false
        isFlipping = false
        hint = nil
        pipeline.stop()
        if wasOn && notify {
            onShareChange?(false)
        }
    }

    private func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    continuation.resume(returning: granted)
                }
            }
        default:
            return false
        }
    }

    private func currentVideoOrientation() -> AVCaptureVideoOrientation {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            return .portrait
        }
        switch scene.interfaceOrientation {
        case .landscapeLeft:
            return .landscapeRight
        case .landscapeRight:
            return .landscapeLeft
        case .portraitUpsideDown:
            return .portraitUpsideDown
        default:
            return .portrait
        }
    }
}
