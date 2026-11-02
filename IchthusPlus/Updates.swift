import UIKit

/*
 Updates, zoals op Android: de nieuwste versie op GitHub opvragen en in de app het update-vakje laten zien.
 Installeren mag een iPhone-app zelf niet; "Nu bijwerken" opent SideStore met de downloadlink, en SideStore installeert hem.
 Zolang de iPhone-repo privé is, vindt hij niets (dan blijft het vakje gewoon weg).
 */
final class Updates: NSObject, URLSessionTaskDelegate {
    static let repo = "wesssaa/Ichthus-Plus-iPhone"
    static let asset = "IchthusPlus.ipa"
    private static let shared = Updates()
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

    /* de doorverwijzing van releases/latest niet volgen: daar staat de tag in */
    func urlSession(_ s: URLSession, task: URLSessionTask, willPerformHTTPRedirection r: HTTPURLResponse, newRequest: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    /* 1. welke versie is de nieuwste (geen limiet, anders dan de GitHub-API); 2. wat er nieuw is (mag mislukken) */
    static func fetch(done: @escaping (String?) -> Void) {
        Task {
            var req = URLRequest(url: URL(string: "https://github.com/\(repo)/releases/latest")!)
            req.timeoutInterval = 15
            guard let (_, resp) = try? await shared.session.data(for: req), let http = resp as? HTTPURLResponse,
                  let loc = http.value(forHTTPHeaderField: "Location"), let tag = loc.components(separatedBy: "/releases/tag/").last,
                  loc.contains("/releases/tag/"), !tag.isEmpty else { return done(nil) }
            var rel: [String: Any] = ["tag_name": tag, "body": "", "assets": [["name": asset, "size": 0,
                                       "browser_download_url": "https://github.com/\(repo)/releases/download/\(tag)/\(asset)"]]]
            let mine = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
            if tag.replacingOccurrences(of: "^v", with: "", options: .regularExpression) != mine {
                var a = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/tags/\(tag)")!)
                a.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                a.timeoutInterval = 15
                if let (d, r) = try? await URLSession.shared.data(for: a), (r as? HTTPURLResponse)?.statusCode == 200,
                   let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { rel = j }
            }
            done(rel.jsonString)
        }
    }

    /* tot wanneer deze installatie werkt (ms): SideStore zet een profiel met een vervaldatum in de app (gratis Apple ID: 7 dagen) */
    static func signExpiry() -> Double {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url) else { return 0 }
        let text = String(decoding: data, as: UTF8.self)
        guard let r = text.range(of: "<key>ExpirationDate</key>"),
              let s = text.range(of: "<date>", range: r.upperBound..<text.endIndex),
              let e = text.range(of: "</date>", range: s.upperBound..<text.endIndex) else { return 0 }
        let f = ISO8601DateFormatter()
        return (f.date(from: String(text[s.upperBound..<e.lowerBound]))?.timeIntervalSince1970 ?? 0) * 1000
    }

    /* SideStore openen met de nieuwe versie; geen SideStore op deze telefoon: de download in Safari */
    static func install(_ url: String, done: @escaping (String) -> Void) {
        guard let dl = URL(string: url), dl.scheme == "https",
              let enc = url.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
              let store = URL(string: "sidestore://install?url=\(enc)") else { return done("fail") }
        DispatchQueue.main.async {
            UIApplication.shared.open(store) { ok in
                if ok { return done("sidestore") }
                UIApplication.shared.open(dl) { ok2 in done(ok2 ? "browser" : "fail") }
            }
        }
    }
}
