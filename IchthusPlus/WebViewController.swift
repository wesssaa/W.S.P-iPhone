import UIKit
import WebKit

/* Hetzelfde idee als MainActivity op Android: het portaal laden, app.js erin zetten en het portaal zelf verbergen. */
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    nonisolated static let portalHost = "leerlingen.ichthuscollege.nl"
    nonisolated static let startURL = URL(string: "https://\(portalHost)/portaal/mijn_info/cijfers_en_examendossier")!
    nonisolated static let shellURL = URL(string: "https://\(portalHost)/portaal/ichthusplus")!

    var web: WKWebView!
    var bridge: Bridge!
    var zermelo: ZermeloLogin?
    private var currentURL: URL?

    override var preferredStatusBarStyle: UIStatusBarStyle { Prefs.theme == "dark" ? .lightContent : .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.background()
        bridge = Bridge(controller: self)

        // het visje (zoals het opstartscherm) zolang de app nog laadt
        let mark = UIImageView(image: UIImage(named: "LaunchMark"))
        mark.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(mark)
        NSLayoutConstraint.activate([mark.centerXAnchor.constraint(equalTo: view.centerXAnchor), mark.centerYAnchor.constraint(equalTo: view.centerYAnchor)])

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.mediaTypesRequiringUserActionForPlayback = .all
        let uc = cfg.userContentController
        uc.addUserScript(WKUserScript(source: Bridge.shimJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        uc.addUserScript(WKUserScript(source: Self.appScript(), injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        uc.add(WeakHandler(self), name: "cpReady")
        uc.add(WeakHandler(self), name: "cpRetry")

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = Theme.background()
        web.alpha = 0 // tot de app klaar is zie je het opstartscherm, niet het portaal
        // de pagina zelf mag niet scrollen of zoomen: alleen de lijsten in de app scrollen
        web.scrollView.bounces = false
        web.scrollView.isScrollEnabled = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // terugvegen vanaf de linkerrand = de terugknop van Android
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeBack(_:)))
        edge.edges = .left
        view.addGestureRecognizer(edge)

        start()
    }

    /* al eens ingelogd: meteen de app in een lege pagina op het adres van het portaal (zelfde cookies en opslag).
       Is de sessie verlopen, dan laadt de app zelf het echte portaal. */
    func start() {
        #if DEMO
        // alleen de simulator-build (Appetize): voorbeeldgegevens in plaats van het portaal, zonder in te loggen
        if let u = Bundle.main.resourceURL?.appendingPathComponent("web/demo.html"), let html = try? String(contentsOf: u, encoding: .utf8) {
            web.loadHTMLString(html, baseURL: Self.shellURL)
            return
        }
        #endif
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let loggedIn = cookies.contains { Self.portalHost.hasSuffix($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
            DispatchQueue.main.async {
                if loggedIn {
                    self.web.loadHTMLString("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1'></head><body></body></html>", baseURL: Self.shellURL)
                } else {
                    self.web.load(URLRequest(url: Self.startURL))
                }
            }
        }
    }

    func loadStart() { web.load(URLRequest(url: Self.startURL)) }

    static func isPortal(_ url: URL?) -> Bool {
        guard let u = url, u.host?.lowercased() == portalHost else { return false }
        return !u.path.hasPrefix("/oidc")
    }

    /* app.js met de plaatjes en lettertypes als data-URL ervoor (WKWebView kan /__ichthusplus/ niet onderscheppen) */
    static func appScript() -> String {
        let base = Bundle.main.resourceURL!.appendingPathComponent("web")
        let js = (try? String(contentsOf: base.appendingPathComponent("app.js"), encoding: .utf8)) ?? ""
        var assets: [String: String] = [:]
        let types = ["woff2": "font/woff2", "png": "image/png", "svg": "image/svg+xml", "mp3": "audio/mpeg"]
        for dir in ["fonts", "themes"] {
            let files = (try? FileManager.default.contentsOfDirectory(atPath: base.appendingPathComponent(dir).path)) ?? []
            for f in files {
                guard let mime = types[(f as NSString).pathExtension.lowercased()],
                      let data = try? Data(contentsOf: base.appendingPathComponent(dir).appendingPathComponent(f)) else { continue }
                assets["\(dir)/\(f)"] = "data:\(mime);base64,\(data.base64EncodedString())"
            }
        }
        let map = (try? JSONSerialization.data(withJSONObject: assets)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        if (location.hostname === '\(portalHost)' && location.pathname.indexOf('/oidc') !== 0) {
          window.__cpPlatform = 'ios';
          window.__cpAssets = \(map);
          if (location.pathname.indexOf('/portaal/ichthusplus') === 0) window.__cpShell = true;
          \(js)
          ;try { window.webkit.messageHandlers.cpReady.postMessage(1); } catch (e) {}
        }
        """
    }

    // MARK: - zichtbaar maken

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "cpRetry" { web.alpha = 0; start(); return }
        guard message.name == "cpReady", Self.isPortal(message.frameInfo.request.url ?? web.url) || web.url == Self.shellURL else { return }
        // wat je in de app al ziet, hoeft later geen melding meer te geven; meteen ook de sessie vasthouden
        Task.detached { try? await Checker.runAll(notify: false) }
        NSLog("Ichthus+ opstarttijd: %d ms tot de app klaar is", Int(Date().timeIntervalSince(AppDelegate.launched) * 1000))
        // zacht overvloeien van het opstartscherm naar de app
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) {
            UIView.animate(withDuration: 0.22) { self.web.alpha = 1 }
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        currentURL = webView.url
        webView.layer.removeAllAnimations()
        webView.alpha = 0
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let url = webView.url
        currentURL = url
        if Self.isPortal(url) || url == Self.shellURL { return }
        // een inlogpagina pas laten zien als hij blijft staan (dus echt iets van je vraagt), niet als hij meteen doorstuurt
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            if self.web.url == url && !webView.isLoading { webView.alpha = 1 }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.allow) }
        if ["http", "https", "about", "data", "blob"].contains(scheme) { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    /* links die een nieuw venster willen: gewoon in hetzelfde venster openen (zoals op Android) */
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    /* laden mislukt (geen internet, of een beveiligde verbinding die niet lukt): niet op het visje blijven hangen */
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loadFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loadFailed(error) }

    private func loadFailed(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return } // gewoon doorgestuurd
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // geen pagina (bijv. een download)
        let why = e.code == NSURLErrorNotConnectedToInternet ? "Je hebt geen internet." :
            [NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate].contains(e.code)
            ? "De beveiligde verbinding met het portaal lukte niet (zit je op een netwerk dat verkeer onderschept?)." : "Het portaal reageert niet."
        let dark = Prefs.theme == "dark"
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:0 28px;
        box-sizing:border-box;font:16px -apple-system,system-ui,sans-serif;text-align:center;background:\(dark ? "#0d0c0a" : "#f3f1ec");color:\(dark ? "#f3f1ec" : "#1a1814")}
        h1{font-size:22px;margin:0}p{margin:0;opacity:.7;line-height:1.45}
        button{margin-top:8px;font:700 16px -apple-system,system-ui;padding:14px 28px;border:0;border-radius:14px;background:#ffd34d;color:#1a1814}</style></head>
        <body><h1>Geen verbinding</h1><p>\(why)</p><p style="font-size:13px">(\(e.code))</p>
        <button onclick="window.webkit.messageHandlers.cpRetry.postMessage(1)">Opnieuw</button></body></html>
        """
        web.loadHTMLString(html, baseURL: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { UIView.animate(withDuration: 0.2) { self.web.alpha = 1 } }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // de webpagina is gestopt (bijv. weinig geheugen): stil opnieuw starten
        webView.alpha = 0
        start()
    }

    // MARK: - brug en dialoogjes

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        if prompt == Bridge.marker {
            // alleen het portaal zelf mag de app aanspreken
            guard frame.isMainFrame, frame.securityOrigin.host.lowercased() == Self.portalHost else { return completionHandler(nil) }
            return completionHandler(bridge.handle(defaultText ?? ""))
        }
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Annuleren", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Annuleren", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    /* JavaScript in de app uitvoeren (altijd los van een lopende brug-aanroep, anders loopt de pagina vast) */
    func js(_ code: String) {
        DispatchQueue.main.async { self.web?.evaluateJavaScript(code, completionHandler: nil) }
    }

    func applyTheme(_ mode: String) {
        UIView.animate(withDuration: 0.2) {
            self.view.backgroundColor = Theme.background(mode)
            self.web.backgroundColor = Theme.background(mode)
        }
        setNeedsStatusBarAppearanceUpdate()
    }

    @objc private func edgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        guard g.state == .recognized else { return }
        if let z = zermelo, z.visible { z.cancel(); return }
        web.evaluateJavaScript("(window.__cpBack && window.__cpBack()) ? 'yes' : 'no'") { res, _ in
            if (res as? String) == "yes" { return }
            if !Self.isPortal(self.web.url) && self.web.canGoBack { self.web.goBack() }
        }
    }
}

/* WKUserContentController houdt zijn handler vast; zo blijft de controller niet eeuwig in het geheugen */
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(uc, didReceive: message)
    }
}
