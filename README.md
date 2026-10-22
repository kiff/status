# KIFF status

The source of [status.kiff.dev](https://status.kiff.dev): whether KIFF's
services are up, incidents with their updates, scheduled maintenance, and
past incidents. It runs apart from KIFF itself: a static page built here and
served by Vercel, with automatic checks from GitHub Actions. When KIFF is
down, this page still answers.

The services are the ones KIFF's [service-level agreement](https://kiff.dev/legal/sla)
covers: the KIFF API, the KIFF gateway, planque and the tafs service.

## What it shows, and where it comes from

- **Each service's state:** Operational, Degraded, Partial outage, Major
  outage or Maintenance. A service shows the worst of three things: the
  automatic check, any open incident on it, and any maintenance under way.
- **The automatic check** (`.github/workflows/checks.yml`, every 5 minutes)
  calls each service's public endpoint three times at most and records only
  up, degraded or down in `checks/status.json`, with when that state began.
  It commits only when a state changes. Nothing else is kept: no response
  bodies, no timings, no hostnames.
- **Incidents** are Markdown files in `incidents/`, and **maintenance** in
  `maintenance/`, posted by the KIFF team.

## Post an incident

1. Add `incidents/<date>-<short-name>.md`:

   ```markdown
   ---
   title: Some calls answer with an error
   impact: partial
   services: api, gateway
   started: 2026-10-22T19:40Z
   ---
   ## 2026-10-22T19:45Z Investigating
   Some calls to KIFF answer with an error. We're looking into it.
   ```

   - `impact`: `degraded`, `partial` or `major`.
   - `services`: any of `api`, `gateway`, `planque`, `tafs`.
   - Times are UTC, in ISO 8601.
2. Commit and push to `main`. Vercel rebuilds the page in about a minute.
3. **Each update** is another `## <time> <status>` section, such as
   *Identified*, *Monitoring* or *Resolved*, with a sentence or two in plain
   words. The newest shows first.
4. **To resolve it,** add `resolved: <time>` to the front matter, with a last
   update. It then moves to the history. For an incident over 30 minutes, add
   the summary of what happened and what changed within 5 business days, as
   the SLA says: it's the text before the first update.

## Announce maintenance

Add `maintenance/<date>-<short-name>.md` at least 48 hours ahead:

```markdown
---
title: Database upgrade
services: api, gateway
starts: 2026-11-02T06:00Z
ends: 2026-11-02T07:00Z
---
KIFF may answer slowly for a few minutes during the window.
```

The page shows the window until it ends, and the services as under
maintenance while it's under way.

## Rules for this repo

It's public. Never put in it, or on the page:

- credentials, tokens, webhook secrets, or Vercel or AWS ids;
- internal hostnames, IP addresses, regions, account ids, ARNs, or how KIFF
  is hosted;
- logs, traces, request contents or anything that identifies a customer.

A service whose only address is an internal one is checked through a GitHub
Actions secret (`TAFS_CHECK_URL`), never named here. `scripts/public-check.sh`
fails CI on any of the above, and gitleaks scans the history.

## Develop

```sh
node --test                    # the logic
node build.mjs                 # builds public/index.html
bash scripts/public-check.sh   # nothing private
```

No dependencies: Node 22 and the standard library.
