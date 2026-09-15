import SwiftUI

struct VoiceHomeView: View {
    @EnvironmentObject private var app: LexiAppController

    var body: some View {
        ZStack(alignment: .top) {
            LexiTheme.page.ignoresSafeArea()
            hero
            VStack(spacing: 0) {
                header
                Spacer(minLength: 8)
                titleBlock
                Spacer(minLength: 8)
                bottomStack
            }
        }
    }

    private var header: some View {
        HStack {
            Text("Lexi")
                .font(.system(size: 13, weight: .medium))
                .tracking(2.8)
                .textCase(.uppercase)
            Spacer()
            Button(app.isSignedIn ? "Sign out" : "Sign in") {
                app.toggleSignIn()
            }
            .buttonStyle(LexiPillButtonStyle())
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
    }

    private var hero: some View {
        Image("LexiPortrait")
            .resizable()
            .scaledToFill()
            .frame(maxWidth: .infinity)
            .frame(height: 360, alignment: .top)
            .opacity(0.34)
            .mask(
                LinearGradient(
                    colors: [.black, .black.opacity(0.45), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
    }

    private var titleBlock: some View {
        VStack(spacing: 10) {
            Text("/ˈlek.si/")
                .font(.system(size: 12, design: .monospaced))
                .tracking(3.2)
                .textCase(.uppercase)
                .foregroundStyle(LexiTheme.muted)
            Text("Lexi")
                .font(.system(size: 64, weight: .semibold))
                .tracking(-1.2)
            if !app.channelNames.isEmpty {
                Text("Also on \(app.channelNames.joined(separator: " · "))")
                    .font(.system(size: 11))
                    .tracking(1.4)
                    .textCase(.uppercase)
                    .foregroundStyle(LexiTheme.muted)
            }
            Text(displayCopy)
                .font(.system(size: 18))
                .multilineTextAlignment(.center)
                .foregroundStyle(Color(red: 0.72, green: 0.72, blue: 0.75))
                .frame(maxWidth: 360)
                .padding(.top, 4)
            TranscriptView(rows: app.rows)
        }
        .padding(.horizontal, 24)
    }

    private var displayCopy: String {
        if !app.lastError.isEmpty { return app.lastError }
        if !app.latestText.isEmpty { return app.latestText }
        return "A voice-first companion."
    }

    private var bottomStack: some View {
        VStack(alignment: .leading, spacing: 10) {
            if app.watch.isLoaded {
                WatchPlayerView(player: app.watch.player, title: app.watch.title) {
                    app.watch.clear()
                }
            }
            GeneratedMediaView(items: app.generate.items)
            HStack(alignment: .bottom) {
                if app.camera.isOn {
                    CameraPreviewView(session: app.camera.session, mirrored: app.camera.facing == .front) {
                        app.camera.flip()
                    }
                    .frame(width: 96, height: 72)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 6) {
                    Button {
                        app.toggleCameraShare()
                    } label: {
                        Image(systemName: app.camera.isOn ? "camera.fill" : "camera")
                            .font(.system(size: 16, weight: .medium))
                            .frame(width: 36, height: 36)
                            .background(Color.white.opacity(app.camera.isOn ? 0.16 : 0.08), in: Circle())
                            .overlay(Circle().stroke(LexiTheme.stroke, lineWidth: 1))
                    }
                    .accessibilityLabel(app.camera.isOn ? "Stop sharing camera" : "Share camera")
                    if app.camera.isOn {
                        Text("Sharing with Lexi")
                            .font(.system(size: 11))
                            .foregroundStyle(LexiTheme.muted)
                    }
                }
            }
            if let hint = app.camera.hint {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(LexiTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            WatchURLField(
                draft: Binding(get: { app.watch.draft }, set: { app.watch.draft = $0 }),
                busy: app.watch.isBusy,
                hint: app.watch.hint
            ) {
                app.loadVideo()
            }
            actionPills
            if let hint = app.location.hint {
                Text(hint)
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
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
            } else if !app.music.hint.isEmpty {
                Text(app.music.hint)
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            } else if app.music.playing {
                Text("Playing: \(app.music.title.isEmpty ? "music" : app.music.title)")
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            }
            Button(app.connectTitle) {
                app.toggleCall()
            }
            .buttonStyle(LexiFilledButtonStyle())
            .disabled(!app.isSignedIn || app.isConnecting)
            ComposerBar(
                draft: $app.draft,
                live: app.isLive,
                phase: app.phase,
                onSubmit: { app.sendDraftOrToggle() },
                onPhoto: { app.sendPhoto($0) }
            )
            Text("Adults only. Porn 18+, roleplay 21+, refuse minors. This app holds the Grok voice session on the phone.")
                .font(.caption)
                .foregroundStyle(LexiTheme.muted)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 18)
    }

    private var actionPills: some View {
        HStack(spacing: 6) {
            LiveClock()
            Spacer(minLength: 4)
            Button(app.location.isSharing ? "Location on" : "Share location") {
                app.location.toggle()
            }
            .buttonStyle(LexiPillButtonStyle(emphasized: app.location.isSharing))
            Button(app.camera.isOn ? "Camera on" : "Share camera") {
                app.toggleCameraShare()
            }
            .buttonStyle(LexiPillButtonStyle(emphasized: app.camera.isOn))
            Button(app.music.connected ? "Disconnect Apple Music" : "Connect Apple Music") {
                app.connectAppleMusic()
            }
            .buttonStyle(LexiPillButtonStyle(emphasized: app.music.connected))
            .disabled(app.music.busy)
            if app.isLive && app.toys.grantPending && !app.toys.granted {
                Button("Give Lexi toy control") {
                    app.toys.grantFromUser()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: true))
            }
        }
    }
}

private struct LiveClock: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(context.date, style: .time)
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(LexiTheme.muted)
        }
    }
}
