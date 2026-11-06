import Foundation
import WebKit

struct LoggedOut: Error {}
struct HTTPError: Error { let code: Int }

/*
 Portaalpagina's ophalen met de inlog (cookies) van de app, zoals GradeChecker.get op Android.
 Doorverwijzingen volgen we zelf, zodat een verlopen sessie stil via Microsoft ("aangemeld blijven") wordt vernieuwd;
 nieuwe cookies gaan terug naar de WebView, zodat die ook ingelogd blijft.
 */
final class Portal {
    static let base = "https://\(WebViewController.portalHost)"
    private var cookies: [HTTPCookie] = []
    /* WebKit mag alleen op de hoofdthread: de cookieopslag daar opvragen, nooit op de achtergrond */
    @MainActor static func cookieStore() -> WKHTTPCookieStore { WKWebsiteDataStore.default().httpCookieStore }
    /* één sessie voor alle controles (een sessie per keer bleef anders in het geheugen hangen); cookies doen we zelf */
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.timeoutIntervalForRequest = 20
        c.waitsForConnectivity = false
        return URLSession(configuration: c, delegate: NoRedirect(), delegateQueue: nil)
    }()
    private var session: URLSession { Self.session }

    static func open() async -> Portal {
        let p = Portal()
        p.cookies = await cookieStore().allCookies()
        return p
    }

    func get(_ url: String, marker: String?) async throws -> String {
        guard var target = URL(string: url) else { throw HTTPError(code: 0) }
        for _ in 0..<10 {
            var req = URLRequest(url: target)
            req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X) IchthusPlus", forHTTPHeaderField: "User-Agent")
            let mine = cookies.filter { matches($0, target) }
            if !mine.isEmpty { req.setValue(mine.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie") }
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw HTTPError(code: 0) }
            let headers = http.allHeaderFields as? [String: String] ?? [:]
            let fresh = HTTPCookie.cookies(withResponseHeaderFields: headers, for: target)
            if !fresh.isEmpty { await keep(fresh) }
            if (300..<400).contains(http.statusCode) {
                guard let loc = headers.first(where: { $0.key.lowercased() == "location" })?.value,
                      let next = URL(string: loc, relativeTo: target)?.absoluteURL else { throw LoggedOut() }
                target = next
                continue
            }
            if http.statusCode != 200 { throw HTTPError(code: http.statusCode) }
            let body = String(decoding: data, as: UTF8.self)
            if target.host?.lowercased() != WebViewController.portalHost { throw LoggedOut() }
            if let m = marker, !body.contains(m) { throw LoggedOut() }
            return body
        }
        throw LoggedOut()
    }

    /* één stap: waar stuurt deze pagina ons heen? (gooit een fout als hij niet doorstuurt) */
    func hop(_ target: URL) async throws -> URL {
        var req = URLRequest(url: target)
        req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X) IchthusPlus", forHTTPHeaderField: "User-Agent")
        let mine = cookies.filter { matches($0, target) }
        if !mine.isEmpty { req.setValue(mine.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie") }
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw HTTPError(code: 0) }
        let headers = http.allHeaderFields as? [String: String] ?? [:]
        let fresh = HTTPCookie.cookies(withResponseHeaderFields: headers, for: target)
        if !fresh.isEmpty { await keep(fresh) }
        guard (300..<400).contains(http.statusCode), let loc = headers.first(where: { $0.key.lowercased() == "location" })?.value,
              let next = URL(string: loc, relativeTo: target)?.absoluteURL else { throw LoggedOut() }
        return next
    }

    private func matches(_ c: HTTPCookie, _ u: URL) -> Bool {
        guard let host = u.host?.lowercased() else { return false }
        if c.isSecure && u.scheme != "https" { return false }
        if let exp = c.expiresDate, exp < Date() { return false }
        let d = c.domain.lowercased()
        let domainOK = d.hasPrefix(".") ? (host == String(d.dropFirst()) || host.hasSuffix(d)) : host == d
        return domainOK && u.path.hasPrefix(c.path.isEmpty ? "/" : c.path)
    }

    private func keep(_ fresh: [HTTPCookie]) async {
        for c in fresh {
            cookies.removeAll { $0.name == c.name && $0.domain == c.domain && $0.path == c.path }
            cookies.append(c)
        }
        for c in fresh { await Self.cookieStore().setCookie(c) }
    }

    /* sessiecookies van het portaal én van de inlog van Microsoft een vervaldatum geven, zodat je na het sluiten van de app
       ingelogd blijft. Android bewaart sessiecookies vanzelf; iOS gooit ze weg als de app stopt. Was de sessie van het
       portaal dan verlopen, dan kende Microsoft je ook niet meer en moest je elke keer opnieuw inloggen. */
    static let keepHosts = [WebViewController.portalHost, "login.microsoftonline.com", "login.microsoft.com", "login.live.com", "login.windows.net"]

    /* hoort deze cookie bij een van de hosts hierboven? Let op: Microsoft zet zijn inlogcookies op ".login.microsoftonline.com"
       (met een punt ervoor); die moeten ook meetellen, anders gooit iOS ze weg en moet je steeds opnieuw inloggen.
       Ook subdomeinen (bijv. device.login.microsoftonline.com) en een bredere cookie (".ichthuscollege.nl") tellen mee. */
    static func shouldKeep(_ c: HTTPCookie) -> Bool {
        let d = c.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if d.isEmpty { return false }
        return keepHosts.contains { h in h == d || h.hasSuffix("." + d) || d.hasSuffix("." + h) }
    }

    static func persistCookies() async {
        let all = await cookieStore().allCookies()
        let keep = shouldKeep
        for c in all where c.expiresDate == nil && keep(c) {
            var p = c.properties ?? [:]
            p[.expires] = Date().addingTimeInterval(30 * 86400)
            p.removeValue(forKey: .discard)
            if let n = HTTPCookie(properties: p) { await cookieStore().setCookie(n) }
        }
    }
}

