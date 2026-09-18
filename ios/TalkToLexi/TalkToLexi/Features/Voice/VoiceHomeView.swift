import SwiftUI

struct VoiceHomeView: View {
    @EnvironmentObject private var app: LexiAppController
    @FocusState private var composerFocused: Bool
    @State private var showSettings = false

    var body: some View {
        ZStack {
            LexiTheme.page.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 14) {
                    header
                    portrait
                    titleBlock
                    extras
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            dock
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(app)
        }
    }

    private var header: some View {
        HStack {
            Text("Lexi")
                .font(.system(size: 13, weight: .medium))
                .tracking(2.8)
                .textCase(.uppercase)
            Spacer()
            if app.isSignedIn {
                let minutesText = "\(app.voiceSeconds / 60) min"
                Button {
                    showSettings = true
                } label: {
                    Text(minutesText)
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .foregroundStyle(Color.white.opacity(0.9))
                        .background(Color.white.opacity(0.08), in: Capsule())
                }
                .accessibilityLabel("Minutes, \(minutesText)")
            }
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
        .padding(.top, 8)
    }

    private var portrait: some View {
        Image("LexiPortrait")
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .frame(maxHeight: 280)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(LexiTheme.stroke, lineWidth: 1)
            )
            .accessibilityLabel("Lexi")
    }

    private var titleBlock: some View {
        VStack(spacing: 8) {
            Text("/ˈlek.si/")
                .font(.system(size: 11, design: .monospaced))
                .tracking(3.2)
                .textCase(.uppercase)
                .foregroundStyle(LexiTheme.muted)
            Text("Lexi")
                .font(.system(size: 40, weight: .semibold))
                .tracking(-0.8)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            if !app.channelNames.isEmpty {
                Text("Also on \(app.channelNames.joined(separator: " · "))")
                    .font(.system(size: 11))
                    .tracking(1.4)
                    .textCase(.uppercase)
                    .foregroundStyle(LexiTheme.muted)
            }
            Text(displayCopy)
                .font(.system(size: 16))
                .multilineTextAlignment(.center)
                .foregroundStyle(Color(red: 0.72, green: 0.72, blue: 0.75))
                .frame(maxWidth: 360)
            TranscriptView(rows: app.rows)
        }
    }

    private var displayCopy: String {
        if !app.lastError.isEmpty { return app.lastError }
        if !app.latestText.isEmpty { return app.latestText }
        return app.chatMode == .text ? "Message Lexi." : "A voice-first companion."
    }

    private var extras: some View {
        VStack(alignment: .leading, spacing: 10) {
            if app.watch.isLoaded {
                WatchPlayerView(player: app.watch.player, title: app.watch.title) {
                    app.watch.clear()
                }
            }
            GeneratedMediaView(items: app.generate.items)
            if app.camera.isOn || app.screen.isOn {
                HStack(alignment: .bottom) {
                    if app.camera.isOn {
                        CameraPreviewView(session: app.camera.session, mirrored: app.camera.facing == .front) {
                            app.camera.flip()
                        }
                        .frame(width: 96, height: 72)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 6) {
                        Text(app.screen.isOn ? "Sharing screen with Lexi" : "Sharing with Lexi")
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
            if let hint = app.screen.hint {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(LexiTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            if let hint = app.location.hint {
                Text(hint)
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            }
            if app.music.playing {
                Text("Playing: \(app.music.title.isEmpty ? "music" : app.music.title)")
                    .font(.system(size: 11))
                    .foregroundStyle(LexiTheme.muted)
            }
        }
    }

    private var dock: some View {
        VStack(spacing: 10) {
            ComposerBar(
                draft: $app.draft,
                live: app.isLive,
                textMode: true,
                phase: app.phase,
                focused: $composerFocused,
                onSubmit: { app.sendDraftOrToggle() },
                onPhoto: { app.sendPhoto($0) },
                screenOn: app.screen.isOn,
                onShareScreen: { app.toggleScreenShare() }
            )
            .onAppear {
                app.scheduleLaunchWork()
            }
            HStack(spacing: 8) {
                chatModeControl
                Spacer(minLength: 8)
                Button(app.connectTitle) {
                    composerFocused = false
                    app.toggleCall()
                }
                .buttonStyle(LexiPillButtonStyle(emphasized: app.isLive))
                .disabled(app.isConnecting)
            }
            actionPills
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(LexiTheme.page.ignoresSafeArea(edges: .bottom))
    }

    private var chatModeControl: some View {
        HStack(spacing: 6) {
            Button("Voice") { app.setChatMode(.voice) }
                .buttonStyle(LexiPillButtonStyle(emphasized: app.chatMode == .voice))
            Button("Text") { app.setChatMode(.text) }
                .buttonStyle(LexiPillButtonStyle(emphasized: app.chatMode == .text))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Chat mode")
    }

    private var actionPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                LiveClock()
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
                if app.isLive && app.toys.grantPending && !app.toys.granted {
                    Button("Give Lexi toy control") {
                        app.toys.grantFromUser()
                    }
                    .buttonStyle(LexiPillButtonStyle(emphasized: true))
                }
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
