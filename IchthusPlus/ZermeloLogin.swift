import UIKit
import WebKit

/*
 Zermelo koppelen met je schoolaccount, zoals op Android: de Zermelo-webapp openen, inloggen, en zodra die zijn
 toegangssleutel in localStorage ("activeToken") zet, lezen we hem uit en sluit het venster vanzelf.
 silent: zonder venster (om een verlopen login stil te vernieuwen); lukt dat niet binnen 25 s, dan stoppen we.
 */
final class ZermeloLogin: NSObject, WKNavigationDelegate {
    static let tokenJS = "(function(){var t='';try{t=localStorage.getItem('activeToken')||'';}catch(e){return '';}"
        + "try{var v=JSON.parse(t);if(typeof v==='string')return v;if(v&&typeof v==='object')return v.access_token||v.token||'';}catch(e){}return t;})()"

    weak var host: WebViewController?
    let url: URL
    let silent: Bool
    let web: WKWebView
    private var box: UIView?
    private var timer: Timer?
    private var handled = false
    private let prev: String?
    var visible: Bool { box != nil && !silent }

    static func start(_ host: WebViewController, url: URL, silent: Bool) {
        host.zermelo?.close(nil)
        let z = ZermeloLogin(host: host, url: url, silent: silent)
        host.zermelo = z
        z.begin()
    }

    private init(host: WebViewController, url: URL, silent: Bool) {
        self.host = host
        self.url = url
        self.silent = silent
        prev = silent ? Prefs.string("zm_token") : nil
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default() // dezelfde inlog als het portaal (Microsoft), dus vaak meteen klaar
        // ook hier: op de inlogpagina van Microsoft geen logo van school en de algemene voorbeeldtekst
        cfg.userContentController.addUserScript(WKUserScript(source: WebViewController.loginCSS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        web.navigationDelegate = self
    }

    private func begin() {
        guard let host = host else { return }
        let b = UIView()
        b.translatesAutoresizingMaskIntoConstraints = false
        b.backgroundColor = .white
        host.view.addSubview(b)
        NSLayoutConstraint.activate([
            b.topAnchor.constraint(equalTo: host.view.topAnchor), b.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
            b.leadingAnchor.constraint(equalTo: host.view.leadingAnchor), b.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
        ])
        web.translatesAutoresizingMaskIntoConstraints = false
        b.addSubview(web)
        if silent {
            // onzichtbaar, maar wel in beeld: anders zet iOS de pagina stil
            b.alpha = 0.01
            b.isUserInteractionEnabled = false
            NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: b.topAnchor), web.bottomAnchor.constraint(equalTo: b.bottomAnchor),
                                         web.leadingAnchor.constraint(equalTo: b.leadingAnchor), web.trailingAnchor.constraint(equalTo: b.trailingAnchor)])
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
                guard let self = self, !self.handled, self.host?.zermelo === self else { return }
                self.close("Opnieuw inloggen bij Zermelo lukte niet vanzelf. Koppel opnieuw in Meer.")
            }
        } else {
            // balkje met Annuleren (Android heeft daar de terugknop voor)
            let bar = UIView()
            bar.translatesAutoresizingMaskIntoConstraints = false
            let cancel = UIButton(type: .system)
            cancel.setTitle("Annuleren", for: .normal)
            cancel.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
            cancel.translatesAutoresizingMaskIntoConstraints = false
            let title = UILabel()
            title.text = "Inloggen bij Zermelo"
            title.font = .systemFont(ofSize: 17, weight: .bold)
            title.textColor = .black
            title.translatesAutoresizingMaskIntoConstraints = false
            bar.addSubview(cancel)
            bar.addSubview(title)
            b.addSubview(bar)
            NSLayoutConstraint.activate([
                bar.topAnchor.constraint(equalTo: b.safeAreaLayoutGuide.topAnchor), bar.leadingAnchor.constraint(equalTo: b.leadingAnchor),
                bar.trailingAnchor.constraint(equalTo: b.trailingAnchor), bar.heightAnchor.constraint(equalToConstant: 48),
                cancel.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16), cancel.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
                title.centerXAnchor.constraint(equalTo: bar.centerXAnchor), title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
                web.topAnchor.constraint(equalTo: bar.bottomAnchor), web.bottomAnchor.constraint(equalTo: b.bottomAnchor),
                web.leadingAnchor.constraint(equalTo: b.leadingAnchor), web.trailingAnchor.constraint(equalTo: b.trailingAnchor),
            ])
        }
        box = b
        web.load(URLRequest(url: url))
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.poll() }
    }

    @objc private func cancelTapped() { cancel() }
    func cancel() { close("Inloggen bij Zermelo geannuleerd.") }

    /* elke seconde: staan we al in de Zermelo-webapp en heeft die een sleutel? */
    private func poll() {
        guard !handled, let u = web.url, let h = u.host?.lowercased(), h.hasSuffix(".zportal.nl"), u.path.hasPrefix("/app") else { return }
        web.evaluateJavaScript(Self.tokenJS) { [weak self] res, _ in
            guard let self = self, !self.handled, self.host?.zermelo === self else { return }
            let token = (res as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard token.range(of: "^[A-Za-z0-9._-]{10,}$", options: .regularExpression) != nil else { return }
            // bij stil vernieuwen: alleen een andere sleutel dan we al hadden telt
            if self.silent && token == self.prev { return }
            self.handled = true
            let school = String(h.prefix(while: { $0 != "." }))
            self.close(nil)
            Self.link(school: school, token: token, url: self.url, host: self.host)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = action.request.url?.scheme?.lowercased() ?? ""
        decisionHandler(["http", "https", "about", "data", "blob"].contains(scheme) ? .allow : .cancel)
    }

    func close(_ cancelMsg: String?) {
        timer?.invalidate()
        timer = nil
        web.stopLoading()
        box?.removeFromSuperview()
        box = nil
        if host?.zermelo === self { host?.zermelo = nil }
        if let m = cancelMsg { Self.failed(m, host: host) }
    }

    /* sleutel controleren met users/~me en dan opslaan voor de app */
    static func link(school: String, token: String, url: URL, host: WebViewController?) {
        var c = URLComponents(string: "https://\(school).zportal.nl/api/v3/users/~me")!
        c.queryItems = [URLQueryItem(name: "access_token", value: token)]
        var req = URLRequest(url: c.url!)
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { _, resp, err in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard err == nil, code == 200 else {
                return failed(err != nil ? "Inloggen bij Zermelo lukte niet: geen verbinding." : "Inloggen bij Zermelo lukte niet: Zermelo accepteerde de login niet (\(code))", host: host)
            }
            Prefs.set("zm_school", school)
            Prefs.set("zm_token", token)
            Prefs.set("zm_sso", true)
            Prefs.set("zm_url", url.absoluteString)
            let s = school.filter { $0.isLetter || $0.isNumber || $0 == "-" }
            host?.js("window.__cpZmLinked && window.__cpZmLinked('\(s)','\(token)','sso')")
        }.resume()
    }

    static func failed(_ msg: String, host: WebViewController?) {
        let safe = msg.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: "’").replacingOccurrences(of: "\n", with: " ")
        host?.js("window.__cpZmFailed && window.__cpZmFailed('\(safe)')")
    }
}
