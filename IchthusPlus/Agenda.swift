import Foundation

/* jaaragenda van school (vrije dagen): de openbare Google-agenda, hooguit eens per 12 uur, als JSON [{s, e, t}] in ms */
enum Agenda {
    static let ics = URL(string: "https://calendar.google.com/calendar/ical/ob7hr8d0ttha3uduhk6rsa11u2k347q0%40import.calendar.google.com/public/basic.ics")!
    private static var busy = false

    static func refresh(force: Bool = false, done: @escaping (Bool) -> Void) {
        let last = Prefs.d.double(forKey: "agenda_t")
        if busy || (!force && Date().timeIntervalSince1970 - last < 12 * 3600) { return done(false) }
        busy = true
        var req = URLRequest(url: ics)
        req.timeoutInterval = 30
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            defer { busy = false }
            guard (resp as? HTTPURLResponse)?.statusCode == 200, let data = data, var text = String(data: data, encoding: .utf8) else { return done(false) }
            text = text.replacingOccurrences(of: "\r\n ", with: "").replacingOccurrences(of: "\n ", with: "")
            let now = Date().timeIntervalSince1970 * 1000
            let from = now - 60 * 86400_000, until = now + 400 * 86400_000
            var out: [[String: Any]] = []
            for ev in matches(text, "(?s)BEGIN:VEVENT(.*?)END:VEVENT") {
                let s = time(ev, "DTSTART")
                guard s > 0 else { continue }
                var e = time(ev, "DTEND")
                if e <= s { e = s + 3600_000 }
                if e < from || s > until { continue }
                guard var t = matches(ev, "(?m)^SUMMARY[^:]*:(.*)$").first else { continue }
                t = t.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\\,", with: ",").replacingOccurrences(of: "\\;", with: ";")
                    .replacingOccurrences(of: "\\n", with: " ").replacingOccurrences(of: "\\\\", with: "\\")
                out.append(["s": s, "e": e, "t": t])
            }
            let json = (try? JSONSerialization.data(withJSONObject: out)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            let changed = json != Prefs.string("agenda", "[]")
            Prefs.set("agenda", json)
            Prefs.set("agenda_t", Date().timeIntervalSince1970)
            done(changed)
        }.resume()
    }

    /* eerste groep van elke match */
    private static func matches(_ s: String, _ pattern: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = s as NSString
        return re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range(at: 1)) }
    }

    /* DTSTART/DTEND: 20261018T220000Z (UTC), 20261018T220000 (lokaal) of ;VALUE=DATE:20261018 (hele dag) */
    private static func time(_ ev: String, _ field: String) -> Double {
        guard let re = try? NSRegularExpression(pattern: "(?m)^" + field + "([^:]*):(\\d{8})(?:T(\\d{6})(Z?))?") else { return 0 }
        let ns = ev as NSString
        guard let m = re.firstMatch(in: ev, range: NSRange(location: 0, length: ns.length)) else { return 0 }
        let g = { (i: Int) -> String? in m.range(at: i).location == NSNotFound ? nil : ns.substring(with: m.range(at: i)) }
        guard let d = g(2) else { return 0 }
        let tm = g(3)
        var cal = Calendar(identifier: .gregorian)
        if g(4) == "Z" { cal.timeZone = TimeZone(identifier: "UTC")! }
        let n = { (str: String, a: Int, l: Int) -> Int in Int(str.dropFirst(a).prefix(l)) ?? 0 }
        var c = DateComponents()
        c.year = n(d, 0, 4); c.month = n(d, 4, 2); c.day = n(d, 6, 2)
        c.hour = tm.map { n($0, 0, 2) } ?? 0; c.minute = tm.map { n($0, 2, 2) } ?? 0; c.second = tm.map { n($0, 4, 2) } ?? 0
        return (cal.date(from: c)?.timeIntervalSince1970 ?? 0) * 1000
    }
}
