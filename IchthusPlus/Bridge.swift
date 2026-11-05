import UIKit
import WebKit

/*
 window.CijferApp voor app.js, net als de JavascriptInterface op Android. Android geeft meteen een antwoord terug
 (bijv. getZermelo()); WKWebView kan dat alleen via prompt(): de app vangt die op en geeft het antwoord als tekst terug.
 Alleen wat de iPhone-app echt kan staat erin: app.js kijkt zelf of een functie bestaat (geen batterij-instelling;
 updates installeert SideStore).
 */
final class Bridge {
    static let marker = "__cijferapp__"
    static let methods = ["vibrate", "open", "logout", "relogin", "setTheme", "getZermelo", "setZermelo", "zermeloSso",
                          "getAgenda", "appVersion", "getIcon", "setIcon", "getOwnReminders", "setOwnReminders", "setRemOwner",
                          "getSettings", "setSetting", "onMobile", "openNotifSettings", "testNotify", "devNotify",
                          "setHwRules", "setHwItems", "nextReminders", "setRoosterCache", "setWidgetLook", "fetchRelease", "installUpdate", "signExpiry", "devCrash"]

    static let shimJS = """
    (function () {
      if (location.hostname !== '\(WebViewController.portalHost)') return;
      var call = function (m, a) {
        var r = window.prompt('\(marker)', JSON.stringify({ m: m, a: a }));
        if (r == null || r === '') return undefined;
        try { return JSON.parse(r); } catch (e) { return undefined; }
      };
      var o = {};
      \(try! String(data: JSONSerialization.data(withJSONObject: methods), encoding: .utf8)!).forEach(function (m) {
        o[m] = function () { return call(m, Array.prototype.slice.call(arguments)); };
      });
      window.CijferApp = o;
    })();
    """

    weak var c: WebViewController?
    init(controller: WebViewController) { c = controller }

