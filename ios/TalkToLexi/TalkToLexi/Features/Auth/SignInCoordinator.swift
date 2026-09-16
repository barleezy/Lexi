import AuthenticationServices
import UIKit

final class SignInCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let callbackScheme = "talktolexi"
    static let redirectURI = "talktolexi://auth"

    private var session: ASWebAuthenticationSession?

    func signIn(host: URL) async throws -> (token: String, userId: String) {
        let state = UUID().uuidString
        var components = URLComponents(url: host.appendingPathComponent("ios/signin"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "state", value: state),
        ]
        guard let url = components?.url else {
            throw NSError(domain: "LexiAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad sign-in URL."])
        }

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme) { callback, error in
                self.session = nil
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let callback else {
                    continuation.resume(throwing: NSError(domain: "LexiAuth", code: 2, userInfo: [NSLocalizedDescriptionKey: "Sign-in was cancelled."]))
                    return
                }
                let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
                let token = items.first(where: { $0.name == "token" })?.value ?? ""
                let userId = items.first(where: { $0.name == "userId" })?.value ?? ""
                let returnedState = items.first(where: { $0.name == "state" })?.value ?? ""
                if token.isEmpty || userId.isEmpty {
                    continuation.resume(throwing: NSError(domain: "LexiAuth", code: 3, userInfo: [NSLocalizedDescriptionKey: "Sign-in did not return a session."]))
                    return
                }
                if returnedState != state {
                    continuation.resume(throwing: NSError(domain: "LexiAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Sign-in state mismatch."]))
                    return
                }
                continuation.resume(returning: (token, userId))
            }
            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = self
            self.session = session
            DispatchQueue.main.async {
                if !session.start() {
                    continuation.resume(throwing: NSError(domain: "LexiAuth", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not present sign-in."]))
                }
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
