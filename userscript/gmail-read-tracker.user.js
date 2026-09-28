// ==UserScript==
// @name         Gmail Read Tracker
// @description  Adds a tracking pixel to emails sent from Gmail and shows when they are opened.
// @version      1.0.0
// @match        https://mail.google.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @inject-into  content
// ==/UserScript==

(function () {
  "use strict";

  // ---- Configuration -------------------------------------------------------
  const WORKER_URL = "https://mailtrack.YOUR-SUBDOMAIN.workers.dev"; // no trailing slash
  const API_KEY = "PASTE-YOUR-API-KEY";
  const POLL_MS = 60_000;
  // --------------------------------------------------------------------------

  const WORKER_HOST = new URL(WORKER_URL).host;
  const BODY_SEL = 'div[contenteditable="true"][g_editable="true"], div[contenteditable="true"][aria-label="Message Body"]';

  const composeState = new WeakMap(); // compose root -> { enabled, pixelId, registered }

  // ---- Network ---------------------------------------------------------------
  const gmXhr =
    (typeof GM !== "undefined" && GM.xmlHttpRequest) ||
    (typeof GM_xmlhttpRequest !== "undefined" && GM_xmlhttpRequest);

  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      if (!gmXhr) return reject(new Error("GM.xmlHttpRequest unavailable"));
      gmXhr({
        method,
        url: WORKER_URL + path,
        headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) {
            try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
          } else reject(new Error("HTTP " + r.status));
        },
        onerror: reject,
      });
    });
  }

  // ---- Compose helpers -------------------------------------------------------
  function isSendButton(el) {
    if (!el || el.getAttribute("role") !== "button") return false;
    const label = (el.getAttribute("data-tooltip") || el.getAttribute("aria-label") || "").trim();
    return /^Send\b/.test(label) || el.classList.contains("aoO");
  }

  function findSendButton(target) {
    let el = target instanceof Element ? target : null;
    while (el && el !== document.body) {
      if (isSendButton(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Nearest ancestor containing both a message body and a Send button: the compose window / inline reply.
  function findComposeRoot(from) {
    let el = from;
    while (el && el !== document.body) {
      if (el.querySelector(BODY_SEL) && (isSendButton(from) || [...el.querySelectorAll('[role="button"]')].some(isSendButton))) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function stateFor(root) {
    let s = composeState.get(root);
    if (!s) {
      s = { enabled: true, pixelId: null, registered: false };
      composeState.set(root, s);
    }
    return s;
  }

  function getRecipients(root, body) {
    const out = new Set();
    root.querySelectorAll("[email], [data-hovercard-id]").forEach((n) => {
      if (body.contains(n)) return;
      const v = n.getAttribute("email") || n.getAttribute("data-hovercard-id") || "";
      if (v.includes("@")) out.add(v.trim());
    });
    return [...out];
  }

  function getSubject(root) {
    const input = root.querySelector('input[name="subjectbox"]');
    if (input && input.value) return input.value;
    const h = document.querySelector("h2[data-thread-perm-id], h2.hP");
    return h ? h.textContent.trim() : "";
  }

  function ensurePixel(root) {
    const s = stateFor(root);
    const body = root.querySelector(BODY_SEL);
    if (!s.enabled || !body) return null;
    if (s.pixelId && body.querySelector('img[src*="' + s.pixelId + '"]')) return s;

    s.pixelId = crypto.randomUUID();
    s.registered = false;
    const img = document.createElement("img");
    img.setAttribute("src", WORKER_URL + "/p/" + s.pixelId + ".gif");
    img.setAttribute("width", "1");
    img.setAttribute("height", "1");
    img.setAttribute("alt", "");
    img.setAttribute("style", "width:1px;height:1px;border:0;");
    body.appendChild(img);
    return s;
  }

  function trackSend(root) {
    const s = ensurePixel(root);
    if (!s || s.registered) return;
    s.registered = true;
    const body = root.querySelector(BODY_SEL);
    const payload = { id: s.pixelId, recipients: getRecipients(root, body), subject: getSubject(root) };
    api("POST", "/api/track", payload)
      .then(() => setTimeout(refresh, 15_000))
      .catch((e) => console.warn("[read-tracker] failed to register email", e));
  }

  // Capture phase so we run before Gmail's own handlers read the body.
  function onPointerDown(e) {
    const btn = findSendButton(e.target);
    if (!btn) return;
    const root = findComposeRoot(btn);
    if (root) ensurePixel(root);
  }

  function onClick(e) {
    const btn = findSendButton(e.target);
    if (!btn) return;
    const root = findComposeRoot(btn);
    if (root) trackSend(root);
  }

  function onKeyDown(e) {
    const isShortcut = e.key === "Enter" && (e.metaKey || e.ctrlKey);
    const isButtonActivate = (e.key === "Enter" || e.key === " ") && findSendButton(e.target);
    if (!isShortcut && !isButtonActivate) return;
    const root = findComposeRoot(e.target instanceof Element ? e.target : null);
    if (root) trackSend(root);
  }

  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  // ---- Per-compose toggle chip ----------------------------------------------
  const chipped = new WeakSet();

  function addToggle(sendBtn) {
    if (chipped.has(sendBtn)) return;
    chipped.add(sendBtn);
    const root = findComposeRoot(sendBtn);
    if (!root) return;
    const s = stateFor(root);

    const chip = document.createElement("span");
    chip.setAttribute("title", "Toggle read tracking for this email");
    chip.style.cssText =
      "display:inline-flex;align-items:center;margin-left:8px;padding:2px 8px;border-radius:12px;" +
      "font:12px/18px -apple-system,sans-serif;cursor:pointer;user-select:none;vertical-align:middle;";
    const paint = () => {
      chip.textContent = s.enabled ? "\u{1F441} Tracking" : "\u{1F441} Off";
      chip.style.background = s.enabled ? "#e6f4ea" : "#f1f3f4";
      chip.style.color = s.enabled ? "#137333" : "#5f6368";
    };
    paint();
    chip.addEventListener("mousedown", (e) => e.stopPropagation(), true);
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      s.enabled = !s.enabled;
      if (!s.enabled && s.pixelId) {
        const body = root.querySelector(BODY_SEL);
        body && body.querySelectorAll('img[src*="' + s.pixelId + '"]').forEach((n) => n.remove());
        s.pixelId = null;
      }
      paint();
    });

    const container = sendBtn.parentElement;
    if (container) container.insertBefore(chip, sendBtn.nextSibling);
  }

  // ---- Keep our own views from counting as opens ----------------------------
  function neutralize(img) {
    const src = img.getAttribute("src") || "";
    if (!src.toLowerCase().includes(WORKER_HOST)) return;
    // Keep the pixel we just inserted into a compose body (direct URL, not Gmail-proxied).
    if (src.startsWith(WORKER_URL + "/p/") && img.closest('[contenteditable="true"]')) return;
    img.removeAttribute("src");
    img.removeAttribute("srcset");
    img.remove();
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === "IMG") neutralize(node);
    else {
      node.querySelectorAll('img[src*="' + WORKER_HOST + '" i]').forEach(neutralize);
      if (isSendButton(node)) addToggle(node);
      node.querySelectorAll('[role="button"][data-tooltip^="Send"], [role="button"].aoO').forEach(addToggle);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") {
        if (m.target.tagName === "IMG") neutralize(m.target);
      } else m.addedNodes.forEach(scan);
    }
  });

  function startObserver() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
    if (document.body) scan(document.body);
  }
  startObserver();

  // ---- Floating status panel -------------------------------------------------
  let emails = [];
  const seenOpens = loadSeen();
  let panelOpen = false;
  let ui = null;

  function loadSeen() {
    try { return JSON.parse(localStorage.getItem("mailtrack_seen") || "{}"); } catch { return {}; }
  }
  function saveSeen() {
    try { localStorage.setItem("mailtrack_seen", JSON.stringify(seenOpens)); } catch {}
  }

  function ago(ts) {
    if (!ts) return "";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.round(h / 24);
    return d < 30 ? d + "d ago" : new Date(ts).toLocaleDateString();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildUI() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483000;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; }
      .btn { background:#fff; color:#202124; border:1px solid #dadce0; border-radius:16px; padding:6px 12px;
             cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.15); }
      .btn:hover { background:#f8f9fa; }
      .badge { background:#1a73e8; color:#fff; border-radius:8px; padding:0 6px; margin-left:6px; font-size:11px; }
      .panel { position:absolute; left:0; bottom:40px; width:340px; max-height:60vh; overflow:auto; background:#fff;
               color:#202124; border:1px solid #dadce0; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.18); }
      .head { display:flex; justify-content:space-between; align-items:center; padding:10px 12px;
              border-bottom:1px solid #eee; font-weight:600; }
      .head a { color:#1a73e8; text-decoration:none; font-weight:400; }
      .row { padding:8px 12px; border-bottom:1px solid #f1f3f4; }
      .row:last-child { border-bottom:0; }
      .subj { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .to { color:#5f6368; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .st { font-size:12px; margin-top:2px; }
      .read { color:#188038; font-weight:600; }
      .unread { color:#80868b; }
      .empty, .err { padding:12px; color:#5f6368; }
      @media (prefers-color-scheme: dark) {
        .btn, .panel { background:#2d2e30; color:#e8eaed; border-color:#5f6368; }
        .btn:hover { background:#3c4043; }
        .head, .row { border-color:#3c4043; }
        .to, .unread, .empty, .err { color:#9aa0a6; }
        .read { color:#81c995; }
      }`;
    const btn = el("button", "btn", "\u{1F441} Tracked");
    const badge = el("span", "badge");
    badge.style.display = "none";
    btn.appendChild(badge);
    const panel = el("div", "panel");
    panel.style.display = "none";
    btn.addEventListener("click", () => {
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? "block" : "none";
      if (panelOpen) {
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
        markAllSeen();
        refresh();
      }
    });
    shadow.append(style, panel, btn);
    document.body.appendChild(host);
    return { btn, badge, panel };
  }

  function unseenCount() {
    return emails.filter((e) => e.open_count > (seenOpens[e.id] || 0)).length;
  }

  function markAllSeen() {
    emails.forEach((e) => (seenOpens[e.id] = e.open_count));
    saveSeen();
    renderUI();
  }

  function renderUI(error) {
    if (!document.body) return;
    if (!ui) ui = buildUI();
    const n = unseenCount();
    ui.badge.textContent = String(n);
    ui.badge.style.display = n ? "inline" : "none";

    const panel = ui.panel;
    panel.replaceChildren();
    const head = el("div", "head", "Tracked emails");
    const link = el("a", null, "Dashboard ↗");
    link.href = WORKER_URL + "/";
    link.target = "_blank";
    head.appendChild(link);
    panel.appendChild(head);
    if (error) panel.appendChild(el("div", "err", "Couldn't reach tracker: " + error));
    else if (!emails.length) panel.appendChild(el("div", "empty", "No tracked emails yet."));
    emails.slice(0, 20).forEach((e) => {
      const row = el("div", "row");
      row.appendChild(el("div", "subj", e.subject || "(no subject)"));
      row.appendChild(el("div", "to", e.recipients || ""));
      const read = e.open_count > 0;
      const st = el(
        "div",
        "st " + (read ? "read" : "unread"),
        read
          ? "✓✓ Opened " + ago(e.last_open) + (e.open_count > 1 ? " · " + e.open_count + "×" : "")
          : "✓ Sent " + ago(e.sent_at),
      );
      if (read) st.title = "First opened " + new Date(e.first_open).toLocaleString();
      row.appendChild(st);
      panel.appendChild(row);
    });
  }

  function notifyNewOpens(prev) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    emails.forEach((e) => {
      const before = prev.get(e.id);
      if (before !== undefined && e.open_count > before) {
        new Notification("Email opened", {
          body: (e.subject || "(no subject)") + (e.recipients ? " — " + e.recipients : ""),
          tag: "mailtrack-" + e.id,
        });
      }
    });
  }

  let refreshing = false;
  function refresh() {
    if (refreshing) return;
    refreshing = true;
    const prev = new Map(emails.map((e) => [e.id, e.open_count]));
    api("GET", "/api/emails?limit=50")
      .then((rows) => {
        const first = !emails.length && !prev.size;
        emails = rows;
        if (!first) notifyNewOpens(prev);
        if (panelOpen) markAllSeen();
        else renderUI();
      })
      .catch((e) => renderUI(e.message || "network error"))
      .finally(() => (refreshing = false));
  }

  function boot() {
    renderUI();
    refresh();
    setInterval(refresh, POLL_MS);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
