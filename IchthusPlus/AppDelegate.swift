import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    static let launched = Date() // om de opstarttijd te meten (staat in het logboek)

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        _ = Self.launched
        UNUserNotificationCenter.current().delegate = self
        _ = Checker.monitor // wifi of 4G/5G bijhouden
        Background.register()
        Background.schedule()
        // net als Android 13+: bij het opstarten om toestemming voor meldingen vragen (iOS vraagt dat maar één keer)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in Background.refreshAllowed() }
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    /* bij elke keer openen: wat geweest is doorschuiven en de komende reminders opnieuw inplannen */
    func applicationDidBecomeActive(_ application: UIApplication) {
        Reminders.advance()
        Reminders.schedule()
        HomeworkReminders.schedule()
        Background.refreshAllowed()
    }

    /* op de widget tikken: ichthusplus://rooster */
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard url.scheme == "ichthusplus" else { return false }
        let tab = (url.host ?? "rooster").filter { $0.isLetter && $0.isLowercase }
        (window?.rootViewController as? WebViewController)?.js("window.__cpApp ? window.__cpApp.go('\(tab)') : (window.__cpStartTab='\(tab)')")
        return true
    }

    /* ook een melding laten zien als de app open is (zoals op Android) */
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }

    /* op een melding tikken: meteen het goede tabblad */
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        let tab = (response.notification.request.content.userInfo["tab"] as? String ?? "rooster").filter { $0.isLetter && $0.isLowercase }
        (window?.rootViewController as? WebViewController)?.js("window.__cpApp ? window.__cpApp.go('\(tab)') : (window.__cpStartTab='\(tab)')")
        done()
    }
}
