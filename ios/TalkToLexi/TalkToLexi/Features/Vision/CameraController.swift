import AVFoundation
import UIKit

enum CameraFacing: String {
    case front
    case rear
}

/// Encodes viewfinder stills on the capture queue. `CMSampleBuffer` is only valid
/// during `captureOutput`; hopping to the main actor first drops the frame.
final class CameraFramePump: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onJPEG: ((String) -> Void)?

    private var lastSent: TimeInterval = 0
    private let minInterval: TimeInterval = 1.0
    private let maxEdge: CGFloat = 640
    private let jpegQuality: CGFloat = 0.6
    private let context = CIContext(options: [.useSoftwareRenderer: false])

    func resetClock() {
        lastSent = 0
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
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
            self?.reconfigure(facing: facing, orientation: orientation)
            self?.session.startRunning()
        }
    }

    func flip(facing: CameraFacing, orientation: AVCaptureVideoOrientation) {
        queue.async { [weak self] in
            self?.reconfigure(facing: facing, orientation: orientation)
        }
    }

    func stop() {
        pump.onJPEG = nil
        pump.resetClock()
        queue.async { [weak self] in
            guard let self else { return }
            self.session.stopRunning()
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            self.session.commitConfiguration()
        }
    }

    private func reconfigure(facing: CameraFacing, orientation: AVCaptureVideoOrientation) {
        session.beginConfiguration()
        if session.canSetSessionPreset(.vga640x480) {
            session.sessionPreset = .vga640x480
        } else {
            session.sessionPreset = .medium
        }
        session.inputs.forEach { session.removeInput($0) }
        if session.outputs.contains(output) == false {
            output.alwaysDiscardsLateVideoFrames = true
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.setSampleBufferDelegate(pump, queue: queue)
            if session.canAddOutput(output) {
                session.addOutput(output)
            }
        }
        let position: AVCaptureDevice.Position = facing == .front ? .front : .back
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
            ?? AVCaptureDevice.default(for: .video)
        if let device, let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
            session.addInput(input)
        }
        if let connection = output.connection(with: .video), connection.isVideoOrientationSupported {
            connection.videoOrientation = orientation
        }
        session.commitConfiguration()
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

    var session: AVCaptureSession { pipeline.session }

    func toggle() {
        if isOn {
            stop()
        } else {
            Task { await start() }
        }
    }

    func flip() {
        guard isOn else { return }
        facing = facing == .front ? .rear : .front
        pipeline.flip(facing: facing, orientation: currentVideoOrientation())
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
