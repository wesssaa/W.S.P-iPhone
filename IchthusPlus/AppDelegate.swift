import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    static let launched = Date() // om de opstarttijd te meten (staat in het logboek)
    private var controller: WebViewController? { window?.rootViewController as? WebViewController }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        _ = Self.launched
        // foutmeldingen opvangen, en een fout van de vorige keer naar de ontwikkelaar sturen
        CrashLog.install()
        CrashLog.sendPending()
        UNUserNotificationCenter.current().delegate = self
        _ = Checker.monitor // wifi of 4G/5G bijhouden
        Background.register()
        Background.schedule()
        // net als Android 13+: bij het opstarten om toestemming voor meldingen vragen (iOS vraagt dat maar één keer)
        if application.applicationState != .background {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in Background.refreshAllowed() }
        }
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    /* bij elke keer openen: de app laden (als dat nog niet gebeurd is), wat geweest is doorschuiven en reminders opnieuw inplannen */
    func applicationDidBecomeActive(_ application: UIApplication) {
        controller?.startIfNeeded()
        Reminders.advance()
        Reminders.schedule()
        HomeworkReminders.schedule()
        Background.refreshAllowed()
    }

    /* naar de achtergrond: de inlog vasthouden (zoals Android de cookies bij onPause wegschrijft) */
    func applicationDidEnterBackground(_ application: UIApplication) {
        var id = UIBackgroundTaskIdentifier.invalid
        id = application.beginBackgroundTask { application.endBackgroundTask(id) }
        Task {
            await Portal.persistCookies()
            application.endBackgroundTask(id)
        }
    }

    /* op de widget tikken: ichthusplus://rooster */
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard url.scheme == "ichthusplus" else { return false }
        controller?.openTab(url.host ?? "rooster")
        return true
    }

    /* ook een melding laten zien als de app open is (zoals op Android) */
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }

    /* op een melding tikken: meteen het goede tabblad (ook als de app nog moet opstarten) */
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        controller?.openTab(response.notification.request.content.userInfo["tab"] as? String ?? "rooster")
        done()
    }
}
