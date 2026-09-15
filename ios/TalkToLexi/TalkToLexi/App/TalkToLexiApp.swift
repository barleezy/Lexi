import SwiftUI

@main
struct TalkToLexiApp: App {
    @StateObject private var app = LexiAppController()

    var body: some Scene {
        WindowGroup {
            VoiceHomeView()
                .environmentObject(app)
                .preferredColorScheme(.dark)
        }
    }
}
