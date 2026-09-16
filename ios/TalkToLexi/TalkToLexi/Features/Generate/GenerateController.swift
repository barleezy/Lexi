import Foundation

@MainActor
final class GenerateController: ObservableObject {
    @Published var items: [GeneratedMediaItem] = []

    func generateImage(_ arguments: [String: Any], using api: LexiAPIClient) async -> [String: Any] {
        let prompt = (arguments["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !prompt.isEmpty else { return ["ok": false, "error": "Prompt is required."] }
        let id = UUID().uuidString
        upsert(GeneratedMediaItem(id: id, kind: "image", prompt: prompt, status: "pending"))
        do {
            let body = try await api.generateImage(
                prompt: prompt,
                aspectRatio: (arguments["aspect_ratio"] as? String) ?? (arguments["aspectRatio"] as? String),
                resolution: arguments["resolution"] as? String
            )
            let error = body["error"] as? String
            if let error {
                upsert(GeneratedMediaItem(id: id, kind: "image", prompt: prompt, status: "failed", error: error))
                return ["ok": false, "error": error, "configured": body["configured"] as Any]
            }
            let item = GeneratedMediaItem(
                id: id,
                kind: "image",
                prompt: prompt,
                status: "done",
                url: body["url"] as? String,
                dataUrl: body["dataUrl"] as? String
            )
            upsert(item)
            return ["ok": true, "kind": "image", "prompt": prompt, "url": item.url as Any, "dataUrl": item.dataUrl as Any]
        } catch {
            upsert(GeneratedMediaItem(id: id, kind: "image", prompt: prompt, status: "failed", error: error.localizedDescription))
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    func generateVideo(_ arguments: [String: Any], using api: LexiAPIClient) async -> [String: Any] {
        let prompt = (arguments["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !prompt.isEmpty else { return ["ok": false, "error": "Prompt is required."] }
        let id = UUID().uuidString
        upsert(GeneratedMediaItem(id: id, kind: "video", prompt: prompt, status: "pending"))
        do {
            let body = try await api.generateVideo(
                prompt: prompt,
                duration: arguments["duration"],
                aspectRatio: (arguments["aspect_ratio"] as? String) ?? (arguments["aspectRatio"] as? String),
                resolution: arguments["resolution"] as? String,
                silent: arguments["silent"] as? Bool
            )
            let requestId = body["requestId"] as? String
            let status = (body["status"] as? String) ?? ((body["url"] as? String)?.isEmpty == false ? "done" : "pending")
            if let error = body["error"] as? String, status == "failed" || body["ok"] as? Bool == false && status != "pending" {
                upsert(GeneratedMediaItem(id: requestId ?? id, kind: "video", prompt: prompt, status: "failed", requestId: requestId, error: error))
                return ["ok": false, "error": error]
            }
            var item = GeneratedMediaItem(
                id: requestId ?? id,
                kind: "video",
                prompt: prompt,
                status: status == "done" ? "done" : "pending",
                url: body["url"] as? String,
                requestId: requestId
            )
            upsert(item)
            if item.status != "done", let requestId {
                item = await poll(requestId: requestId, prompt: prompt, using: api)
            }
            return [
                "ok": item.status == "done",
                "kind": "video",
                "prompt": prompt,
                "status": item.status,
                "url": item.url as Any,
                "requestId": item.requestId as Any,
                "error": item.error as Any,
            ]
        } catch {
            upsert(GeneratedMediaItem(id: id, kind: "video", prompt: prompt, status: "failed", error: error.localizedDescription))
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    private func poll(requestId: String, prompt: String, using api: LexiAPIClient) async -> GeneratedMediaItem {
        for _ in 0..<20 {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            do {
                let body = try await api.pollGeneratedVideo(requestId: requestId)
                let status = (body["status"] as? String) ?? "pending"
                let item = GeneratedMediaItem(
                    id: requestId,
                    kind: "video",
                    prompt: prompt,
                    status: status,
                    url: body["url"] as? String,
                    requestId: requestId,
                    error: body["error"] as? String
                )
                upsert(item)
                if status != "pending" { return item }
            } catch {
                let item = GeneratedMediaItem(id: requestId, kind: "video", prompt: prompt, status: "failed", requestId: requestId, error: error.localizedDescription)
                upsert(item)
                return item
            }
        }
        let item = GeneratedMediaItem(id: requestId, kind: "video", prompt: prompt, status: "pending", requestId: requestId, error: "Still making the video.")
        upsert(item)
        return item
    }

    private func upsert(_ item: GeneratedMediaItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        } else {
            items.insert(item, at: 0)
            if items.count > 6 { items.removeLast(items.count - 6) }
        }
    }
}
