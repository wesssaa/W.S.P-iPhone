import UIKit
import Darwin

/*
 Foutmeldingen, zoals CrashLog + CrashReporter op Android: loopt de app vast, dan schrijven we de fout in een bestand;
 bij de volgende start sturen we hem automatisch naar de ontwikkelaar via ntfy.
 Het geheime ntfy-onderwerp staat niet in de (openbare) code: de build zet het uit het GitHub-geheim WSP_CRASH_TOPIC
 in Info.plist. Zonder dat geheim (bijv. een eigen build) wordt er niks verstuurd.
 Alleen de foutmelding zelf: app-versie, iOS-versie, iPhone-model en de technische fout. Geen cijfers, rooster, naam of inlog.
 */
enum CrashLog {
    static var topic: String {
        let t = (Bundle.main.object(forInfoDictionaryKey: "WSPCrashTopic") as? String ?? "").trimmingCharacters(in: .whitespaces)
        return t.range(of: "^[A-Za-z0-9_-]{8,64}$", options: .regularExpression) != nil ? t : ""
    }
    static var file: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("crash.txt") }
    private static var fd: Int32 = -1 // al open, zodat we bij een crash niks meer hoeven aan te maken
    private static var header = [CChar]()

    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?" }

    /* het model, bijv. "iPhone15,2" */
    static var model: String {
        var u = utsname()
        uname(&u)
        return withUnsafeBytes(of: &u.machine) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) }
    }

    static func head() -> String {
        let f = DateFormatter()
        f.dateFormat = "dd-MM-yyyy HH:mm:ss"
        return "=== \(f.string(from: Date())) · app \(version) · iOS \(UIDevice.current.systemVersion) · \(model)\n"
    }

    static func append(_ text: String) {
        guard let d = (head() + text + "\n").data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: file) { h.seekToEndOfFile(); h.write(d); try? h.close() }
        else { try? d.write(to: file) }
    }

    /* fouten opvangen: Objective-C-uitzonderingen en harde crashes (signalen, ook Swift-fouten als een te grote index) */
    static func install() {
        NSSetUncaughtExceptionHandler { e in
            CrashLog.append("CRASH: \(e.name.rawValue): \(e.reason ?? "")\n" + e.callStackSymbols.joined(separator: "\n"))
        }
        fd = open(file.path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        header = Array(head().utf8CString)
        for s in [SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE] {
            signal(s) { sig in
                // in een signaal mag bijna niks: alleen schrijven naar het al geopende bestand en de aanroepen erbij
                if CrashLog.fd >= 0 {
                    CrashLog.header.withUnsafeBufferPointer { _ = write(CrashLog.fd, $0.baseAddress, $0.count - 1) }
                    let msg = "CRASH: signaal \(sig)\n"
                    msg.withCString { _ = write(CrashLog.fd, $0, strlen($0)) }
                    var frames = [UnsafeMutableRawPointer?](repeating: nil, count: 64)
                    let n = backtrace(&frames, 64)
                    backtrace_symbols_fd(&frames, n, CrashLog.fd)
                }
                signal(sig, SIG_DFL)
                raise(sig)
            }
        }
    }

    /* bij het starten: een eerdere fout versturen (dezelfde maar één keer) en dan het bestand weghalen */
    static func sendPending() {
        guard !topic.isEmpty, let text = try? String(contentsOf: file, encoding: .utf8), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        // vaste hash (hashValue verschilt per keer dat de app start)
        let key = String(text.utf8.reduce(UInt64(5381)) { ($0 &* 33) ^ UInt64($1) }, radix: 16)
        if Prefs.string("crash_sent") == key { return clear() }
        let test = text.contains("TEST:")
        var req = URLRequest(url: URL(string: "https://ntfy.sh/\(topic)")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        // titel alleen met gewone tekens: een HTTP-kop kan geen speciale tekens bevatten
        let title = ((test ? "[TEST] " : "") + "W.S.P iPhone \(version) crash - \(model)").filter { $0.isASCII }
        req.setValue("text/plain; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.setValue(title, forHTTPHeaderField: "Title")
        req.setValue(test ? "test_tube" : "warning", forHTTPHeaderField: "Tags")
        req.setValue(test ? "default" : "high", forHTTPHeaderField: "Priority")
        // ntfy houdt berichten tot ±4 KB als tekst; de kop en het begin van de fout zijn het belangrijkst
        req.httpBody = (text.count > 3800 ? String(text.prefix(3800)) + "\n…" : text).data(using: .utf8)
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return } // geen internet: volgende keer opnieuw
            Prefs.set("crash_sent", key)
            clear()
        }.resume()
    }

    static func clear() {
        if fd >= 0 { ftruncate(fd, 0) } else { try? FileManager.default.removeItem(at: file) }
    }

    /* ontwikkelaarsscherm: een testfoutmelding meteen versturen */
    static func test() {
        append("TEST: gesimuleerde crash (ontwikkelaar)\nDit is een testcrash vanuit het ontwikkelaarsscherm")
        sendPending()
    }
}
