// Served at GET /. Plain JS only (no template literals) since this lives inside a TS template string.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mail Tracker</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2328; --muted: #6b7280; --line: #e5e7eb;
    --read: #16a34a; --unread: #9ca3af; --accent: #2563eb; --row: #f9fafb;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111316; --fg: #e6e8eb; --muted: #9aa1ab; --line: #2a2f36;
      --read: #4ade80; --unread: #6b7280; --accent: #60a5fa; --row: #171a1f;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: var(--muted); }
  button { font: inherit; border: 1px solid var(--line); background: transparent; color: var(--fg);
           border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  tr:hover td { background: var(--row); }
  .status { white-space: nowrap; font-weight: 600; }
  .read { color: var(--read); }
  .unread { color: var(--unread); }
  .subject { font-weight: 500; overflow-wrap: anywhere; }
  .to { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  #login { max-width: 360px; margin: 80px auto; display: none; }
  #login input { width: 100%; padding: 8px; font: inherit; border: 1px solid var(--line); border-radius: 6px;
                 background: var(--bg); color: var(--fg); margin: 8px 0; }
  @media (max-width: 640px) { .hide-sm { display: none; } }
</style>
</head>
<body>
<div id="login">
  <h1>Mail Tracker</h1>
  <p class="muted">Enter your API key.</p>
  <input id="key" type="password" autocomplete="current-password">
  <button id="save">Continue</button>
</div>
<main id="app" style="display:none">
  <header>
    <h1>Mail Tracker</h1>
    <div><span id="updated" class="muted"></span> <button id="refresh">Refresh</button> <button id="logout">Log out</button></div>
  </header>
  <table>
    <thead><tr><th>Status</th><th>Email</th><th class="hide-sm">Sent</th><th class="hide-sm">Last open</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <p id="empty" class="muted" style="display:none">No tracked emails yet.</p>
</main>
<script>
  var KEY_NAME = "mailtrack_api_key";
  function getKey() { try { return localStorage.getItem(KEY_NAME); } catch (e) { return null; } }
  function setKey(v) { try { v ? localStorage.setItem(KEY_NAME, v) : localStorage.removeItem(KEY_NAME); } catch (e) {} }
  var memKey = getKey();

  function ago(ts) {
    if (!ts) return "";
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    var m = Math.round(s / 60); if (m < 60) return m + "m ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    var d = Math.round(h / 24); if (d < 30) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = { Authorization: "Bearer " + memKey };
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { showLogin(); throw new Error("unauthorized"); }
      return r.json();
    });
  }
  function showLogin() {
    document.getElementById("app").style.display = "none";
    document.getElementById("login").style.display = "block";
  }
  function render(rows) {
    var tbody = document.getElementById("rows");
    tbody.replaceChildren();
    document.getElementById("empty").style.display = rows.length ? "none" : "block";
    rows.forEach(function (r) {
      var tr = el("tr");
      var read = r.open_count > 0;
      var st = el("td", "status " + (read ? "read" : "unread"),
        read ? "\\u2713\\u2713 Opened" + (r.open_count > 1 ? " \\u00d7" + r.open_count : "") : "\\u2713 Sent");
      st.title = read ? "First opened " + new Date(r.first_open).toLocaleString() : "Not opened yet";
      var info = el("td");
      info.appendChild(el("div", "subject", r.subject || "(no subject)"));
      info.appendChild(el("div", "to", r.recipients || ""));
      var sent = el("td", "hide-sm muted", ago(r.sent_at)); sent.title = new Date(r.sent_at).toLocaleString();
      var last = el("td", "hide-sm muted", ago(r.last_open));
      if (r.last_open) last.title = new Date(r.last_open).toLocaleString();
      var act = el("td");
      var del = el("button", null, "Delete");
      del.onclick = function () {
        if (!confirm("Stop tracking and delete this email's history?")) return;
        api("/api/emails/" + r.id, { method: "DELETE" }).then(load);
      };
      act.appendChild(del);
      [st, info, sent, last, act].forEach(function (c) { tr.appendChild(c); });
      tbody.appendChild(tr);
    });
    document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString();
  }
  function load() {
    if (!memKey) return showLogin();
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "block";
    api("/api/emails?limit=200").then(render).catch(function () {});
  }
  document.getElementById("save").onclick = function () {
    memKey = document.getElementById("key").value.trim();
    setKey(memKey);
    load();
  };
  document.getElementById("key").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("save").click(); };
  document.getElementById("refresh").onclick = load;
  document.getElementById("logout").onclick = function () { memKey = null; setKey(null); showLogin(); };
  setInterval(function () { if (memKey && document.visibilityState === "visible") load(); }, 60000);
  load();
</script>
</body>
</html>`;
