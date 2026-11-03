import WidgetKit
import SwiftUI

/*
 Widget "volgende les", zoals NextLessonWidget op Android: je les van nu of je volgende les, het lokaal en of hij uitvalt.
 De app zet de lessen in een gedeelde opslag (app group); SideStore past de naam van die groep aan en zet hem in ALTAppGroups.
 */
enum Shared {
    static var defaults: UserDefaults? { group.flatMap { UserDefaults(suiteName: $0) } }

    /* de echte naam van de groep (SideStore maakt er group.nl.cijferpacks.app.<team> van): eerst ALTAppGroups, dan het profiel
       in de widget zelf. Alleen een groep waar iOS echt toegang toe geeft telt, anders leest de widget iets anders dan de app schrijft */
    static var group: String? {
        var names = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String]) ?? []
        names += profileGroups()
        names.append("group.nl.cijferpacks.app")
        return names.first { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil }
    }

    static func profileGroups() -> [String] {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let a = data.range(of: Data("<?xml".utf8)),
              let b = data.range(of: Data("</plist>".utf8), in: a.lowerBound..<data.endIndex),
              let p = (try? PropertyListSerialization.propertyList(from: Data(data[a.lowerBound..<b.upperBound]), format: nil)) as? [String: Any],
              let ent = p["Entitlements"] as? [String: Any] else { return [] }
        return ent["com.apple.security.application-groups"] as? [String] ?? []
    }
}

struct Lesson {
    let s: Date, e: Date, vak: String, lok: String, uur: String, uit: Bool
    var label: String { vak.isEmpty ? "Les" : vak.uppercased() }
}

