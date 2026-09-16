import AVKit
import SwiftUI

struct WatchPlayerView: View {
    var player: AVPlayer
    var title: String
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VideoPlayer(player: player)
                .frame(minHeight: 180)
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(Color.black)
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title.isEmpty ? "Watch together" : title)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                    Text("Headphones recommended — Lexi hears your mic only, not the video.")
                        .font(.system(size: 11))
                        .foregroundStyle(LexiTheme.muted)
                }
                Spacer()
                Button("Close", action: onClose)
                    .font(.system(size: 12))
                    .foregroundStyle(LexiTheme.muted)
            }
            .padding(10)
        }
        .background(LexiTheme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(LexiTheme.stroke, lineWidth: 1)
        )
    }
}

struct WatchURLField: View {
    @Binding var draft: String
    var busy: Bool
    var hint: String?
    var onLoad: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                TextField("Paste video URL", text: $draft)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .tint(.white)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .font(.system(size: 14))
                    .submitLabel(.go)
                    .onSubmit(onLoad)
                Button(busy ? "…" : "Load", action: onLoad)
                    .font(.system(size: 12))
                    .disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .foregroundStyle(LexiTheme.muted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(LexiTheme.panel, in: Capsule())
            .overlay(Capsule().stroke(LexiTheme.stroke, lineWidth: 1))
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(LexiTheme.muted)
            }
        }
    }
}