    /* één aanroep uit app.js: {"m": naam, "a": [argumenten]} → antwoord als JSON (leeg = geen antwoord) */
    func handle(_ json: String) -> String {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let m = o["m"] as? String else { return "" }
        let a = o["a"] as? [Any] ?? []
        let s = { (i: Int) -> String in i < a.count ? (a[i] as? String ?? (a[i] as? NSNumber)?.stringValue ?? "") : "" }
        let b = { (i: Int) -> Bool in i < a.count ? (a[i] as? Bool ?? false) : false }
        switch m {
        case "vibrate":
            let ms = Double(s(0)) ?? 10
            DispatchQueue.main.async { UIImpactFeedbackGenerator(style: ms > 30 ? .medium : .light).impactOccurred() }
        case "open":
            if let u = URL(string: s(0)), ["http", "https", "mailto", "tel", "shortcuts"].contains(u.scheme?.lowercased() ?? "") {
                DispatchQueue.main.async { UIApplication.shared.open(u) }
            }
        case "logout":
            DispatchQueue.main.async { self.logout() }
        case "relogin":
            DispatchQueue.main.async { self.c?.loadStart() }
        case "setTheme":
            let mode = s(0) == "dark" ? "dark" : "light"
            Prefs.theme = mode
            DispatchQueue.main.async { self.c?.applyTheme(mode) }
        case "getZermelo":
            return encode(["school": Prefs.string("zm_school"), "token": Prefs.string("zm_token"), "sso": Prefs.d.bool(forKey: "zm_sso")]
                .jsonString)
        case "setZermelo":
            Prefs.set("zm_school", s(0))
            Prefs.set("zm_token", s(1))
            Prefs.set("zm_sso", false)
            Prefs.d.removeObject(forKey: "zm_snap")
        case "zermeloSso":
            let url = s(0), silent = b(1)
            guard url.hasPrefix("https://"), let u = URL(string: url) else { break }
            DispatchQueue.main.async { if let c = self.c { ZermeloLogin.start(c, url: u, silent: silent) } }
        case "getAgenda":
            Agenda.refresh { changed in if changed { self.c?.js("window.__cpAgenda && window.__cpAgenda()") } }
            return encode(Prefs.string("agenda", "[]"))
        case "appVersion":
            return encode(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
        case "getIcon":
            return encode(Icons.current())
        case "setIcon":
            let name = s(0)
            DispatchQueue.main.async { Icons.set(name) }
        case "getOwnReminders":
            Reminders.advance()
            return encode(Prefs.string("own_rem", "[]"))
        case "setOwnReminders":
            Reminders.setOwn(s(0))
        case "setRemOwner":
            return encode(Reminders.setOwner(s(0)))
        case "getSettings":
            return encode(Checker.settingsJSON())
        case "setSetting":
            Checker.set(s(0), s(1))
        case "onMobile":
            return encode(Checker.onMobile)
        case "openNotifSettings":
            let s: String
            if #available(iOS 16, *) { s = UIApplication.openNotificationSettingsURLString } else { s = UIApplication.openSettingsURLString }
            let u = URL(string: s)!
            DispatchQueue.main.async { UIApplication.shared.open(u) }
        case "testNotify":
            Reminders.askPermission()
            Checker.testNotify("grades")
        case "devNotify":
            let type = s(0).filter { $0.isLetter }, delay = max(0, Double(s(1)) ?? 0)
            Reminders.askPermission()
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { Checker.testNotify(type.isEmpty ? "grades" : type) }
        case "setHwRules":
            HomeworkReminders.setRules(s(0))
        case "setHwItems":
            if let d = s(0).data(using: .utf8), let a = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] { HomeworkReminders.mergeItems(a) }
        case "nextReminders":
            return encode(HomeworkReminders.next())
        case "fetchRelease":
            Updates.fetch { json in
                let arg = json.flatMap { j in (try? JSONSerialization.data(withJSONObject: j, options: .fragmentsAllowed)).flatMap { String(data: $0, encoding: .utf8) } } ?? "null"
                self.c?.js("window.__cpRel && window.__cpRel(\(arg))")
            }
        case "devCrash":
            CrashLog.test()
        case "signExpiry":
            return encode(Updates.signExpiry())
        case "installUpdate":
            Updates.install(s(0)) { st in self.c?.js("window.__cpUpd && window.__cpUpd('\(st)', 0)") }
        case "setRoosterCache":
            if let d = s(0).data(using: .utf8), let a = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] { WidgetData.saveLessons(a, accent: s(1)) }
        case "setWidgetLook":
            // widget: achtergrond zwart of wit, en de accentkleur van de app
            WidgetData.setLook(theme: s(0), accent: s(1), alpha: Int(s(2)) ?? -1)
        default:
            break
        }
        return ""
    }

    private func encode(_ v: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: v, options: .fragmentsAllowed)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }

    /* alles van deze leerling weg: Zermelo-koppeling en de inlog (cookies). Thema en icoon blijven staan. */
    private func logout() {
        Prefs.clearAccount()
        Reminders.logoutOwner()
        HomeworkReminders.schedule() // het huiswerk van deze leerling is weg, dus ook de herinneringen ervan
        WidgetData.clear()
        let store = WKWebsiteDataStore.default()
        store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
            let zermelo = records.filter { $0.displayName.contains("zportal.nl") }
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: zermelo) {
                store.removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantPast) {
                    self.c?.loadStart()
                }
            }
        }
    }
}

extension Dictionary where Key == String {
    var jsonString: String {
        (try? JSONSerialization.data(withJSONObject: self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}

/* app-icoon wisselen (iOS laat daarbij zelf even een melding zien) */
enum Icons {
    // naam in app.js → alternatief icoon in de app (nil = het standaard-icoon, zwart zonder tekst)
    static let map: [String: String?] = ["zwartkaal": nil, "kaal": "AppIcon-Kaal", "zwart": "AppIcon-Zwart", "default": "AppIcon-Wit"]

    static func current() -> String {
        let alt = UIApplication.shared.alternateIconName
        return map.first { $0.value == alt }?.key ?? "zwartkaal"
    }

    static func set(_ name: String) {
        guard UIApplication.shared.supportsAlternateIcons, let alt = map[name.lowercased()] else { return }
        if UIApplication.shared.alternateIconName == alt { return }
        UIApplication.shared.setAlternateIconName(alt, completionHandler: nil)
    }
}
