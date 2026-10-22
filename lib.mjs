// The status page's logic, with no dependencies: reading incidents and
// maintenance from Markdown, working out each service's state, and rendering
// the page. build.mjs writes it out; test/*.test.mjs covers it.

// States, from best to worst. A service shows the worst that applies.
export const STATES = ["operational", "maintenance", "degraded", "partial", "major"];
export const LABELS = {
  operational: "Operational",
  maintenance: "Maintenance",
  degraded: "Degraded",
  partial: "Partial outage",
  major: "Major outage",
};

const worst = (a, b) => (STATES.indexOf(a) >= STATES.indexOf(b) ? a : b);

// parseDoc reads a Markdown file with a front matter block:
//
//   ---
//   title: API errors for some accounts
//   impact: partial
//   services: api, gateway
//   started: 2026-10-22T19:40Z
//   ---
//   ## 2026-10-22T19:45Z Investigating
//   Some calls answer with an error. We're looking into it.
//
// Each "## <time> <status>" heading starts an update; the text under it is
// the update. Text before the first heading is the summary.
export function parseDoc(text, file = "") {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${file}: bad front matter line "${line}"`);
    meta[kv[1]] = kv[2].trim();
  }
  meta.services = (meta.services || "").split(",").map((s) => s.trim()).filter(Boolean);
  const updates = [];
  let summary = [];
  let current = null;
  for (const line of m[2].split("\n")) {
    const h = /^##\s+(\S+)\s+(.+)$/.exec(line);
    if (h) {
      current = { at: time(h[1], file), status: h[2].trim(), body: [] };
      updates.push(current);
    } else {
      (current ? current.body : summary).push(line);
    }
  }
  for (const u of updates) u.body = u.body.join("\n").trim();
  return { ...meta, summary: summary.join("\n").trim(), updates };
}

function time(s, file) {
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) throw new Error(`${file}: "${s}" isn't a time`);
  return t;
}

// incident checks an incident's fields, so a typo fails the build instead of
// showing a wrong page.
export function incident(doc, file, serviceIds) {
  if (!doc.title) throw new Error(`${file}: no title`);
  if (!["degraded", "partial", "major"].includes(doc.impact)) throw new Error(`${file}: impact is degraded, partial or major`);
  if (doc.services.length === 0) throw new Error(`${file}: no services`);
  for (const s of doc.services) if (!serviceIds.includes(s)) throw new Error(`${file}: unknown service "${s}"`);
  const started = time(doc.started, file);
  const resolved = doc.resolved ? time(doc.resolved, file) : null;
  return { file, title: doc.title, impact: doc.impact, services: doc.services, started, resolved, summary: doc.summary, updates: doc.updates };
}

// maintenance checks a maintenance window's fields.
export function maintenance(doc, file, serviceIds) {
  if (!doc.title) throw new Error(`${file}: no title`);
  if (doc.services.length === 0) throw new Error(`${file}: no services`);
  for (const s of doc.services) if (!serviceIds.includes(s)) throw new Error(`${file}: unknown service "${s}"`);
  const starts = time(doc.starts, file);
  const ends = time(doc.ends, file);
  if (ends <= starts) throw new Error(`${file}: ends before it starts`);
  return { file, title: doc.title, services: doc.services, starts, ends, summary: doc.summary };
}

// stateOf is a service's state now: the automatic check (up, degraded or
// down), any open incident on it, and any maintenance under way.
export function stateOf(id, { checks, incidents, windows, now }) {
  let s = "operational";
  const c = checks?.services?.[id]?.state;
  if (c === "degraded") s = worst(s, "degraded");
  if (c === "down") s = worst(s, "major");
  for (const i of incidents) if (!i.resolved && i.services.includes(id)) s = worst(s, i.impact);
  for (const w of windows) if (w.services.includes(id) && w.starts <= now && now < w.ends) s = worst(s, "maintenance");
  return s;
}

export function overall(states) {
  const w = states.reduce(worst, "operational");
  if (w === "operational") return "All services operational";
  if (w === "maintenance") return "Maintenance under way";
  return w === "degraded" ? "Some services degraded" : `${LABELS[w]} on some services`;
}