/* doorverwijzingen niet volgen: dat doen we zelf, met de cookies erbij */
final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ s: URLSession, task: URLSessionTask, willPerformHTTPRedirection r: HTTPURLResponse, newRequest: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/* HTML-hulpjes, zoals onderaan GradeChecker.java */
enum HTML {
    static func groups(_ pattern: String, _ s: String) -> [[String]] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = s as NSString
        return re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
        }
    }

    static func replace(_ s: String, _ pattern: String, _ with: String) -> String {
        s.replacingOccurrences(of: pattern, with: with, options: .regularExpression)
    }

    static func unescape(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'").replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    static func text(_ html: String) -> String {
        var s = replace(html, "(?i)<br\\s*/?>|</p>|</li>", "\n")
        s = replace(s, "(?s)<[^>]+>", " ")
        s = unescape(s).replacingOccurrences(of: "\u{00A0}", with: " ")
        s = replace(s, "[ \\t\\x0B\\f\\r]+", " ")
        return replace(s, " *\n[ \n]*", "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func fields(_ html: String) -> [String: String] {
        var f: [String: String] = [:]
        for g in groups("<td>(?:<strong>)?([^<:]+?)(?:</strong>)?(?:</u>)?</td>\\s*<td>:</td>\\s*<td>(?:<strong>)?([^<]*)", html) {
            f[g[1].trimmingCharacters(in: .whitespaces)] = g[2].trimmingCharacters(in: .whitespaces)
        }
        return f
    }

    /* het stuk HTML van een portlet (vanaf de class tot de volgende portlet) */
    static func section(_ html: String, _ cls: String) -> String {
        guard let i = html.range(of: cls) else { return "" }
        guard let j = html.range(of: "objectWrapper", range: i.upperBound..<html.endIndex) else { return String(html[i.lowerBound...]) }
        return String(html[i.lowerBound..<j.lowerBound])
    }

    static func between(_ s: String, _ start: String, _ end: String) -> String? {
        guard let i = s.range(of: start) else { return nil }
        guard let j = s.range(of: end, range: i.upperBound..<s.endIndex) else { return String(s[i.lowerBound...]) }
        return String(s[i.lowerBound..<j.upperBound])
    }

    static func attr(_ attrs: String, _ name: String) -> String {
        groups(name + "=\"([^\"]*)\"", attrs).first?[1].trimmingCharacters(in: .whitespaces) ?? ""
    }

    static func tdByClass(_ row: String, _ cls: String) -> String {
        for g in groups("(?s)<td([^>]*)>(.*?)</td>", row) where (" " + attr(g[1], "class") + " ").contains(" " + cls + " ") { return text(g[2]) }
        return ""
    }
}
