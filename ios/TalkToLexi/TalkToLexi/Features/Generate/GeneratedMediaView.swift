import AVKit
import SwiftUI
import UIKit

struct GeneratedMediaView: View {
    var items: [GeneratedMediaItem]

    var body: some View {
        if !items.isEmpty {
            VStack(spacing: 8) {
                ForEach(items.prefix(3)) { item in
                    VStack(alignment: .leading, spacing: 0) {
                        media(item)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.prompt)
                                .font(.system(size: 12))
                                .lineLimit(1)
                            Text(statusLine(item))
                                .font(.system(size: 11))
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
        }
    }

    @ViewBuilder
    private func media(_ item: GeneratedMediaItem) -> some View {
        if item.kind == "image" {
            if let image = UIImage.fromDataURL(item.dataUrl) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 240)
                    .frame(maxWidth: .infinity)
                    .background(Color.black)
            } else if let raw = item.url, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().padding()
                }
                .frame(maxHeight: 240)
                .frame(maxWidth: .infinity)
                .background(Color.black)
            }
        } else if item.kind == "video", item.status == "done", let raw = item.url, let url = URL(string: raw) {
            RemoteVideoView(url: url)
                .frame(minHeight: 160)
                .aspectRatio(16 / 9, contentMode: .fit)
        }
    }

    private func statusLine(_ item: GeneratedMediaItem) -> String {
        if item.status == "pending" { return "Making a \(item.kind)…" }
        if item.status == "failed" { return item.error ?? "\(item.kind) failed." }
        return item.kind == "video" ? "Generated video" : "Generated photo"
    }
}

private struct RemoteVideoView: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
            } else {
                Color.black
            }
        }
        .onAppear {
            let next = AVPlayer(url: url)
            player = next
        }
        .onDisappear {
            player?.pause()
        }
    }
}

private extension UIImage {
    static func fromDataURL(_ raw: String?) -> UIImage? {
        guard let raw, !raw.isEmpty else { return nil }
        let payload = raw.split(separator: ",", maxSplits: 1).last.map(String.init) ?? raw
        guard let data = Data(base64Encoded: payload) else { return nil }
        return UIImage(data: data)
    }
}
