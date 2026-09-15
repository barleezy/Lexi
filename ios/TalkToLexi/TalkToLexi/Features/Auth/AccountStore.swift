import Foundation

final class AccountStore {
    static let shared = AccountStore()

    private enum Key {
        static let token = "lexi.ios.token"
        static let userId = "lexi.ios.userId"
        static let host = "lexi.ios.host"
    }

    private let defaults = UserDefaults.standard

    var apiHost: URL {
        if let override = defaults.string(forKey: Key.host)?.trimmingCharacters(in: .whitespacesAndNewlines),
           let url = URL(string: override),
           url.scheme == "https" || url.scheme == "http" {
            return url
        }
        if let bundled = Bundle.main.object(forInfoDictionaryKey: "LEXIAPIHost") as? String,
           let url = URL(string: bundled) {
            return url
        }
        return URL(string: "https://talktolexi.app")!
    }

    var userId: String {
        get { defaults.string(forKey: Key.userId) ?? "" }
        set { defaults.set(newValue, forKey: Key.userId) }
    }

    var token: String {
        get { defaults.string(forKey: Key.token) ?? "" }
        set { defaults.set(newValue, forKey: Key.token) }
    }

    var isSignedIn: Bool {
        !token.isEmpty && !userId.isEmpty
    }

    func apply(token: String, userId: String) {
        self.token = token
        self.userId = userId
    }

    func signOut() {
        token = ""
        userId = ""
    }

    func setHost(_ raw: String) {
        defaults.set(raw, forKey: Key.host)
    }
}
