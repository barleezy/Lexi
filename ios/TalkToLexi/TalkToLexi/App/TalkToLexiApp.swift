import SwiftUI

@main
struct TalkToLexiApp: App {
    @UIApplicationDelegateAdaptor(TalkToLexiAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var app = LexiAppController.shared

    var body: some Scene {
        WindowGroup {
            VoiceHomeView()
                .environmentObject(app)
                .preferredColorScheme(.dark)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        app.settleIfIdle()
                    }
                }
        }
    }
}
