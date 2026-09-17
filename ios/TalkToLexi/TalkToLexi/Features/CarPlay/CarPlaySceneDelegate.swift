import CarPlay
import Combine
import UIKit

@objc(CarPlaySceneDelegate)
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private let rootTemplate = CPListTemplate(title: "Talk to Lexi", sections: [])
    private var cancellables = Set<AnyCancellable>()

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        Task { @MainActor in
            self.bindToPhoneSession()
            self.reloadRoot()
            interfaceController.setRootTemplate(self.rootTemplate, animated: false)
        }
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController
    ) {
        cancellables.removeAll()
        self.interfaceController = nil
    }

    @MainActor
    private func bindToPhoneSession() {
        cancellables.removeAll()
        LexiAppController.shared.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.reloadRoot()
                }
            }
            .store(in: &cancellables)
    }

    @MainActor
    private func reloadRoot() {
        let app = LexiAppController.shared
        let item: CPListItem
        if !app.isSignedIn {
            item = CPListItem(
                text: "Sign in on iPhone",
                detailText: "Open Talk to Lexi on your iPhone to sign in."
            )
            item.handler = { [weak self] _, completion in
                Task { @MainActor in
                    self?.showSignInAlert()
                    completion()
                }
            }
        } else {
            let talking = app.isLive || app.isConnecting
            item = CPListItem(
                text: talking ? "End call" : "Talk to Lexi",
                detailText: Self.detail(for: app)
            )
            item.handler = { _, completion in
                Task { @MainActor in
                    LexiAppController.shared.toggleCall()
                    completion()
                }
            }
        }
        rootTemplate.updateSections([CPListSection(items: [item])])
    }

    @MainActor
    private static func detail(for app: LexiAppController) -> String {
        if !app.lastError.isEmpty { return app.lastError }
        if app.isConnecting { return "Connecting…" }
        if app.isLive { return app.phaseLabel }
        return "Start a hands-free call"
    }

    @MainActor
    private func showSignInAlert() {
        let alert = CPAlertTemplate(
            titleVariants: ["Sign in on iPhone to talk to Lexi."],
            actions: [
                CPAlertAction(title: "OK", style: .default, handler: { _ in }),
            ]
        )
        interfaceController?.presentTemplate(alert, animated: true, completion: nil)
    }
}
