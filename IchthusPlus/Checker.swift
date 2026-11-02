import Foundation
import UserNotifications
import Network

/*
 Controles op het portaal (cijfers, huiswerk, rooster) en de meldingen daarvan, zoals GradeChecker.java.
 Elke controle onthoudt wat hij de vorige keer zag; de eerste keer meldt hij niets.
 iOS bepaalt zelf hoe vaak de app op de achtergrond mag kijken (zie Background.swift).
 */
enum Checker {
    static let pCijfers = "/portaal/mijn_info/cijfers_en_examendossier"
    static let pHuiswerk = "/Portaal/Mijn_info/Huiswerk"
    static let pRooster = "/Portaal/Roosters_en_toetsen/Lesrooster"

    // MARK: - instellingen

    /* per soort ("grades", "hw", "rooster", "remind", "own"): geluid, trillen, stil of uit */
    static func mode(_ type: String) -> String { Prefs.string("n_\(type)_mode", "geluid") }
    static func on(_ type: String) -> Bool { mode(type) != "uit" }

    static func settingsJSON() -> String {
        var o: [String: Any] = [:]
        for t in ["grades", "hw", "rooster", "remind", "own"] { o["n_\(t)_mode"] = mode(t) }
        o["exact"] = true
        o["n_showgrade"] = Prefs.d.bool(forKey: "n_showgrade")
        for t in ["r", "c", "h"] { o["n_mob_\(t)_mode"] = mobileMode(t) }
        o["n_wifi_mode"] = Prefs.string("n_wifi_mode", "30")
        o["allowed"] = Prefs.d.object(forKey: "notif_allowed") as? Bool ?? true
        return o.jsonString
    }

    static func set(_ key: String, _ value: String) {
        if key.hasSuffix("_mode") { Prefs.set(key, value) } else { Prefs.set(key, value == "true") }
        if key.hasPrefix("n_remind") { HomeworkReminders.schedule() }
        if key.hasPrefix("n_own") { Reminders.schedule() }
        Reminders.askPermission()
    }

    /* stand per onderdeel op 4G/5G: standaard rooster en cijfers elke 2,5 uur, huiswerk alleen op wifi */
    static func mobileMode(_ t: String) -> String { Prefs.string("n_mob_\(t)_mode", t == "h" ? "off" : "150") }

    // MARK: - netwerk

    static let monitor: NWPathMonitor = { let m = NWPathMonitor(); m.start(queue: .global(qos: .utility)); return m }()
    static var onMobile: Bool { monitor.currentPath.isExpensive }

    /* wat deze keer op de achtergrond mag (nil = overslaan). 's Nachts (23-6 uur) niets. Zoals GradeJobService.plan */
    static func plan() -> String? {
        let h = Calendar.current.component(.hour, from: Date())
        if h >= 23 || h < 6 { return nil }
        let mobile = onMobile, now = Date().timeIntervalSince1970
        var types = ""
        for t in ["r", "c", "h"] {
            guard let mins = Double(mobile ? mobileMode(t) : Prefs.string("n_wifi_mode", "30")) else { continue } // "open" of "off"
            if now - Prefs.d.double(forKey: "last_\(t)") >= (mins - 5) * 60 { types += t }
        }
        return types.isEmpty ? nil : types
    }

    // MARK: - alles

    /* types: r = rooster, c = cijfers, h = huiswerk. Gooit een fout als er geen verbinding was. */
    static func runAll(notify: Bool, types: String = "rch") async throws {
        let p = await Portal.open()
        var first: Error?
        do {
            if types.contains("c") { do { try await checkGrades(p, notify: notify && on("grades")) } catch let e where !(e is LoggedOut) { first = e } }
            if types.contains("h") { do { try await checkHomework(p, notify: notify && on("hw")) } catch let e where !(e is LoggedOut) { first = first ?? e } }
            if types.contains("r") { do { try await checkRooster(p, notify: notify && on("rooster")) } catch let e where !(e is LoggedOut) { first = first ?? e } }
        } catch is LoggedOut {
            return // de app vraagt zelf om opnieuw in te loggen
        }
        await withCheckedContinuation { k in Agenda.refresh { _ in k.resume() } }
        await Portal.persistCookies()
        if let e = first { throw e }
        let now = Date().timeIntervalSince1970
        for t in types { Prefs.set("last_\(t)", now) }
    }

    // MARK: - cijfers