struct Entry: TimelineEntry {
    let date: Date
    let when: String
    let vak: String
    let lok: String
    let info: String
    let next: String?
    let uit: Bool
    let accent: Color
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), when: "STRAKS · 10:40", vak: "EN", lok: "b112", info: "4e uur · 10:40–11:25", next: "Daarna 11:25 · WI · a138", uit: false, accent: .yellow)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : entry(at: Date(), lessons()))
    }

    /* een stand per 5 minuten (voor "nog x min") en op elke begin- en eindtijd, voor de komende 12 uur */
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let all = lessons(), now = Date()
        var times = Set<Date>([now])
        var t = now
        while t < now.addingTimeInterval(12 * 3600) { t = t.addingTimeInterval(300); times.insert(t) }
        for l in all where l.s > now && l.s < now.addingTimeInterval(12 * 3600) { times.insert(l.s); times.insert(l.e) }
        let entries = times.sorted().map { entry(at: $0, all) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    func lessons() -> [Lesson] {
        guard let d = Shared.defaults?.string(forKey: "w_lessons")?.data(using: .utf8),
              let a = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] else { return [] }
        let ms = { (v: Any?) -> Date in Date(timeIntervalSince1970: ((v as? NSNumber)?.doubleValue ?? 0) / 1000) }
        return a.map { Lesson(s: ms($0["s"]), e: ms($0["e"]), vak: $0["vak"] as? String ?? "", lok: $0["lok"] as? String ?? "",
                              uur: ($0["uur"] as? String) ?? ($0["uur"] as? NSNumber)?.stringValue ?? "", uit: $0["uit"] as? Bool ?? false) }
            .sorted { $0.s < $1.s }
    }

    func entry(at now: Date, _ all: [Lesson]) -> Entry {
        let accent = Color(hex: Shared.defaults?.string(forKey: "w_accent") ?? "") ?? Color(red: 1, green: 0.83, blue: 0.3)
        // lessen die uitvallen tellen als "nu" niet mee
        var cur: Lesson?, next: Lesson?, after: Lesson?
        for l in all where l.e > now {
            if l.s <= now && cur == nil && !l.uit { cur = l; continue }
            if l.s > now { if next == nil { next = l } else if after == nil { after = l; break } }
        }
        let daarna = { (l: Lesson) in "Daarna \(time(l.s)) · \(l.label)" + (l.uit ? " (valt uit)" : l.lok.isEmpty ? "" : " · \(l.lok)") }
        if let c = cur {
            let left = max(1, Int((c.e.timeIntervalSince(now) + 59) / 60))
            return Entry(date: now, when: "NU · NOG \(left) MIN", vak: c.label, lok: c.lok, info: info(c), next: next.map(daarna), uit: false, accent: accent)
        }
        if let n = next {
            let when = (Calendar.current.isDate(n.s, inSameDayAs: now) ? "STRAKS" : dayWord(n.s, now).uppercased()) + " · " + time(n.s)
            let a = after.flatMap { Calendar.current.isDate($0.s, inSameDayAs: n.s) ? daarna($0) : nil }
            return Entry(date: now, when: when, vak: n.label, lok: n.uit ? "" : n.lok, info: info(n), next: a, uit: n.uit, accent: accent)
        }
        return Entry(date: now, when: "W.S.P", vak: all.isEmpty ? "Rooster" : "Geen lessen meer", lok: "",
                     info: all.isEmpty ? "Open de app om je rooster te laden" : "Open de app voor je rooster", next: nil, uit: false, accent: accent)
    }

    func info(_ l: Lesson) -> String { (l.uur.isEmpty ? "" : "\(l.uur)e uur · ") + "\(time(l.s))–\(time(l.e))" + (l.uit ? " · valt uit" : "") }

    func time(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    func dayWord(_ d: Date, _ now: Date) -> String {
        let diff = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: now), to: Calendar.current.startOfDay(for: d)).day ?? 0
        if diff == 1 { return "morgen" }
        return ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"][Calendar.current.component(.weekday, from: d) - 1]
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) var family
    let e: Entry

    var body: some View {
        content
            .widgetURL(URL(string: "ichthusplus://rooster"))
            .modifier(Background())
    }

    @ViewBuilder var content: some View {
        switch family {
        case .accessoryInline:
            // één regel boven de klok op het toegangsscherm
            Text(e.vak == "Rooster" || e.vak == "Geen lessen meer" ? "W.S.P" : "\(e.when.replacingOccurrences(of: "STRAKS · ", with: "")) \(e.vak)\(e.uit ? " valt uit" : e.lok.isEmpty ? "" : " · " + e.lok)")
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text(e.vak).font(.system(size: 15, weight: .heavy)).minimumScaleFactor(0.5).lineLimit(1)
                Text(e.uit ? "UIT" : e.lok).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6)
            }
            .padding(4)
            .modifier(CircleBackground())
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(e.when).font(.system(size: 11, weight: .bold)).widgetAccentable()
                Text(e.vak + (e.lok.isEmpty ? "" : " · " + e.lok)).font(.system(size: 15, weight: .heavy)).lineLimit(1)
                Text(e.uit ? "Valt uit" : e.info).font(.system(size: 11)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(e.when).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(e.accent).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(e.vak).font(.system(size: family == .systemSmall ? 28 : 32, weight: .heavy, design: .rounded)).lineLimit(1).minimumScaleFactor(0.6)
                    if !e.lok.isEmpty { Text(e.lok).font(.system(size: 15, weight: .semibold, design: .monospaced)).foregroundColor(.secondary).lineLimit(1) }
                }
                if e.uit {
                    Text("VALT UIT").font(.system(size: 10, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Color.red))
                }
                Text(e.info).font(.system(size: 12, weight: .medium)).foregroundColor(.secondary).lineLimit(family == .systemSmall ? 2 : 1)
                Spacer(minLength: 0)
                if let n = e.next { Text(n).font(.system(size: 11)).foregroundColor(.secondary).lineLimit(family == .systemSmall ? 2 : 1) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/* iOS 17 wil de achtergrond via containerBackground; oudere versies gewoon met padding (niet op het toegangsscherm) */
struct Background: ViewModifier {
    @Environment(\.widgetFamily) var family
    func body(content: Content) -> some View {
        let lock = [WidgetFamily.accessoryInline, .accessoryCircular, .accessoryRectangular].contains(family)
        if #available(iOS 17, *) {
            content.containerBackground(for: .widget) { lock ? Color.clear : Color(UIColor.systemBackground) }
        } else if lock {
            content
        } else {
            content.padding()
        }
    }
}

/* rond widgetje op het toegangsscherm: de standaard doorschijnende achtergrond */
struct CircleBackground: ViewModifier {
    func body(content: Content) -> some View {
        ZStack { AccessoryWidgetBackground(); content }
    }
}

@main
struct IchthusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextLesson", provider: Provider()) { WidgetView(e: $0) }
            .configurationDisplayName("Volgende les")
            .description("Je les van nu of straks, het lokaal en of hij uitvalt.")
            .supportedFamilies(families)
    }

    var families: [WidgetFamily] {
        // ook op het toegangsscherm: onder de klok (rechthoek of rondje) en één regel erboven
        [.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline]
    }
}

extension Color {
    init?(hex: String) {
        guard hex.count == 7, hex.hasPrefix("#"), let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
