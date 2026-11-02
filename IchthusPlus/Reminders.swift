import Foundation
import UserNotifications

/*
 Eigen reminders, zoals Reminders.java op Android. Android zet steeds één wekker voor de eerstvolgende;
 iOS mag de app daarvoor niet wakker maken, dus we plannen de komende keren alvast als melding in
 (iOS onthoudt er hooguit 64 per app). Bij elke keer openen schuiven we de lijst door en plannen opnieuw.
 Lijst: [{id, text, at (ms), rep: none|daily|days|weekly, n, fired}]
 */
/* één wachtrij voor alles wat meldingen inplant of de huiswerklijst bijwerkt */
enum NotifQueue {
    static let q = DispatchQueue(label: "nl.cijferpacks.app.notif")
}

enum Reminders {
    static let prefix = "own-"
    static let maxPending = 40 // + 20 huiswerkherinneringen = 60, onder iOS' maximum van 64

    static func list() -> [[String: Any]] {
        guard let d = Prefs.string("own_rem", "[]").data(using: .utf8),
              let a = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] else { return [] }
        return a
    }

    private static func save(_ a: [[String: Any]]) {
        let json = (try? JSONSerialization.data(withJSONObject: a)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        Prefs.set("own_rem", json)
    }

    static func setOwn(_ json: String) {
        guard let d = json.data(using: .utf8), (try? JSONSerialization.jsonObject(with: d)) is [Any] else { return }
        Prefs.set("own_rem", json)
        if !list().isEmpty { askPermission() }
        schedule()
    }

    /* wat al geweest is bijwerken (zoals fireOwn op Android, maar de melding zelf heeft iOS al laten zien) */
    static func advance() {
        let now = Date().timeIntervalSince1970 * 1000
        let today = Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000
        var keep: [[String: Any]] = []
        for var r in list() {
            let at = num(r["at"])
            // eenmalige die al geweest is: blijft nog 2 weken in het rooster staan (doorgestreept), daarna weg
            if r["fired"] as? Bool == true { if at >= today - 14 * 86400_000 { keep.append(r) }; continue }
            if at > now + 60_000 { keep.append(r); continue }
            let rep = r["rep"] as? String ?? "none"
            if rep == "none" { r["fired"] = true; keep.append(r); continue }
            var next = at
            while next <= now + 60_000 { next = step(next, r) }
            r["at"] = next
            keep.append(r)
        }
        save(keep)
    }

    /* volgende keer: een aantal dagen verder op dezelfde kloktijd (ook over zomer- en wintertijd heen) */
    private static func step(_ at: Double, _ r: [String: Any]) -> Double {
        let n = max(1, Int(num(r["n"], 1)))
        let rep = r["rep"] as? String ?? "daily"
        let days = rep == "weekly" ? 7 * n : rep == "days" ? n : 1
        let d = Date(timeIntervalSince1970: at / 1000)
        return (Calendar.current.date(byAdding: .day, value: days, to: d) ?? d.addingTimeInterval(Double(days) * 86400)).timeIntervalSince1970 * 1000
    }

    /*
     Alle komende keren inplannen, de eerstvolgende eerst. Elke dag of elke week wordt één herhalende melding;
     om de zoveel dagen/weken plannen we de komende keren los in. Samen met de huiswerkherinneringen blijft het
     onder iOS' maximum van 64. Alles via één wachtrij, zodat twee keer plannen elkaar niet in de weg zit.
     */
    static func schedule() {
        NotifQueue.q.async {
            let c = UNUserNotificationCenter.current()
            c.removePendingNotificationRequests(withIdentifiers: Prefs.d.stringArray(forKey: "own_ids") ?? [])
            let mode = Checker.mode("own")
            guard mode != "uit" else { return Prefs.set("own_ids", [String]()) }
            let now = Date().timeIntervalSince1970 * 1000
            var requests: [(at: Double, r: [String: Any], trigger: UNNotificationTrigger)] = []
            for r in list() where r["fired"] as? Bool != true {
                var at = num(r["at"])
                let rep = r["rep"] as? String ?? "none", n = max(1, Int(num(r["n"], 1)))
                let d = Date(timeIntervalSince1970: at / 1000)
                // een herhalende melding gaat meteen bij de eerstvolgende keer af; daarom pas gebruiken als de eerste keer
                // binnen één periode valt (anders zou "elke dag vanaf maandag" morgen al afgaan) en de keren daarvoor los
                if (rep == "daily" || (rep == "days" && n == 1)) && at - now <= 86400_000 {
                    requests.append((at, r, UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.hour, .minute], from: d), repeats: true)))
                    continue
                }
                if rep == "weekly" && n == 1 && at - now <= 7 * 86400_000 {
                    requests.append((at, r, UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.weekday, .hour, .minute], from: d), repeats: true)))
                    continue
                }
                var k = 0
                while k < maxPending && at < now + 120 * 86400_000 {
                    if at > now { requests.append((at, r, UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Date(timeIntervalSince1970: at / 1000)), repeats: false))) }
                    if rep == "none" { break }
                    at = step(at, r)
                    k += 1
                }
            }
            requests.sort { $0.at < $1.at }
            var ids: [String] = []
            for (i, x) in requests.prefix(maxPending).enumerated() {
                let content = UNMutableNotificationContent()
                content.title = "Reminder"
                content.body = x.r["text"] as? String ?? "Reminder"
                if mode == "stil" { content.interruptionLevel = .passive } else { content.sound = .default }
                content.userInfo = ["tab": "rooster"]
                let id = "\(prefix)\(x.r["id"] as? String ?? "x")-\(i)"
                ids.append(id)
                c.add(UNNotificationRequest(identifier: id, content: content, trigger: x.trigger))
            }
            Prefs.set("own_ids", ids)
        }
    }

    static func askPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    /* reminders horen bij het account: bij uitloggen apart gezet onder die leerling, en terug als die weer inlogt */
    static func ownerKey(_ name: String) -> String {
        // dezelfde hash als String.hashCode() in Java, zodat het net zo werkt als op Android
        var h: Int32 = 0
        for u in name.trimmingCharacters(in: .whitespaces).lowercased().utf16 { h = h &* 31 &+ Int32(u) }
        return "own_rem_" + String(UInt32(bitPattern: h), radix: 16)
    }

    /* andere leerling dan de vorige keer: diens eigen reminders laden. true = lijst veranderd */
    static func setOwner(_ name: String) -> Bool {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return false }
        let key = ownerKey(name), cur = Prefs.string("own_owner")
        if key == cur { return false }
        let mine = Prefs.string("own_rem", "[]")
        var listJSON: String
        if !cur.isEmpty {
            Prefs.set(cur, mine)
            listJSON = Prefs.string(key, "[]")
        } else {
            // nog niemand bekend (eerste keer, of net uitgelogd): wat er staat hoort bij deze leerling, plus wat er eerder voor hem bewaard is
            let saved = (Prefs.string(key, "[]").data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]] ?? []
            let all = list() + saved
            listJSON = (try? JSONSerialization.data(withJSONObject: all)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        }
        Prefs.set("own_rem", listJSON)
        Prefs.set("own_owner", key)
        Prefs.d.removeObject(forKey: key)
        schedule()
        return true
    }

    /* uitloggen: de reminders van deze leerling wegzetten (ze gaan niet af tot die weer inlogt) */
    static func logoutOwner() {
        let cur = Prefs.string("own_owner")
        if cur.isEmpty { return }
        Prefs.set(cur, Prefs.string("own_rem", "[]"))
        Prefs.d.removeObject(forKey: "own_rem")
        Prefs.d.removeObject(forKey: "own_owner")
        schedule()
    }

    private static func num(_ v: Any?, _ def: Double = 0) -> Double {
        (v as? NSNumber)?.doubleValue ?? Double(v as? String ?? "") ?? def
    }
}