    static func checkGrades(_ p: Portal, notify: Bool) async throws {
        let base = try await p.get(Portal.base + pCijfers, marker: "som_cijfers")
        var hrefs: [String] = []
        for g in HTML.groups("<a [^>]*class=\"[^\"]*period-btn[^\"]*\"[^>]*href=\"([^\"]*)\"", base) {
            let h = HTML.unescape(g[1]); if !hrefs.contains(h) { hrefs.append(h) }
        }
        // data sparen: meestal alleen de actieve periode; alle perioden eens per 6 uur, of als er nog niks bekend is
        let known0 = Prefs.d.stringArray(forKey: "known") ?? []
        var full = !hrefs.isEmpty && (known0.isEmpty || Date().timeIntervalSince1970 - Prefs.d.double(forKey: "grades_full_t") > 6 * 3600)
        var current = parseGrades(full ? try await fetchPeriods(p, hrefs) : [base])
        if !full && current.isEmpty && !hrefs.isEmpty { full = true; current = parseGrades(try await fetchPeriods(p, hrefs)) }
        if full && !current.isEmpty { Prefs.set("grades_full_t", Date().timeIntervalSince1970) }
        gradesFound(current, notify: notify)
    }

    static func fetchPeriods(_ p: Portal, _ hrefs: [String]) async throws -> [String] {
        var out: [String] = []
        let page = URL(string: Portal.base + pCijfers)!
        for h in hrefs {
            let url = h.hasPrefix("?") ? Portal.base + pCijfers + h : (URL(string: h, relativeTo: page)?.absoluteString ?? h)
            out.append(try await p.get(url, marker: "som_cijfers"))
        }
        return out
    }

    /* sleutel -> (cijfer, vak), in volgorde */
    static func parseGrades(_ htmls: [String]) -> [(key: String, grade: String, vak: String)] {
        var out: [(key: String, grade: String, vak: String)] = []
        var seen = Set<String>()
        for html in htmls {
            for m in HTML.groups("<span class=\"([^\"]*)wp3-cijfer[^\"]*\"\\s*>\\s*<a [^>]*?rel=\"([^\"]*)\"[^>]*>\\s*<span>([^<]*)</span>", html) {
                if m[1].contains("triggerBubble") { continue } // samengevoegd SO-cijfer
                let f = HTML.fields(HTML.unescape(m[2]))
                let soort = f["Toetssoort"] ?? "", oms = f["Beschrijving"] ?? ""
                if soort.contains("apportcijfer") || oms.lowercased().hasPrefix("rapportcijfer van") { continue }
                var k = (f["Onderdeel"] ?? "?") + "|" + (f["Periode"] ?? "") + "|" + (f["Toetscode"] ?? "") + "|" + oms
                while seen.contains(k) { k += "+" }
                seen.insert(k)
                out.append((k, m[3].trimmingCharacters(in: .whitespaces), f["Onderdeel"] ?? ""))
            }
        }
        return out
    }

    static func gradesFound(_ current: [(key: String, grade: String, vak: String)], notify: Bool) {
        // niks gevonden: de pagina laadde maar half of de sessie was verlopen. Dan niks onthouden.
        if current.isEmpty { return }
        let known = Prefs.d.stringArray(forKey: "known")
        let now = current.map { $0.key + "=" + $0.grade }
        // alles wat ooit gezien is blijft bekend; een cijfer dat even wegvalt en terugkomt is dus niet nieuw
        Prefs.set("known", Array(Set(now).union(known ?? [])))
        guard let k = known, !k.isEmpty, notify else { return }
        let ks = Set(k)
        let fresh = current.filter { !ks.contains($0.key + "=" + $0.grade) }
        if fresh.isEmpty { return }
        let show = Prefs.d.bool(forKey: "n_showgrade")
        let title: String, text: String
        if fresh.count == 1 {
            let g = fresh[0]
            title = show ? "\(g.vak): \(g.grade)" : "Nieuw cijfer voor \(g.vak)"
            text = show ? "Bekijk het in Ichthus+." : "Tik om je cijfer te onthullen."
        } else {
            title = "\(fresh.count) nieuwe cijfers"
            text = join(unique(fresh.map { show ? "\($0.vak) \($0.grade)" : $0.vak })) + ". Tik om ze te onthullen."
        }
        post("grades", title, text, tab: "packs", mode: mode("grades"))
    }

    // MARK: - huiswerk

