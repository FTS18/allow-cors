# allow cors - access-control-allow-origin

lightweight manifest v3 chrome extension to modify request/response headers, bypass cors rules, strip security settings, and configure custom redirects during local web development.

---

## directory structure

*   `manifest.json`: registers MV3 background worker, content scripts, permissions (alarms, storage, tabs, declarativeNetRequest, webRequest), and actions popup.
*   `background.js`: handles dynamic rules compilation, origin reflection, counter tracking, and alarms execution.
*   `content.js`: listens to changes in storage and dynamically injects `data-smart-cors-extension` on target pages.
*   `popup.html` / `popup.js`: flat, monospace, lowercase developer dashboard.
*   `welcome.html`: onboarding page displayed on install.
*   `icon.png`: flat custom overlapping-circles icon.
*   `site/`: static landing page containing documentation.

---

## configurations

### 1. cors bypass & credentials reflection
when requests utilize `credentials: 'include'` (such as sharing cookies or auth tokens), browsers block wildcard origins (`*`):
`Access-Control-Allow-Origin must not be the wildcard '*' when the request's credentials mode is 'include'.`

to solve this, allow cors resolves the origin of the active browser tab (e.g. `http://localhost:3000` or `https://app.vercel.app`) and dynamically sets it as the exact response origin header alongside `Access-Control-Allow-Credentials: true`.

### 2. url redirection mapping
redirect remote api resources or script payloads to local files to mock assets during testing.
*   from: uses urlFilter patterns (e.g. `*zoologyfibre.com/watch*` or `*analytics*/*.js`)
*   to: targets the redirection destination (e.g. `http://localhost:3000/mock.js`)

redirect rules take priority over header modification rules and intercept matched traffic natively.

### 3. security timers (auto-disable)
leaving a cors bypass active globally is a security vulnerability. malicious sites open in other tabs could exploit exposed APIs using cross-site request forgery (csrf) or cross-site scripting (xss).

to protect your browser, choose a duration (1m, 10m, 30m, 1h) in the popup. the service worker schedules a system wakeup tick using `chrome.alarms` to automatically disable rules execution when the timer expires.

### 4. header stripping
*   csp: removes `content-security-policy`, `content-security-policy-report-only`, `x-webkit-csp`, and `x-content-security-policy` response headers.
*   x-frame: removes `x-frame-options` and `frame-options` response headers to allow embedding resources inside cross-origin iframes.
*   referer/origin: removes `referer` and `origin` request headers to query strict backends that validate source origins.

### 5. sharedarraybuffer
appends COOP (`Cross-Origin-Opener-Policy: same-origin`) and COEP (`Cross-Origin-Embedder-Policy: require-corp`) response headers to documents to enable cross-origin isolation, allowing multithreaded webassembly execution.

---

## setup

1.  clone: `git clone https://github.com/FTS18/allow-cors.git`
2.  go to `chrome://extensions/` in google chrome.
3.  turn on developer mode (top right toggle).
4.  click load unpacked and select the cloned directory.
