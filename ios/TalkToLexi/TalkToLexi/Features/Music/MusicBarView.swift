import SwiftUI

struct MusicBarView: View {
    @Binding var query: String
    var playing: Bool
    var title: String
    var busy: Bool
    var hint: String
    var showOurSong: Bool
    var onPlayPause: () -> Void
    var onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                TextField("Play a song, playlist, or paste an Apple Music link", text: $query)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .tint(.white)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .font(.system(size: 14))
                Button("Play Song", action: onPlayPause)
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .disabled(busy)
                    .accessibilityLabel("Play Song")
                Button("Skip", action: onNext)
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .disabled(busy)
                    .accessibilityLabel("Skip")
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
                Text(showOurSong
                     ? "Play starts from your tap. Empty play is our song."
                     : "Play starts from your tap. Search a song or playlist first.")
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
