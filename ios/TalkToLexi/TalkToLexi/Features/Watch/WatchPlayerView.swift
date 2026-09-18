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
