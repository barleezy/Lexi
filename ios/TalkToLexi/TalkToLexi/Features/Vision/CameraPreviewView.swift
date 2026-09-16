import AVFoundation
import SwiftUI

struct CameraPreviewView: UIViewRepresentable {
    var session: AVCaptureSession
    var mirrored: Bool
    var onFlip: () -> Void

    func makeUIView(context: Context) -> PreviewHost {
        let host = PreviewHost()
        host.preview.session = session
        host.preview.videoGravity = .resizeAspectFill
        host.applyMirroring(mirrored)
        host.flipButton.addTarget(context.coordinator, action: #selector(Coordinator.flip), for: .touchUpInside)
        return host
    }

    func updateUIView(_ host: PreviewHost, context: Context) {
        if host.preview.session !== session {
            host.preview.session = session
        }
        host.applyMirroring(mirrored)
        context.coordinator.onFlip = onFlip
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onFlip: onFlip)
    }

    final class Coordinator: NSObject {
        var onFlip: () -> Void
        init(onFlip: @escaping () -> Void) { self.onFlip = onFlip }
        @objc func flip() { onFlip() }
    }
}

final class PreviewHost: UIView {
    let preview = AVCaptureVideoPreviewLayer()
    let flipButton = UIButton(type: .system)
    private var mirrored = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(preview)
        layer.cornerRadius = 12
        clipsToBounds = true
        layer.borderWidth = 1
        layer.borderColor = UIColor.white.withAlphaComponent(0.28).cgColor
        flipButton.setImage(UIImage(systemName: "arrow.triangle.2.circlepath.camera"), for: .normal)
        flipButton.tintColor = .white
        flipButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        flipButton.layer.cornerRadius = 14
        addSubview(flipButton)
    }

    required init?(coder: NSCoder) { nil }

    func applyMirroring(_ mirrored: Bool) {
        self.mirrored = mirrored
        preview.setAffineTransform(.identity)
        guard let connection = preview.connection, connection.isVideoMirroringSupported else { return }
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = mirrored
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        preview.frame = bounds
        flipButton.frame = CGRect(x: bounds.maxX - 32, y: bounds.maxY - 32, width: 28, height: 28)
        applyMirroring(mirrored)
    }

    override var intrinsicContentSize: CGSize {
        CGSize(width: 96, height: 72)
    }
}
