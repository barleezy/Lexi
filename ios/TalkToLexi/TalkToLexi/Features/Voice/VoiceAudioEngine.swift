import AVFoundation

final class VoiceAudioEngine {
    static let sampleRate = 48_000
    static let voiceDuckLevel: Float = 0.42
    private static let chunkFrames = 1_920 // 40ms at 48 kHz

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var pending = Data()
    private var running = false
    var onPCM: ((Data) -> Void)?

    /// Activates `AVAudioSession` `.playAndRecord` only while a voice session is running.
    /// Never call this at launch, while signed out, or while idle.
    private func activatePlayAndRecord() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [
                .mixWithOthers,
                .allowBluetooth,
                .allowBluetoothA2DP,
                .defaultToSpeaker,
            ]
        )
        try session.setPreferredSampleRate(Double(Self.sampleRate))
        try session.setPreferredIOBufferDuration(0.04)
        try session.setActive(true, options: [])
    }

    private func deactivatePlayAndRecord() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    func start() throws {
        if running { return }
        try activatePlayAndRecord()
        if player.engine == nil {
            engine.attach(player)
            let outFormat = engine.mainMixerNode.outputFormat(forBus: 0)
            engine.connect(player, to: engine.mainMixerNode, format: outFormat)
        }
        let input = engine.inputNode
        let hwFormat = input.outputFormat(forBus: 0)
        guard let mono48 = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: Double(Self.sampleRate),
            channels: 1,
            interleaved: true
        ) else {
            deactivatePlayAndRecord()
            throw NSError(domain: "LexiAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not build 48 kHz PCM format."])
        }
        targetFormat = mono48
        converter = AVAudioConverter(from: hwFormat, to: mono48)
        pending.removeAll(keepingCapacity: true)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(Self.chunkFrames), format: hwFormat) { [weak self] buffer, _ in
            self?.capture(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            deactivatePlayAndRecord()
            throw error
        }
        player.play()
        running = true
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        pending.removeAll()
        running = false
        deactivatePlayAndRecord()
    }

    func stopPlayback() {
        player.stop()
        if running {
            player.play()
        }
    }

    func setVoiceDucked(_ ducked: Bool) {
        player.volume = ducked ? Self.voiceDuckLevel : 1
    }

    func schedulePCM16(_ data: Data) {
        guard running, let format = targetFormat, !data.isEmpty else { return }
        let frames = data.count / 2
        guard frames > 0 else { return }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { raw in
            if let dest = buffer.int16ChannelData?[0], let src = raw.bindMemory(to: Int16.self).baseAddress {
                dest.update(from: src, count: frames)
            }
        }
        player.scheduleBuffer(buffer, completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    private func capture(_ buffer: AVAudioPCMBuffer) {
        guard let converter, let targetFormat else { return }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let outFrames = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: max(outFrames, 1)) else { return }
        var consumed = false
        let status = converter.convert(to: out, error: nil) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, out.frameLength > 0, let channel = out.int16ChannelData?[0] else { return }
        let bytes = Int(out.frameLength) * 2
        pending.append(Data(bytes: channel, count: bytes))
        let chunkBytes = Self.chunkFrames * 2
        while pending.count >= chunkBytes {
            let chunk = pending.prefix(chunkBytes)
            pending.removeFirst(chunkBytes)
            onPCM?(Data(chunk))
        }
    }
}
