import PhotosUI
import SwiftUI
import UIKit

struct ComposerBar: View {
    @Binding var draft: String
    var live: Bool
    var textMode: Bool = false
    var phase: VoicePhase
    var focused: FocusState<Bool>.Binding
    var onSubmit: () -> Void
    var onPhoto: (String) -> Void
    var screenOn: Bool = false
    var onShareScreen: (() -> Void)? = nil

    @State private var picked: PhotosPickerItem?

    var body: some View {
        HStack(spacing: 8) {
            PhotosPicker(selection: $picked, matching: .images) {
                Image(systemName: "paperclip")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 36, height: 36)
                    .foregroundStyle(.white)
            }
            .accessibilityLabel("Add photo")
            if let onShareScreen {
                Button(action: onShareScreen) {
                    Image(systemName: screenOn ? "rectangle.on.rectangle" : "rectangle.dashed")
                        .font(.system(size: 16, weight: .medium))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(.white)
                }
                .accessibilityLabel(screenOn ? "Stop sharing screen" : "Share screen")
            }
            TextField(placeholder, text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
                .tint(.white)
                .lineLimit(1...4)
                .frame(minHeight: 28, alignment: .center)
                .textInputAutocapitalization(.sentences)
                .disableAutocorrection(false)
                .focused(focused)
                .submitLabel(hasText ? .send : .go)
                .onSubmit(onSubmit)
            Button(action: onSubmit) {
                composerGlyph
                    .frame(width: 36, height: 36)
                    .foregroundStyle(.white)
            }
            .accessibilityLabel(hasText ? "Send to Lexi" : (live ? "Stop talking" : "Start talking"))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 52)
        .background(LexiTheme.panel, in: Capsule())
        .overlay(Capsule().stroke(LexiTheme.stroke, lineWidth: 1))
        .layoutPriority(1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Message Lexi")
        .onChange(of: picked) { item in
            guard let item else { return }
            Task { await loadPhoto(item) }
        }
    }

    private var hasText: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var placeholder: String {
        if live { return LexiTheme.phaseHints[phase] ?? "Talk to Lexi" }
        return "Message Lexi"
    }

    @ViewBuilder
    private var composerGlyph: some View {
        if hasText {
            Image(systemName: "arrow.right")
                .font(.system(size: 16, weight: .semibold))
        } else if live {
            LiveWaveform(phase: phase)
        } else {
            Image(systemName: "waveform")
                .font(.system(size: 16, weight: .medium))
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data),
              let jpeg = image.jpegData(compressionQuality: 0.7) else { return }
        onPhoto("data:image/jpeg;base64,\(jpeg.base64EncodedString())")
    }
}

struct LiveWaveform: View {
    var phase: VoicePhase

    var body: some View {
        let tempo = phase == .speaking ? 0.28 : phase == .listening ? 0.9 : 1.4
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<4, id: \.self) { index in
                Capsule()
                    .fill(Color.white)
                    .frame(width: 3, height: 16)
                    .scaleEffect(y: 0.45, anchor: .bottom)
                    .modifier(WavePulse(period: tempo, delay: Double(index) * 0.12))
            }
        }
        .opacity(phase == .connecting || phase == .thinking ? 0.8 : 1)
        .accessibilityHidden(true)
    }
}

private struct WavePulse: ViewModifier {
    var period: Double
    var delay: Double

    func body(content: Content) -> some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate + delay
            let wave = 0.45 + 0.55 * abs(sin((t / period) * .pi))
            content.scaleEffect(y: wave, anchor: .bottom)
        }
    }
}
