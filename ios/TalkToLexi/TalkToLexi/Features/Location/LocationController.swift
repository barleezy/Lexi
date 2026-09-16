import CoreLocation
import Foundation

@MainActor
final class LocationController: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var isSharing = false
    @Published var hint: String?
    @Published private(set) var lastFix: CLLocation?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func toggle() {
        if isSharing {
            stop()
        } else {
            start()
        }
    }

    func start(silent: Bool = false) {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            if !silent {
                hint = "Location is off in Settings."
            }
            isSharing = false
        case .notDetermined:
            isSharing = true
            hint = silent ? nil : "Allow location so Lexi knows where you are."
            manager.requestWhenInUseAuthorization()
        default:
            isSharing = true
            hint = nil
            manager.requestLocation()
        }
    }

    func stop() {
        isSharing = false
        hint = nil
        manager.stopUpdatingLocation()
    }

    func payload() -> [String: Any]? {
        guard isSharing else { return ["granted": false] }
        guard let lastFix else { return ["granted": false] }
        return [
            "granted": true,
            "latitude": lastFix.coordinate.latitude,
            "longitude": lastFix.coordinate.longitude,
            "accuracyM": lastFix.horizontalAccuracy,
        ]
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
                if self.isSharing {
                    self.hint = nil
                    manager.requestLocation()
                }
            } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                self.isSharing = false
                self.hint = "Location is off in Settings."
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fix = locations.last
        Task { @MainActor in
            self.lastFix = fix
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
