import Foundation
import UserNotifications

/*
 Huiswerkherinneringen, zoals het eerste deel van Reminders.java. Regels (uit de app): een standaardregel, per vak en per item.
 Een regel: m = off | once | daily | every, d = aantal dagen, t = "HH:MM".
  once: één keer, d dagen voor de inleverdatum; daily: elke dag vanaf d dagen ervoor; every: om de d dagen tot de inleverdatum.
 Op iOS staan de komende herinneringen alvast als melding ingepland (iOS mag de app er niet voor wekken).
 */
enum HomeworkReminders {
    static let prefix = "hw-"
    static let maxPending = 20 // de rest van iOS' 64 is voor eigen reminders

    struct Due { let at: Double; let id: String; let vak: String; let ond: String; let toets: Bool; let date: Double }

    private static func items() -> [String: [String: Any]] {
        (Prefs.string("hw_items", "{}").data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: [String: Any]] ?? [:]
    }

    /* huiswerk bewaren (van de achtergrondcontrole of de app); oude items vallen weg */
    static func mergeItems(_ list: [[String: Any]]) {
        // via de wachtrij: de app en de achtergrondcontrole kunnen tegelijk huiswerk toevoegen
        NotifQueue.q.sync {
            var all = items()
            for it in list { if let id = it["id"] as? String, num(it["date"]) > 0 { all[id] = it } }
            let cutoff = Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000 - 86400_000
            all = all.filter { num($0.value["date"]) >= cutoff }
            Prefs.set("hw_items", all.jsonString)
        }
        schedule()
    }

    static func setRules(_ json: String) {
        Prefs.set("hw_rules", json)
        schedule()
    }

    /* alle herinneringstijden na 'from' (ms), gesorteerd */
    static func compute(from: Double) -> [Due] {
        let rules = (Prefs.string("hw_rules", "{\"def\":{\"m\":\"once\",\"d\":1,\"t\":\"18:00\"}}").data(using: .utf8))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
        let done = Set(rules["done"] as? [String] ?? [])
        var out: [Due] = []
        for (id, it) in items() where !done.contains(id) && it["gemaakt"] as? Bool != true {
            let vak = it["vak"] as? String ?? ""
            let r = ((rules["item"] as? [String: Any])?[id] ?? (rules["vak"] as? [String: Any])?[vak.lowercased()] ?? rules["def"]) as? [String: Any]
            guard let rule = r else { continue }
            let m = rule["m"] as? String ?? "off"
            let d = max(1, Int(num(rule["d"], 1)))
            let hm = (rule["t"] as? String ?? "18:00").split(separator: ":").compactMap { Int($0) }
            let due = num(it["date"])
            var before: [Int] = []
            if m == "once" { before = [d] } else if m == "daily" { before = Array((1...d).reversed()) } else if m == "every" { before = Array(stride(from: d, through: 21, by: d)) }
            for k in before {
                let day = Calendar.current.date(byAdding: .day, value: -k, to: Date(timeIntervalSince1970: due / 1000))!
                guard let at = Calendar.current.date(bySettingHour: hm.first ?? 18, minute: hm.count > 1 ? hm[1] : 0, second: 0, of: day) else { continue }
                let ms = at.timeIntervalSince1970 * 1000
                if ms <= from { continue }
                out.append(Due(at: ms, id: id, vak: vak, ond: it["ond"] as? String ?? "", toets: it["toets"] as? Bool ?? false, date: due))
            }
        }
        return out.sorted { $0.at < $1.at }
    }

    /* de komende herinneringen inplannen; die op hetzelfde moment worden één melding (zoals op Android) */
    static func schedule() {
        NotifQueue.q.async {
            let c = UNUserNotificationCenter.current()
            // precies de meldingen weghalen die we zelf de vorige keer hebben ingepland
            c.removePendingNotificationRequests(withIdentifiers: Prefs.d.stringArray(forKey: "hw_ids") ?? [])
            guard Checker.on("remind") else { return Prefs.set("hw_ids", [String]()) }
            var ids: [String] = []
            let groups = Dictionary(grouping: compute(from: Date().timeIntervalSince1970 * 1000), by: \.at).sorted { $0.key < $1.key }
            for (at, due) in groups.prefix(maxPending) {
                let content = UNMutableNotificationContent()
                if due.count == 1, let d = due.first {
                    content.title = (d.toets ? "Toets " : "Huiswerk ") + when(d.date, at: at) + ": " + d.vak.uppercased()
                    content.body = d.ond.isEmpty ? "Vergeet het niet." : d.ond
                } else {
                    content.title = "\(due.count) huiswerkherinneringen"
                    content.body = Checker.join(due.map { "\($0.vak.uppercased()) (\(when($0.date, at: at)))" })
                }
                content.userInfo = ["tab": "huiswerk"]
                if Checker.mode("remind") == "stil" { content.interruptionLevel = .passive } else { content.sound = .default }
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: Date(timeIntervalSince1970: at / 1000))
                ids.append("\(prefix)\(Int(at))")
                c.add(UNNotificationRequest(identifier: "\(prefix)\(Int(at))", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
            Prefs.set("hw_ids", ids)
        }
    }

    /* "morgen", "over 3 dagen" – gezien vanaf het moment van de melding */
    static func when(_ date: Double, at: Double) -> String {
        let from = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: at / 1000))
        let days = Int(((date / 1000 - from.timeIntervalSince1970) / 86400).rounded())
        return days <= 0 ? "vandaag" : days == 1 ? "morgen" : "over \(days) dagen"
    }

    /* voor het rooster in de app: de eerstvolgende vijf */
    static func next() -> String {
        compute(from: Date().timeIntervalSince1970 * 1000).prefix(5).map { ["at": $0.at, "vak": $0.vak, "ond": $0.ond] as [String: Any] }.jsonArrayString
    }

    private static func num(_ v: Any?, _ def: Double = 0) -> Double {
        (v as? NSNumber)?.doubleValue ?? Double(v as? String ?? "") ?? def
    }
}

extension Array where Element == [String: Any] {
    var jsonArrayString: String {
        (try? JSONSerialization.data(withJSONObject: self)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    }
}
