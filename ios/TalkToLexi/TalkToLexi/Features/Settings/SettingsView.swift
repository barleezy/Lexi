import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var app: LexiAppController
    @Environment(\.dismiss) private var dismiss

    static let partyChatHelp = "Lexi's voice and party members share one chat channel. Mute Lexi or turn this off during calls so she does not talk over the party. PlayStation has no virtual audio cable — this only rides party chat through the controller."

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    billingCard
                    partyChatCard
                }
                .padding(16)
            }
            .background(LexiTheme.page.ignoresSafeArea())
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .task {
                await app.refreshBilling()
            }
        }
        .preferredColorScheme(.dark)
    }

    private var billingCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Account")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(LexiTheme.muted)
            if app.isSignedIn {
                Text("Signed in as \(app.account.userId)")
                    .font(.system(size: 16, weight: .semibold))
                Text("\(app.voiceSeconds / 60) min left")
                    .font(.system(size: 22, weight: .semibold))
                Text(app.subscribed ? "Lexi Pro is active." : "No subscription.")
                    .font(.system(size: 13))
                    .foregroundStyle(LexiTheme.muted)
            } else {
                Text("Sign in to buy minutes or subscribe.")
                    .font(.system(size: 16, weight: .semibold))
                Button("Sign in") { app.toggleSignIn() }
                    .buttonStyle(LexiFilledButtonStyle())
            }

            if !app.billingMessage.isEmpty {
                Text(app.billingMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(LexiTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button("Buy minutes") { app.openBuyMinutes() }
                .buttonStyle(LexiFilledButtonStyle())
            Button("Subscribe") { app.openSubscribe() }
                .buttonStyle(LexiBorderedButtonStyle())
            Button("Manage account") { app.openManageAccount() }
                .buttonStyle(LexiBorderedButtonStyle())
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LexiTheme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(LexiTheme.stroke, lineWidth: 1)
        )
    }

    private var partyChatCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle("Route through PS5 party chat.", isOn: Binding(
                get: { app.routeThroughPS5PartyChat },
                set: { app.setRouteThroughPS5PartyChat($0) }
            ))
            .font(.system(size: 16, weight: .medium))
            .tint(.white)
            VStack(alignment: .leading, spacing: 4) {
                Text("PSN account")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(LexiTheme.muted)
                Text(app.psnOnlineId)
                    .font(.system(size: 16, weight: .semibold))
                Text("Login \(app.psnLoginName). Sony session is this backup account (Online ID Barleezybaby), not the primary PSN.")
                    .font(.system(size: 13))
                    .foregroundStyle(LexiTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !app.ps5ChatPortStatus.isEmpty {
                Text(app.ps5ChatPortStatus)
                    .font(.system(size: 13))
                    .foregroundStyle(LexiTheme.muted)
            }
            Text(Self.partyChatHelp)
                .font(.system(size: 13))
                .foregroundStyle(LexiTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LexiTheme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(LexiTheme.stroke, lineWidth: 1)
        )
    }

}
