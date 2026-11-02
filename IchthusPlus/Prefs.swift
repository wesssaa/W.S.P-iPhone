import UIKit

/* opslag van de app zelf (zoals de SharedPreferences op Android): thema, Zermelo-koppeling, jaaragenda */
enum Prefs {
    static let d = UserDefaults.standard

    static var theme: String {
        get { d.string(forKey: "ui_theme") ?? "light" }
        set { d.set(newValue, forKey: "ui_theme") }
    }

    static func string(_ k: String, _ def: String = "") -> String { d.string(forKey: k) ?? def }
    static func set(_ k: String, _ v: Any?) { d.set(v, forKey: k) }

    /* alles van deze leerling weg bij uitloggen; thema en icoon blijven staan */
    static func clearAccount() {
        for k in ["zm_school", "zm_token", "zm_sso", "zm_url", "zm_snap", "known", "grades_full_t", "last_r", "last_c", "last_h",
                  "hw_known", "hw_items", "hw_rules", "rooster_key", "rooster_snap", "w_lessons"] { d.removeObject(forKey: k) }
    }
}

enum Theme {
    static func background(_ mode: String = Prefs.theme) -> UIColor {
        mode == "dark" ? UIColor(red: 0x0D / 255, green: 0x0C / 255, blue: 0x0A / 255, alpha: 1)
            : UIColor(red: 0xF3 / 255, green: 0xF1 / 255, blue: 0xEC / 255, alpha: 1)
    }
}
