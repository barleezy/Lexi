import SwiftUI

@main
struct TalkToLexiApp: App {
    @UIApplicationDelegateAdaptor(TalkToLexiAppDelegate.self) private var appDelegate
    @ObservedObject private var app = LexiAppController.shared

    var body: some Scene {
        WindowGroup {
            VoiceHomeView()
                .environmentObject(app)
                .preferredColorScheme(.dark)
        }
    }
}
