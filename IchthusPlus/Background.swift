import BackgroundTasks
import UserNotifications
import WidgetKit

/*
 Op de achtergrond kijken. Android start de app elk half uur; iOS beslist zelf wanneer (meestal een paar keer per dag,
 vaker als je de app veel gebruikt). We vragen steeds om "over een half uur" en houden ons aan de instellingen
 bij Datagebruik (en 's nachts niets), net als GradeJobService.
 */
enum Background {
    static let id = "nl.cijferpacks.app.refresh"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
            guard let t = task as? BGAppRefreshTask else { return task.setTaskCompleted(success: false) }
            run(t)
        }
    }

    static func schedule() {
        let r = BGAppRefreshTaskRequest(identifier: id)
        r.earliestBeginDate = Date().addingTimeInterval(30 * 60)
        try? BGTaskScheduler.shared.submit(r)
    }

    private static func run(_ task: BGAppRefreshTask) {
        schedule() // meteen de volgende keer aanvragen
        let anyOn = ["grades", "hw", "rooster"].contains { Checker.on($0) }
        guard anyOn, let types = Checker.plan() else { return task.setTaskCompleted(success: true) }
        // precies één keer "klaar" melden: na de controle, of meteen als iOS de tijd om vindt (anders sluit iOS de app
        // en krijgt hij daarna minder vaak een beurt)
        let lock = NSLock()
        var done = false
        let finish = { (ok: Bool) in
            lock.lock(); defer { lock.unlock() }
            if done { return }
            done = true
            task.setTaskCompleted(success: ok)
        }
        let work = Task {
            do { try await Checker.runAll(notify: true, types: types, agenda: false); finish(true) }
            catch { finish(false) }
        }
        task.expirationHandler = { work.cancel(); finish(false) }
    }

    /* toestemming voor meldingen bijhouden, voor het instellingenscherm in de app */
    static func refreshAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            // nog niet gevraagd telt niet als "uit": de app vraagt het bij het opstarten (zoals op Android)
            Prefs.set("notif_allowed", s.authorizationStatus != .denied)
        }
    }
}

/* rooster voor de widget, in de opslag die de app en de widget delen (app group; SideStore maakt er group.nl.cijferpacks.app.<team> van) */
enum WidgetData {
    static var shared: UserDefaults { group.flatMap { UserDefaults(suiteName: $0) } ?? .standard }

    /* zelfde zoektocht als in de widget: ALTAppGroups, dan het profiel van de app; alleen een groep waar iOS echt toegang toe geeft */
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

    static func saveLessons(_ lessons: [[String: Any]], accent: String?) {
        let json = lessons.jsonArrayString
        Prefs.set("w_lessons", json)
        shared.set(json, forKey: "w_lessons")
        if let a = accent, a.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil { shared.set(a, forKey: "w_accent") }
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func clear() {
        shared.removeObject(forKey: "w_lessons")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
