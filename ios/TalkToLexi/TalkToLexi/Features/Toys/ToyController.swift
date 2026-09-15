import Foundation

@MainActor
final class ToyController: ObservableObject {
    @Published private(set) var granted = false
    @Published private(set) var grantPending = false

    func grantFromUser() {
        granted = true
        grantPending = false
    }

    func revoke() {
        granted = false
        grantPending = false
    }

    func reset() {
        granted = false
        grantPending = false
    }

    func handleRequest(_ arguments: [String: Any], lastUserUtterance: String) -> [String: Any] {
        let requested = arguments["granted"] as? Bool ?? true
        if requested {
            if granted || Self.looksLikeGrant(lastUserUtterance) {
                granted = true
                grantPending = false
                return ["ok": true, "controlGranted": true, "source": "user"]
            }
            grantPending = true
            return [
                "ok": false,
                "controlGranted": false,
                "error": "Toy control stays denied until the user asks. Wait until they request it.",
            ]
        }
        if Self.looksLikeRevoke(lastUserUtterance) || !granted {
            granted = false
            grantPending = false
            return ["ok": true, "controlGranted": false, "source": "user"]
        }
        return [
            "ok": false,
            "controlGranted": true,
            "error": "Toy control stays granted until the user asks you to stop.",
        ]
    }

    func command(name: String, arguments: [String: Any], using api: LexiAPIClient) async -> [String: Any] {
        let action: String
        if name.hasSuffix("_stop") || arguments["action"] as? String == "stop" {
            action = "stop"
        } else if name.hasSuffix("_function") {
            action = "function"
        } else if name.hasSuffix("_pattern") {
            action = arguments["action"] as? String == "pulse" ? "pulse" : "pattern"
        } else if name.hasSuffix("_vibrate") {
            action = "vibrate"
        } else {
            action = (arguments["action"] as? String) ?? ""
        }
        if action != "stop" && !granted {
            return [
                "error": "Toy control is not granted. The user must request it first.",
                "controlGranted": false,
            ]
        }
        let provider: String
        if name.hasPrefix("lovense_") {
            provider = "lovense"
        } else if name.hasPrefix("joyhub_") {
            provider = "joyhub"
        } else {
            provider = (arguments["provider"] as? String) ?? "all"
        }
        var body: [String: Any] = [
            "provider": provider,
            "action": action,
            "controlGranted": granted,
        ]
        for key in ["strength", "intensity", "durationSec", "pattern", "functions", "rule", "toy", "loopRunningSec", "loopPauseSec", "stopPrevious", "position"] {
            if let value = arguments[key] {
                body[key] = value
            }
        }
        if body["pattern"] == nil, let nameArg = arguments["name"] {
            body["pattern"] = nameArg
        }
        if body["functions"] == nil, name == "lovense_function", let value = arguments["action"] {
            body["functions"] = value
        }
        do {
            let result = try await api.toyCommand(body)
            return result.merging(["moved": true]) { _, new in new }
        } catch {
            return ["error": error.localizedDescription, "moved": false]
        }
    }

    func noteUtterance(_ text: String) {
        if Self.looksLikeGrant(text) {
            granted = true
            grantPending = false
        } else if Self.looksLikeRevoke(text) {
            granted = false
            grantPending = false
        }
    }

    private static func looksLikeGrant(_ text: String) -> Bool {
        let line = text.lowercased()
        let phrases = [
            "take control",
            "you have control",
            "control the toy",
            "control the toys",
            "take over the toys",
            "give lexi toy control",
            "give you toy control",
            "lexi take control",
            "lexi, take control",
        ]
        return phrases.contains { line.contains($0) }
    }

    private static func looksLikeRevoke(_ text: String) -> Bool {
        let line = text.lowercased()
        let phrases = [
            "stop controlling",
            "no more toy control",
            "revoke",
            "hands off",
            "don't control the toys",
            "dont control the toys",
        ]
        return phrases.contains { line.contains($0) }
    }
}
