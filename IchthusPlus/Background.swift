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
        let work = Task {
            do { try await Checker.runAll(notify: true, types: types); task.setTaskCompleted(success: true) }
            catch { task.setTaskCompleted(success: false) }
        }
        task.expirationHandler = { work.cancel() }
    }

    /* toestemming voor meldingen bijhouden, voor het instellingenscherm in de app */
    static func refreshAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            Prefs.set("notif_allowed", s.authorizationStatus == .authorized || s.authorizationStatus == .provisional)
        }
    }
}

/* rooster voor de widget, in de opslag die de app en de widget delen (app group; SideStore zet de echte naam in ALTAppGroups) */
enum WidgetData {
    static var shared: UserDefaults {
        let group = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String])?.first ?? "group.nl.cijferpacks.app"
        return UserDefaults(suiteName: group) ?? .standard
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
