import SwiftUI
import UIKit

private enum HomeSurface: String {
    case voice
    case text
}

struct VoiceHomeView: View {
    @EnvironmentObject private var app: LexiAppController
    @FocusState private var composerFocused: Bool
    @State private var showSettings = false
    @State private var surface: HomeSurface = .text

    private let portraitWidth: CGFloat = 52
    private let portraitHeight: CGFloat = 68

    var body: some View {
        VStack(spacing: 0) {
            header
            messageList
            composer
            modeRow
            shareRow
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(LexiTheme.page.ignoresSafeArea())
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(app)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Lexi")
                .font(.system(size: 20, weight: .semibold))
                .lineLimit(1)
            portrait
            Spacer(minLength: 8)
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Settings")
            Button(app.isSignedIn ? "Sign out" : "Sign in") {
                app.toggleSignIn()
            }
            .font(.system(size: app.isSignedIn ? 12 : 15, weight: .semibold))
            .padding(.horizontal, app.isSignedIn ? 12 : 16)
            .padding(.vertical, app.isSignedIn ? 6 : 10)
            .foregroundStyle(app.isSignedIn ? Color.white.opacity(0.85) : .black)
            .background(app.isSignedIn ? Color.white.opacity(0.08) : Color.white, in: Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var portrait: some View {
        if hasPortrait {
            Image("LexiPortrait")
                .resizable()
                .scaledToFill()
                .frame(width: portraitWidth, height: portraitHeight)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(LexiTheme.stroke, lineWidth: 1)
                )
                .accessibilityLabel("Lexi")
        }
    }

    private var hasPortrait: Bool {
        guard let image = UIImage(named: "LexiPortrait") else { return false }
        return image.size.width > 1 && image.size.height > 1
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !app.lastError.isEmpty {
                        Text(app.lastError)
                            .font(.system(size: 16))
                            .foregroundStyle(LexiTheme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                    }
                    if app.rows.isEmpty && app.lastError.isEmpty {
                        Text(displayCopy)
                            .font(.system(size: 16))
                            .foregroundStyle(Color(red: 0.72, green: 0.72, blue: 0.75))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                    }
                    TranscriptView(rows: app.rows)
                    extras
                        .padding(.horizontal, 16)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: app.rows.count) { _ in
                guard let last = app.rows.last else { return }
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var displayCopy: String {
        if !app.latestText.isEmpty { return app.latestText }
        return surface == .text ? "Message Lexi." : "A voice-first companion."
    }

    private var composer: some View {
        ComposerBar(
            draft: $app.draft,
            live: app.isLive,
            phase: app.phase,
            focused: $composerFocused,
            idlePlaceholder: surface == .text ? "Message Lexi" : "Talk to Lexi",
            onSubmit: { app.sendDraftOrToggle() },
            onPhoto: { app.sendPhoto($0) }
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .fixedSize(horizontal: false, vertical: true)
        .background(LexiTheme.page)
    }

    private var modeRow: some View {
        HStack(spacing: 12) {
            HStack(spacing: 4) {
                surfaceButton("Voice", .voice)
                surfaceButton("Text", .text)
            }
            Spacer(minLength: 12)
            Button(app.connectTitle) {
                composerFocused = false
                app.toggleCall()
            }
            .font(.system(size: 15, weight: .semibold))
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .foregroundStyle(.black)
            .background(Color.white, in: Capsule())
            .opacity(app.isConnecting ? 0.35 : 1)
            .disabled(app.isConnecting)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func surfaceButton(_ title: String, _ value: HomeSurface) -> some View {
        Button(title) {
            surface = value
        }
        .font(.system(size: 14, weight: .semibold))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .foregroundStyle(surface == value ? .black : Color.white.opacity(0.85))
        .background(surface == value ? Color.white : Color.white.opacity(0.08), in: Capsule())
    }

    private var shareRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Button(app.location.isSharing ? "Location on" : "Share location") {
                    app.location.toggle()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: app.location.isSharing))
                Button(app.camera.isOn ? "Camera on" : "Share camera") {
                    app.toggleCameraShare()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: app.camera.isOn))
                Button(app.screen.isOn ? "Screen on" : "Share screen") {
                    app.toggleScreenShare()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: app.screen.isOn))
            }
            if let hint = shareHint {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(LexiTheme.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var shareHint: String? {
        if let hint = app.screen.hint, !hint.isEmpty { return hint }
        if let hint = app.camera.hint, !hint.isEmpty { return hint }
        if let hint = app.location.hint, !hint.isEmpty { return hint }
        return nil
    }

    private var extras: some View {
        VStack(alignment: .leading, spacing: 10) {
            if app.watch.isLoaded {
                WatchPlayerView(player: app.watch.player, title: app.watch.title) {
                    app.watch.clear()
                }
            }
            GeneratedMediaView(items: app.generate.items)
            if app.camera.isOn {
                HStack(alignment: .bottom) {
                    CameraPreviewView(session: app.camera.session, mirrored: app.camera.facing == .front) {
                        app.camera.flip()
                    }
                    .frame(width: 96, height: 72)
                    Spacer(minLength: 0)
                    Text("Sharing with Lexi")
                        .font(.system(size: 11))
                        .foregroundStyle(LexiTheme.muted)
                }
            }
            WatchURLField(
                draft: Binding(get: { app.watch.draft }, set: { app.watch.draft = $0 }),
                busy: app.watch.isBusy,
                hint: app.watch.hint
            ) {
                app.loadVideo()
            }
            if app.music.connected {
                MusicBarView(
                    query: Binding(get: { app.music.query }, set: { app.music.query = $0 }),
                    playing: app.music.playing && app.music.source != "url",
                    title: app.music.source == "apple" ? app.music.title : "",
                    busy: app.music.busy,
                    hint: app.music.hint,
                    onPlayPause: { app.playAppleMusic() },
                    onNext: { app.skipAppleMusic() }
                )
            } else {
                Button(app.music.busy ? "Connecting Apple Music…" : "Connect Apple Music") {
                    app.connectAppleMusic()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: false))
                .disabled(app.music.busy)
                if !app.music.hint.isEmpty {
                    Text(app.music.hint)
                        .font(.system(size: 11))
                        .foregroundStyle(LexiTheme.muted)
                }
            }
            if app.music.playing && !app.music.connected {
                Text("Playing: \(app.music.title.isEmpty ? "music" : app.music.title)")
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            }
            if app.isLive && app.toys.grantPending && !app.toys.granted {
                Button("Give Lexi toy control") {
                    app.toys.grantFromUser()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: true))
            }
            if app.routeThroughPS5PartyChat, !app.ps5ChatPortStatus.isEmpty {
                Text(app.ps5ChatPortStatus)
                    .font(.system(size: 12))
                    .foregroundStyle(LexiTheme.muted)
            }
        }
    }
}
