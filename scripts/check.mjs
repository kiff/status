// The automatic checks: node scripts/check.mjs
//
// Calls each service's public endpoint from outside KIFF's hosting and
// records only its state (up, degraded or down) in checks/status.json, and
// only when a state changes, so the page is rebuilt only then. Nothing else
// leaves this script: no response bodies, no timings, no hostnames. A URL
// that mustn't be published is read from an environment variable (a GitHub
// Actions secret), named in services.json as urlSecret.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const ATTEMPTS = 3;
export const SLOW_MS = 5000;
const TIMEOUT_MS = 10000;
const PAUSE_MS = 15000;

// stateFrom turns a run's attempts into a state: every attempt answered as
// expected and fast is up; none did is down; anything in between is degraded.
export function stateFrom(attempts) {
  const ok = attempts.filter((a) => a.ok);
  if (ok.length === 0) return "down";
  if (ok.length === attempts.length && ok.every((a) => a.ms < SLOW_MS)) return "up";
  return "degraded";
}

// merge records the new states, keeping when each state began. It returns
// whether anything changed.
export function merge(prev, states, now) {
  const services = {};
  let changed = false;
  for (const [id, state] of Object.entries(states)) {
    const before = prev?.services?.[id];
    if (before?.state === state) {
      services[id] = before;
    } else {
      services[id] = { state, since: now.toISOString() };
      changed = true;
    }
  }
  if (Object.keys(prev?.services ?? {}).some((id) => !(id in states))) changed = true;
  return { changed, status: { services } };
}

async function attempt(url, expect) {
  const t = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel();
    return { ok: res.status === expect, ms: Date.now() - t };
  } catch {
    return { ok: false, ms: Date.now() - t };
  }
}

async function main() {
  const { services } = JSON.parse(readFileSync("services.json", "utf8"));
  const states = {};
  for (const s of services) {
    const base = s.check.url ?? process.env[s.check.urlSecret];
    if (!base) {
      console.log(`${s.id}: no URL (${s.check.urlSecret} isn't set); skipped`);
      continue;
    }
    const url = base.replace(/\/$/, "") + (s.check.path ?? "");
    const attempts = [];
    for (let n = 0; n < ATTEMPTS; n++) {
      if (n > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
      attempts.push(await attempt(url, s.check.expect));
      if (n === 0 && attempts[0].ok && attempts[0].ms < SLOW_MS) break; // up on the first try: no need to ask again
    }
    states[s.id] = stateFrom(attempts);
    console.log(`${s.id}: ${states[s.id]}`);
  }
  const prev = existsSync("checks/status.json") ? JSON.parse(readFileSync("checks/status.json", "utf8")) : {};
  // A service skipped this run keeps its last state.
  for (const [id, v] of Object.entries(prev.services ?? {})) if (!(id in states)) states[id] = v.state;
  const { changed, status } = merge(prev, states, new Date());
  if (changed) writeFileSync("checks/status.json", JSON.stringify(status, null, 2) + "\n");
  console.log(changed ? "changed" : "unchanged");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