    static func checkHomework(_ p: Portal, notify: Bool) async throws {
        let mon = monday(Date())
        var current: [(key: String, v: [String])] = [] // {vak, onderwerp, datum, tekst, toets, gemaakt}
        for w in 0..<2 {
            let d = Calendar.current.date(byAdding: .day, value: 7 * w, to: mon)!
            let html = try await p.get(Portal.base + pHuiswerk + "?startdate=" + fmt(d) + "&done=all", marker: "som_huiswerk")
            guard let table = HTML.between(HTML.section(html, "som_huiswerk"), "<table", "</table>") else { continue }
            let heads = HTML.groups("(?s)<th[^>]*>(.*?)</th>", table).map { HTML.text($0[1]).lowercased() }
            guard let body = HTML.between(table, "<tbody", "</tbody>") else { continue }
            for tr in HTML.groups("(?s)<tr([^>]*)>(.*?)</tr>", body) {
                let cells = HTML.groups("(?s)<td([^>]*)>(.*?)</td>", tr[2]).map { HTML.text($0[2]) }
                if cells.count < 3 { continue }
                let cell = { (n: String) -> String in heads.firstIndex(of: n).flatMap { $0 < cells.count ? cells[$0] : nil } ?? "" }
                let vak = cell("vak"), ond = cell("onderwerp"), dat = cell("datum")
                let k = vak + "|" + dat + "|" + ond
                current.removeAll { $0.key == k }
                current.append((k, [vak, ond, dat, cell("huiswerk"), cell("toets").lowercased().contains("ja") ? "1" : "",
                                    cell("gemaakt").lowercased().range(of: "ja|✓|x", options: .regularExpression) != nil ? "1" : ""]))
            }
        }

        // voor de herinneringen: huiswerk met inleverdatum bewaren
        var items: [[String: Any]] = []
        for e in current {
            guard let d = parseDate(e.v[2]) else { continue }
            items.append(["id": e.key, "vak": e.v[0], "ond": e.v[1], "date": d.timeIntervalSince1970 * 1000, "toets": !e.v[4].isEmpty, "gemaakt": !e.v[5].isEmpty])
        }
        HomeworkReminders.mergeItems(items)

        let known = Prefs.d.stringArray(forKey: "hw_known")
        Prefs.set("hw_known", current.map { $0.key + "\u{1}" + $0.v[3] })
        guard let kn = known, notify else { return }
        let knownSet = Set(kn), knownKeys = Set(kn.map { String($0.split(separator: "\u{1}", maxSplits: 1, omittingEmptySubsequences: false).first ?? "") })
        var added: [[String]] = [], changed: [[String]] = []
        for e in current where !knownSet.contains(e.key + "\u{1}" + e.v[3]) {
            if knownKeys.contains(e.key) { changed.append(e.v) } else { added.append(e.v) }
        }
        if added.isEmpty && changed.isEmpty { return }
        let title: String, text: String
        if added.count + changed.count == 1 {
            let h = added.first ?? changed[0]
            let what = h[4].isEmpty ? "huiswerk" : "toets"
            title = (added.isEmpty ? "Aantekening bij \(what): " : "Nieuw \(what): ") + h[0].uppercased()
            text = h[1] + " · " + h[2] + (h[3].isEmpty ? "" : "\n" + h[3])
        } else {
            title = (added.isEmpty ? "" : "\(added.count)x nieuw huiswerk") + (!added.isEmpty && !changed.isEmpty ? ", " : "") + (changed.isEmpty ? "" : "\(changed.count)x aangepast")
            text = join(unique((added + changed).map { $0[0].uppercased() }))
        }
        post("hw", title, text, tab: "huiswerk", mode: mode("hw"))
    }

    // MARK: - rooster (uitval en wijzigingen)

