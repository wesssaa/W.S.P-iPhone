import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
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
