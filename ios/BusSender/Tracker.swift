import Foundation
import CoreLocation
import UIKit

/// Holt den Standort (auch im Hintergrund) und schreibt ihn etwa jede Minute
/// nach pos.json im Branch "live" des Repos toskana-2026. Die Schülerseite liest ihn dort.
final class Tracker: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let owner = "F1NN303"
    static let repo = "toskana-2026"
    static let branch = "live"
    static let path = "pos.json"
    static let interval: TimeInterval = 55

    private let api = URL(string: "https://api.github.com/repos/\(Tracker.owner)/\(Tracker.repo)/contents/\(Tracker.path)")!
    private let defaults = UserDefaults.standard

    @Published private(set) var token: String
    @Published private(set) var running = false
    @Published private(set) var authText = ""
    @Published private(set) var lastFix: Date?
    @Published private(set) var accuracy: Double = 0
    @Published private(set) var lastSent: Date?
    @Published private(set) var sentCount = 0
    @Published private(set) var lastError: String?
    @Published private(set) var messageStatus: String?
    @Published private(set) var sentMessage: String

    private let manager = CLLocationManager()
    private var sha: String?
    private var last: CLLocation?
    private var history: [CLLocation] = []
    private var busy = false
    private var msgAt: Date?

    override init() {
        token = UserDefaults.standard.string(forKey: "token") ?? ""
        sentMessage = UserDefaults.standard.string(forKey: "msg") ?? ""
        msgAt = UserDefaults.standard.object(forKey: "msgAt") as? Date
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        updateAuthText()
        // Lief das Tracking, bevor iOS die App beendet hat, direkt weitermachen
        if defaults.bool(forKey: "running") && hasToken {
            start()
        }
    }

    var hasToken: Bool { !token.isEmpty }

    // MARK: Steuerung

    func saveToken(_ value: String) {
        token = value.trimmingCharacters(in: .whitespacesAndNewlines)
        defaults.set(token, forKey: "token")
        sha = nil
        lastError = nil
    }

    func start() {
        guard hasToken else {
            lastError = "Zuerst den Schlüssel eintragen."
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        default: break
        }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        running = true
        defaults.set(true, forKey: "running")
        lastError = nil
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        running = false
        defaults.set(false, forKey: "running")
    }

    func sendMessage(_ text: String) {
        let clean = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(160))
        sentMessage = clean
        msgAt = Date()
        defaults.set(clean, forKey: "msg")
        defaults.set(msgAt, forKey: "msgAt")
        messageStatus = "Wird gesendet …"
        upload { [weak self] ok in
            self?.messageStatus = ok
                ? (clean.isEmpty ? "Nachricht gelöscht." : "Gesendet um \(Tracker.clock.string(from: Date())).")
                : "Senden fehlgeschlagen. Bitte nochmal tippen."
        }
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        updateAuthText()
        if manager.authorizationStatus == .authorizedWhenInUse && running {
            manager.requestAlwaysAuthorization()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last, loc.horizontalAccuracy >= 0, loc.horizontalAccuracy < 200 else { return }
        last = loc
        history.append(loc)
        history.removeAll { loc.timestamp.timeIntervalSince($0.timestamp) > 15 * 60 }
        lastFix = loc.timestamp
        accuracy = loc.horizontalAccuracy
        if let sent = lastSent, Date().timeIntervalSince(sent) < Tracker.interval { return }
        upload()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let e = error as? CLError, e.code == .locationUnknown { return }
        lastError = "GPS: \(error.localizedDescription)"
    }

    // MARK: Senden

    static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    private func updateAuthText() {
        switch manager.authorizationStatus {
        case .authorizedAlways: authText = "Immer erlaubt"
        case .authorizedWhenInUse: authText = "Beim Verwenden (bitte auf „Immer“ stellen)"
        case .denied: authText = "Verweigert, bitte in den Einstellungen erlauben"
        case .restricted: authText = "Eingeschränkt"
        case .notDetermined: authText = "Noch nicht gefragt"
        @unknown default: authText = "Unbekannt"
        }
    }

    /// Steht der Bus? Weniger als 300 m in den letzten 5 Minuten.
    private func isStopped() -> Bool {
        guard let l = last,
              let old = history.last(where: { l.timestamp.timeIntervalSince($0.timestamp) >= 5 * 60 }) else { return false }
        return l.distance(from: old) < 300
    }

    /// Seit wann steht der Bus? Bleibt gesetzt, bis er wieder fährt.
    private var stopSince: Date?

    private func updateStop() {
        guard let l = last, isStopped() else {
            stopSince = nil
            return
        }
        if stopSince != nil { return }
        var since = l.timestamp
        for h in history.reversed() {
            if l.distance(from: h) < 300 { since = h.timestamp } else { break }
        }
        stopSince = since
    }

    private func payload() -> [String: Any] {
        var p: [String: Any] = ["msg": sentMessage, "t": 0]
        p["msgAt"] = msgAt.map { Int($0.timeIntervalSince1970 * 1000) } ?? NSNull()
        if let l = last {
            updateStop()
            p["lat"] = (l.coordinate.latitude * 100_000).rounded() / 100_000
            p["lon"] = (l.coordinate.longitude * 100_000).rounded() / 100_000
            p["t"] = Int(l.timestamp.timeIntervalSince1970 * 1000)
            p["acc"] = Int(l.horizontalAccuracy)
            p["stopped"] = stopSince != nil
            p["stoppedSince"] = stopSince.map { Int($0.timeIntervalSince1970 * 1000) } ?? NSNull()
            p["speed"] = l.speed >= 0 ? Int((l.speed * 3.6).rounded()) : NSNull()
        }
        return p
    }

    private func upload(done: ((Bool) -> Void)? = nil) {
        guard hasToken else { done?(false); return }
        if busy {
            // Ein Upload läuft gerade; Nachrichten kurz danach nochmal versuchen
            if let done {
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.upload(done: done) }
            }
            return
        }
        busy = true
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        let body = payload()
        put(body, retry: true) { [weak self] ok, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.busy = false
                if ok {
                    self.lastSent = Date()
                    self.sentCount += 1
                    self.lastError = nil
                } else {
                    self.lastError = error
                }
                done?(ok)
                if task != .invalid {
                    UIApplication.shared.endBackgroundTask(task)
                    task = .invalid
                }
            }
        }
    }

    private func request(_ method: String, url: URL, body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        if let body {
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    private func describe(_ code: Int, _ error: Error?) -> String {
        if error != nil { return "Keine Internetverbindung" }
        switch code {
        case 401: return "Schlüssel ungültig oder abgelaufen"
        case 403, 404: return "Schlüssel hat keinen Zugriff auf toskana-2026 (Fehler \(code))"
        default: return "Fehler \(code)"
        }
    }

    private func fetchSha(_ completion: @escaping (String?, String?) -> Void) {
        var c = URLComponents(url: api, resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "ref", value: Tracker.branch)]
        URLSession.shared.dataTask(with: request("GET", url: c.url!)) { data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sha = json["sha"] as? String else {
                completion(nil, self.describe(code, error))
                return
            }
            completion(sha, nil)
        }.resume()
    }

    private func put(_ object: [String: Any], retry: Bool, completion: @escaping (Bool, String?) -> Void) {
        let send: (String) -> Void = { sha in
            guard let content = try? JSONSerialization.data(withJSONObject: object),
                  let body = try? JSONSerialization.data(withJSONObject: [
                      "message": "pos",
                      "branch": Tracker.branch,
                      "content": content.base64EncodedString(),
                      "sha": sha,
                  ]) else {
                completion(false, "Daten konnten nicht verpackt werden")
                return
            }
            URLSession.shared.dataTask(with: self.request("PUT", url: self.api, body: body)) { data, response, error in
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if code == 200 || code == 201 {
                    var newSha: String?
                    if let data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let content = json["content"] as? [String: Any] {
                        newSha = content["sha"] as? String
                    }
                    DispatchQueue.main.async { self.sha = newSha }
                    completion(true, nil)
                } else if (code == 409 || code == 422) && retry {
                    // Jemand anderes (z. B. die Sender-Webseite) hat zwischendurch gespeichert
                    DispatchQueue.main.async {
                        self.sha = nil
                        self.put(object, retry: false, completion: completion)
                    }
                } else {
                    completion(false, self.describe(code, error))
                }
            }.resume()
        }
        if let sha {
            send(sha)
        } else {
            fetchSha { sha, error in
                guard let sha else { completion(false, error); return }
                DispatchQueue.main.async {
                    self.sha = sha
                    send(sha)
                }
            }
        }
    }
}