    static func checkRooster(_ p: Portal, notify: Bool) async throws {
        if !Prefs.string("zm_token").isEmpty { return try await checkZermelo(notify: notify, mayRenew: true) }
        var key = Prefs.string("rooster_key")
        if key.isEmpty {
            let base = try await p.get(Portal.base + pRooster, marker: "som_rooster")
            key = HTML.groups("(startdate\\d+)=", HTML.section(base, "som_rooster")).first?[1] ?? "startdate"
            Prefs.set("rooster_key", key)
        }
        // vandaag en de komende twee dagen
        let from = Calendar.current.startOfDay(for: Date()), until = from.addingTimeInterval(3 * 86400)
        var current: [(key: String, v: String)] = [] // "datum|uur|vak" -> "vak|lokaal|klasse"
        var daysSeen = Set<String>()
        let mon = monday(Date())
        for w in 0..<2 {
            let d = Calendar.current.date(byAdding: .day, value: 7 * w, to: mon)!
            let sec = HTML.section(try await p.get(Portal.base + pRooster + "?" + key + "=" + fmt(d), marker: "som_rooster"), "som_rooster")
            for part in sec.components(separatedBy: "wp3-portlet-table-wrapper").dropFirst() {
                guard let head = HTML.between(part, "wp3-portlet-table-data-currday", "</table>"), let day = parseDate(HTML.text(head)),
                      day >= from, day < until else { continue }
                let dk = fmt(day)
                daysSeen.insert(dk)
                guard let body = HTML.between(part, "<tbody", "</tbody>") else { continue }
                for tr in HTML.groups("(?s)<tr([^>]*)>(.*?)</tr>", body) {
                    let cls = HTML.attr(tr[1], "class")
                    let uur = HTML.tdByClass(tr[2], "hour"), vak = HTML.tdByClass(tr[2], "course"), lok = HTML.tdByClass(tr[2], "classroom")
                    if vak.isEmpty && uur.isEmpty { continue }
                    let uitval = (cls + " " + HTML.text(tr[2]).lowercased()).range(of: "vervall|vervalt|uitval|cancel", options: .regularExpression) != nil
                    let k = dk + "|" + uur + "|" + vak
                    current.removeAll { $0.key == k }
                    current.append((k, vak + "|" + lok + "|" + (uitval ? "uitval" : cls)))
                }
            }
        }
        let prev = Prefs.d.dictionary(forKey: "rooster_snap") as? [String: String]
        Prefs.set("rooster_snap", Dictionary(current.map { ($0.key, $0.v) }, uniquingKeysWith: { $1 }))
        guard let pv = prev, notify else { return }

        var msgs: [String] = []
        var anyUitval = false
        for e in current {
            let now = e.v.components(separatedBy: "|"), k = e.key.components(separatedBy: "|")
            guard now.count >= 3, k.count >= 3 else { continue }
            let before = pv[e.key]
            if now[2] == "uitval" && !(before?.hasSuffix("|uitval") ?? false) {
                msgs.append("\(dayLabel(k[0])) \(k[1])e uur \(now[0].uppercased()) valt uit"); anyUitval = true
            } else if let b = before?.components(separatedBy: "|"), b.count >= 2, b[1] != now[1], !now[1].isEmpty {
                msgs.append("\(dayLabel(k[0])) \(k[1])e uur \(now[0].uppercased()): lokaal \(now[1])")
            }
        }
        // lessen die eerder in het rooster stonden en nu weg zijn (alleen voor dagen die we toen ook zagen)
        let keys = Set(current.map(\.key))
        for pk in pv.keys.sorted() where !keys.contains(pk) {
            let k = pk.components(separatedBy: "|")
            guard k.count >= 3, daysSeen.contains(k[0]), let d = parseDmy(k[0]), d >= from else { continue }
            msgs.append("\(dayLabel(k[0])) \(k[1])e uur \(k[2].uppercased()) staat niet meer in je rooster"); anyUitval = true
        }
        roosterNotify(msgs, anyUitval)
    }

    static func roosterNotify(_ msgs: [String], _ anyUitval: Bool) {
        if msgs.isEmpty { return }
        let title = msgs.count == 1 ? (anyUitval ? "Uitval" : "Roosterwijziging") : "\(msgs.count) roosterwijzigingen"
        post("rooster", title, join(msgs), tab: "rooster", mode: mode("rooster"))
    }

