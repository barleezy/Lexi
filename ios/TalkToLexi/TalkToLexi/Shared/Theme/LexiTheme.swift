import SwiftUI

enum LexiTheme {
    static let page = Color(red: 0.04, green: 0.04, blue: 0.05)
    static let panel = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let stroke = Color.white.opacity(0.28)
    static let muted = Color(red: 0.63, green: 0.63, blue: 0.67)
    static let danger = Color(red: 1, green: 0.45, blue: 0.4)

    static let phaseHints: [VoicePhase: String] = [
        .idle: "Talk to Lexi",
        .connecting: "Connecting…",
        .listening: "Listening…",
        .thinking: "Thinking…",
        .speaking: "Speaking…",
    ]
}

struct LexiFilledButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(.black)
            .background(.white, in: Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.35)
    }
}

struct LexiBorderedButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(.white)
            .background(Color.white.opacity(configuration.isPressed ? 0.16 : 0.08), in: Capsule())
            .overlay(Capsule().stroke(LexiTheme.stroke, lineWidth: 1))
    }
}

struct LexiPillButtonStyle: ButtonStyle {
    var emphasized = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(.white)
            .background(
                Color.white.opacity(emphasized || configuration.isPressed ? 0.16 : 0.06),
                in: Capsule()
            )
    }
}