// esc makes text safe for HTML.
export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// md renders the little Markdown an update needs: paragraphs, "- " lists,
// **bold**, `code` and [links](https://…). Everything else is text.
export function md(text) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      out.push("<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ""))}</li>`).join("") + "</ul>");
    } else {
      out.push(`<p>${inline(lines.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

const when = (t) => t.toISOString().replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC");

function incidentHTML(i, names) {
  const updates = [...i.updates].sort((a, b) => b.at - a.at);
  return `<article class="incident ${i.resolved ? "resolved" : i.impact}">
<h3>${esc(i.title)}</h3>
<p class="meta">${esc(i.services.map((s) => names[s]).join(", "))} · ${LABELS[i.impact]} · started ${when(i.started)}${i.resolved ? ` · resolved ${when(i.resolved)}` : ""}</p>
${i.summary ? md(i.summary) : ""}
${updates.map((u) => `<div class="update"><p class="meta"><strong>${esc(u.status)}</strong> · ${when(u.at)}</p>${md(u.body)}</div>`).join("\n")}
</article>`;
}

// page renders the whole page. now is the build's time; a small script in
// the page applies maintenance windows again as the reader's clock passes
// them, since the page is static.
export function page({ services, checks, incidents, windows, now }) {
  const names = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const states = services.map((s) => stateOf(s.id, { checks, incidents, windows, now }));
  const open = incidents.filter((i) => !i.resolved).sort((a, b) => b.started - a.started);
  const past = incidents.filter((i) => i.resolved).sort((a, b) => b.started - a.started);
  const upcoming = windows.filter((w) => w.ends > now).sort((a, b) => a.starts - b.starts);
  const worstState = states.reduce(worst, "operational");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KIFF status</title>
<meta name="description" content="The status of KIFF's API, gateway, planque and the tafs service.">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
<header>
<p class="brand"><a href="https://kiff.dev">kiff.dev</a> status</p>
<h1 class="banner ${worstState}">${esc(overall(states))}</h1>
<p class="note">Checked every 5 minutes from outside KIFF's hosting. Incidents and maintenance are posted by the KIFF team. Our commitments are in the <a href="https://kiff.dev/legal/sla">service-level agreement</a>.</p>
</header>
<section aria-label="Services">
<ul class="services">
${services
  .map(
    (s, n) => `<li data-service="${esc(s.id)}" data-state="${states[n]}"><div><strong>${esc(s.name)}</strong><span>${esc(s.description)}</span></div><em class="${states[n]}">${LABELS[states[n]]}</em></li>`,
  )
  .join("\n")}
</ul>
</section>
<section aria-label="Active incidents">
<h2>Active incidents</h2>
${open.length ? open.map((i) => incidentHTML(i, names)).join("\n") : '<p class="empty">No active incidents.</p>'}
</section>
<section aria-label="Scheduled maintenance">
<h2>Scheduled maintenance</h2>
${
  upcoming.length
    ? upcoming
        .map(
          (w) => `<article class="maintenance" data-starts="${w.starts.toISOString()}" data-ends="${w.ends.toISOString()}" data-services="${esc(w.services.join(","))}">
<h3>${esc(w.title)}</h3>
<p class="meta">${esc(w.services.map((s) => names[s]).join(", "))} · ${when(w.starts)} to ${when(w.ends)}</p>
${w.summary ? md(w.summary) : ""}
</article>`,
        )
        .join("\n")
    : '<p class="empty">None scheduled. We announce maintenance at least 48 hours ahead.</p>'
}
</section>
<section aria-label="Incident history">
<h2>Incident history</h2>
${past.length ? past.map((i) => incidentHTML(i, names)).join("\n") : '<p class="empty">No incidents yet.</p>'}
</section>
<footer><p>Kiff Agents OÜ · <a href="https://kiff.dev/legal/sla">SLA</a> · <a href="https://kiff.dev/security">Security</a> · <a href="https://github.com/kiff/status">How this page works</a></p></footer>
</main>
<script>
// Maintenance windows start and end after the page was built: apply them by
// the reader's clock.
(function () {
  var now = Date.now();
  document.querySelectorAll("article.maintenance").forEach(function (m) {
    if (Date.parse(m.dataset.starts) > now || Date.parse(m.dataset.ends) <= now) return;
    m.dataset.services.split(",").forEach(function (id) {
      var li = document.querySelector('li[data-service="' + id + '"]');
      if (!li || li.dataset.state !== "operational") return;
      li.dataset.state = "maintenance";
      var em = li.querySelector("em");
      em.className = "maintenance";
      em.textContent = "Maintenance";
    });
  });
})();
</script>
</body>
</html>
`;
}