    /* Zermelo geeft per les direct aan of hij uitvalt; we vergelijken vandaag t/m overmorgen met de vorige keer */
    static func checkZermelo(notify: Bool, mayRenew: Bool) async throws {
        let school = Prefs.string("zm_school"), token = Prefs.string("zm_token")
        let from = Int(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970), until = from + 3 * 86400
        var c = URLComponents(string: "https://\(school).zportal.nl/api/v3/appointments")!
        c.queryItems = [.init(name: "user", value: "~me"), .init(name: "valid", value: "true"), .init(name: "start", value: "\(from)"),
                        .init(name: "end", value: "\(until)"), .init(name: "access_token", value: token)]
        guard let url = c.url else { return }
        let (data, resp) = try await URLSession.shared.data(from: url)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 || code == 403 {
            if mayRenew, await renewZermeloSso() { try await checkZermelo(notify: notify, mayRenew: false) }
            return // anders: de app vraagt om opnieuw in te loggen
        }
        if code != 200 { throw HTTPError(code: code) }
        let list = (((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["response"] as? [String: Any])?["data"] as? [[String: Any]] ?? []

        var snap: [String: String] = [:], info: [String: [String]] = [:]
        var widget: [[String: Any]] = []
        for a in list where (a["type"] as? String) != "choice" {
            let start = (a["start"] as? NSNumber)?.doubleValue ?? 0
            let k = "\(a["appointmentInstance"] as? NSNumber ?? 0)@\(Int(start))"
            let vak = (a["subjects"] as? [String] ?? []).joined(separator: ", "), lok = (a["locations"] as? [String] ?? []).joined(separator: ", ")
            let cancelled = a["cancelled"] as? Bool ?? false
            snap[k] = vak + "|" + lok + "|" + (cancelled ? "uitval" : "") + "|" + (a["changeDescription"] as? String ?? "")
            let d = Date(timeIntervalSince1970: start)
            var uur = HTML.replace(a["startTimeSlotName"] as? String ?? "", "^\\D+", "")
            uur = HTML.replace(uur, "^0+(?=\\d)", "")
            info[k] = [fmt(d), uur.isEmpty ? hhmm(d) : uur + "e uur", vak]
            widget.append(["s": start * 1000, "e": ((a["end"] as? NSNumber)?.doubleValue ?? start) * 1000, "vak": vak, "lok": lok, "uit": cancelled, "uur": uur])
        }
        WidgetData.saveLessons(widget, accent: nil)
        let prev = Prefs.d.dictionary(forKey: "zm_snap") as? [String: String]
        Prefs.set("zm_snap", snap)
        guard let pv = prev, notify else { return }

        var msgs: [String] = []
        var anyUitval = false
        for (k, v) in snap.sorted(by: { $0.key < $1.key }) {
            guard let before = pv[k], let inf = info[k] else { continue }
            let now = v.components(separatedBy: "|"), b = before.components(separatedBy: "|")
            guard now.count >= 4, b.count >= 4 else { continue }
            let label = "\(dayLabel(inf[0])) \(inf[1]) \(inf[2].uppercased())"
            if now[2] == "uitval" && b[2] != "uitval" { msgs.append(label + " valt uit"); anyUitval = true }
            else if b[1] != now[1] && !now[1].isEmpty { msgs.append(label + ": lokaal " + now[1]) }
            else if !now[3].isEmpty && now[3] != b[3] { msgs.append(label + ": " + now[3]) }
        }
        for (k, v) in pv where snap[k] == nil {
            guard let start = Double(k.split(separator: "@").last ?? ""), start > Date().timeIntervalSince1970 else { continue }
            let b = v.components(separatedBy: "|")
            if b.count >= 3 && b[2] == "uitval" { continue }
            let d = Date(timeIntervalSince1970: start)
            msgs.append("\(dayLabel(fmt(d))) \(hhmm(d)) \(b[0].uppercased()) staat niet meer in je rooster"); anyUitval = true
        }
        roosterNotify(msgs, anyUitval)
    }

    /*
     Een Zermelo-login via je schoolaccount verloopt na ongeveer 16 uur. Op de achtergrond proberen we hem stil te
     vernieuwen door de Zermelo-link te volgen met de cookies van de app (werkt als Microsoft je "aangemeld" houdt).
     */
    static func renewZermeloSso() async -> Bool {
        guard Prefs.d.bool(forKey: "zm_sso"), let start = URL(string: Prefs.string("zm_url")), start.scheme == "https" else { return false }
        let p = await Portal.open()
        var target = start
        for _ in 0..<15 {
            let comps = URLComponents(url: target, resolvingAgainstBaseURL: false)
            let host = target.host?.lowercased() ?? ""
            if host.hasSuffix(".zportal.nl"), let code = comps?.queryItems?.first(where: { $0.name == "code" })?.value, !code.isEmpty {
                let tenant = comps?.queryItems?.first(where: { $0.name == "tenant" })?.value ?? ""
                let school = tenant.isEmpty ? String(host.prefix(while: { $0 != "." })) : tenant
                guard let token = await tokenFromCode(school: school, code: code) else { return false }
                Prefs.set("zm_school", school); Prefs.set("zm_token", token); Prefs.set("zm_sso", true)
                return true
            }
            guard let next = try? await p.hop(target) else { return false } // een pagina die echt inloggen vraagt
            target = next
        }
        return false
    }

    /* na inloggen geeft Zermelo een code: omwisselen via oauth/token, of de code is zelf al een sleutel */
    static func tokenFromCode(school: String, code: String) async -> String? {
        let base = "https://\(school).zportal.nl/api/v3"
        var req = URLRequest(url: URL(string: base + "/oauth/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = "grant_type=authorization_code&code=\(code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code)".data(using: .utf8)
        if let (d, r) = try? await URLSession.shared.data(for: req), (r as? HTTPURLResponse)?.statusCode == 200,
           let t = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["access_token"] as? String, !t.isEmpty { return t }
        var c = URLComponents(string: base + "/users/~me")!
        c.queryItems = [.init(name: "access_token", value: code)]
        if let (_, r) = try? await URLSession.shared.data(from: c.url!), (r as? HTTPURLResponse)?.statusCode == 200 { return code }
        return nil
    }

    // MARK: - meldingen

    /* id per soort: een nieuwe melding van dezelfde soort vervangt de vorige (zoals op Android) */
    static func post(_ id: String, _ title: String, _ text: String, tab: String, mode: String) {
        if mode == "uit" { return }
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = text
        c.userInfo = ["tab": tab]
        if mode == "stil" { c.interruptionLevel = .passive } else { c.sound = .default }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    static func testNotify(_ type: String) {
        let m = mode(type), note = m == "uit" ? " (staat uit, getest met geluid)" : "", use = m == "uit" ? "geluid" : m
        switch type {
        case "hw": post("test-hw", "Nieuw toets: WI" + note, "Repetitie hoofdstuk 3 · morgen\nLeren: §3.1 t/m 3.4", tab: "huiswerk", mode: use)
        case "rooster": post("test-rooster", "Uitval" + note, "Morgen 2e uur NE valt uit", tab: "rooster", mode: use)
        default: post("test-grades", (Prefs.d.bool(forKey: "n_showgrade") ? "Wiskunde: 7.4" : "Nieuw cijfer voor Wiskunde") + note, "Tik om je cijfer te onthullen.", tab: "packs", mode: use)
        }
    }

    // MARK: - datums

    static func monday(_ now: Date) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        var d = cal.startOfDay(for: now)
        let wd = cal.component(.weekday, from: d) // 1 = zondag
        if wd == 7 { d = cal.date(byAdding: .day, value: 2, to: d)! } else if wd == 1 { d = cal.date(byAdding: .day, value: 1, to: d)! }
        let back = (cal.component(.weekday, from: d) + 5) % 7
        return cal.date(byAdding: .day, value: -back, to: d)!
    }

    static func fmt(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.day, .month, .year], from: d)
        return String(format: "%02d-%02d-%04d", c.day ?? 0, c.month ?? 0, c.year ?? 0)
    }

    static func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    static let months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

    static func parseDate(_ s: String) -> Date? {
        guard let m = HTML.groups("(\\d{1,2})\\s+([a-z]{3})[a-z]*\\.?\\s+(\\d{4})", s.lowercased()).first else { return nil }
        guard let i = months.firstIndex(of: m[2]) ?? (m[2] == "maa" ? 2 : nil) else { return nil }
        return Calendar.current.date(from: DateComponents(year: Int(m[3]), month: i + 1, day: Int(m[1])))
    }

    static func parseDmy(_ dmy: String) -> Date? {
        let p = dmy.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[2], month: p[1], day: p[0]))
    }

    static func dayLabel(_ dmy: String) -> String {
        guard let d = parseDmy(dmy) else { return dmy }
        let diff = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: d).day ?? 0
        if diff == 0 { return "Vandaag" }
        if diff == 1 { return "Morgen" }
        let days = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"]
        let n = days[Calendar.current.component(.weekday, from: d) - 1]
        return n.prefix(1).uppercased() + n.dropFirst()
    }

    static func join(_ items: [String]) -> String {
        if items.count <= 1 { return items.first ?? "" }
        return items.dropLast().joined(separator: ", ") + " en " + items.last!
    }

    static func unique(_ a: [String]) -> [String] {
        var seen = Set<String>()
        return a.filter { seen.insert($0).inserted }
    }
}
