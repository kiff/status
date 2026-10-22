import assert from "node:assert/strict";
import { test } from "node:test";
import { incident, maintenance, md, overall, page, parseDoc, stateOf } from "../lib.mjs";
import { merge, stateFrom } from "../scripts/check.mjs";

const ids = ["api", "gateway", "planque", "tafs"];
const services = ids.map((id) => ({ id, name: id.toUpperCase(), description: "d" }));
const now = new Date("2026-10-22T20:00:00Z");

const open = incident(
  parseDoc(
    `---
title: Errors on some calls
impact: partial
services: api, gateway
started: 2026-10-22T19:40Z
---
## 2026-10-22T19:45Z Investigating
Some calls answer with an error.

## 2026-10-22T19:55Z Identified
The cause is **known**:
- a bad deploy
- rolled back
`,
    "incidents/x.md",
  ),
  "incidents/x.md",
  ids,
);

test("an incident reads its fields and updates", () => {
  assert.equal(open.title, "Errors on some calls");
  assert.deepEqual(open.services, ["api", "gateway"]);
  assert.equal(open.updates.length, 2);
  assert.equal(open.updates[1].status, "Identified");
  assert.equal(open.resolved, null);
});

test("a typo fails the build, not the page", () => {
  const bad = (fm) => () => incident(parseDoc(`---\n${fm}\n---\n`, "f"), "f", ids);
  assert.throws(bad("title: t\nimpact: down\nservices: api\nstarted: 2026-10-22T19:40Z"), /impact/);
  assert.throws(bad("title: t\nimpact: major\nservices: apii\nstarted: 2026-10-22T19:40Z"), /unknown service/);
  assert.throws(bad("title: t\nimpact: major\nservices: api\nstarted: yesterday"), /isn't a time/);
  assert.throws(() => parseDoc("no front matter", "f"), /front matter/);
});

test("a service shows the worst of its check, incidents and maintenance", () => {
  const w = maintenance(parseDoc("---\ntitle: DB upgrade\nservices: planque\nstarts: 2026-10-22T19:00Z\nends: 2026-10-22T21:00Z\n---\n", "m"), "m", ids);
  const ctx = { checks: { services: { tafs: { state: "down" }, gateway: { state: "degraded" } } }, incidents: [open], windows: [w], now };
  assert.equal(stateOf("api", ctx), "partial");
  assert.equal(stateOf("gateway", ctx), "partial");
  assert.equal(stateOf("planque", ctx), "maintenance");
  assert.equal(stateOf("tafs", ctx), "major");
  assert.equal(overall(["operational", "operational"]), "All services operational");
  assert.equal(overall(["operational", "major"]), "Major outage on some services");
});

test("a resolved incident moves to the history and stops counting", () => {
  const done = { ...open, resolved: new Date("2026-10-22T19:58Z") };
  assert.equal(stateOf("api", { checks: {}, incidents: [done], windows: [], now }), "operational");
  const html = page({ services, checks: {}, incidents: [done], windows: [], now });
  assert.match(html, /No active incidents\./);
  assert.match(html, /Incident history[\s\S]*Errors on some calls/);
});

test("the empty page says so for each section", () => {
  const html = page({ services, checks: {}, incidents: [], windows: [], now });
  assert.match(html, /All services operational/);
  assert.match(html, /No active incidents\./);
  assert.match(html, /None scheduled\. We announce maintenance at least 48 hours ahead\./);
  assert.match(html, /No incidents yet\./);
  for (const s of services) assert.match(html, new RegExp(`data-service="${s.id}" data-state="operational"`));
});

test("text is escaped, and only https links render", () => {
  assert.equal(md("<script>x</script>"), "<p>&lt;script&gt;x&lt;/script&gt;</p>");
  assert.equal(md("[a](https://kiff.dev)"), '<p><a href="https://kiff.dev">a</a></p>');
  assert.equal(md("[a](javascript:alert(1))"), "<p>[a](javascript:alert(1))</p>");
  assert.equal(md("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
});

test("a check's attempts become up, degraded or down", () => {
  assert.equal(stateFrom([{ ok: true, ms: 120 }]), "up");
  assert.equal(stateFrom([{ ok: true, ms: 7000 }]), "degraded");
  assert.equal(stateFrom([{ ok: false, ms: 10 }, { ok: true, ms: 100 }, { ok: true, ms: 100 }]), "degraded");
  assert.equal(stateFrom([{ ok: false, ms: 10 }, { ok: false, ms: 10 }, { ok: false, ms: 10 }]), "down");
});

test("the checks file changes only when a state does", () => {
  const t0 = new Date("2026-10-22T19:00:00Z");
  const first = merge({}, { api: "up" }, t0);
  assert.ok(first.changed);
  const same = merge(first.status, { api: "up" }, now);
  assert.ok(!same.changed);
  assert.equal(same.status.services.api.since, t0.toISOString());
  const down = merge(first.status, { api: "down" }, now);
  assert.ok(down.changed);
  assert.deepEqual(Object.keys(down.status.services.api).sort(), ["since", "state"]);
});
