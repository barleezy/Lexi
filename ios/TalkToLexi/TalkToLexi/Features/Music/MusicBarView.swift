import SwiftUI

struct MusicBarView: View {
    @Binding var query: String
    var playing: Bool
    var title: String
    var busy: Bool
    var hint: String
    var onPlayPause: () -> Void
    var onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                TextField("Play a song or paste an Apple Music link", text: $query)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .font(.system(size: 14))
                Button(action: onPlayPause) {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 32, height: 32)
                }
                .disabled(busy)
                .accessibilityLabel(playing ? "Pause Apple Music" : "Play Apple Music")
                Button(action: onNext) {
                    Image(systemName: "forward.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 32, height: 32)
                }
                .disabled(busy)
                .accessibilityLabel("Next song")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(LexiTheme.panel, in: Capsule())
            .overlay(Capsule().stroke(LexiTheme.stroke, lineWidth: 1))

            if playing || !title.isEmpty {
                Text("\(playing ? "Playing" : "Paused"): \(title.isEmpty ? "Apple Music" : title)")
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            } else {
                Text("Play starts from your tap. Empty play is our song.")
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            }
            if !hint.isEmpty {
                Text(hint)
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            }
        }
    }
}
