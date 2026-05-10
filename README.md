<h1 align="center">ghcr-pulls-badge</h1>

<p align="center">
  <strong>A pull-counter pill for any public GitHub Container Registry image.</strong><br>
  GHCR doesn't expose pull counts via any API, but the package landing page does.<br>
  This Cloudflare Worker scrapes it on a cron and serves a shields.io badge.
</p>

<p align="center">
  <a href="https://github.com/mcdays94/nas-doctor/pkgs/container/nas-doctor"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fnas-doctor-stats.lusostreams.workers.dev%2Fbadge-monthly.json&style=flat-square&logo=docker&logoColor=white" alt="GHCR pulls/month (live)"></a>
  <a href="https://github.com/mcdays94/nas-doctor/pkgs/container/nas-doctor"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fnas-doctor-stats.lusostreams.workers.dev%2Fbadge-total.json&style=flat-square&logo=docker&logoColor=white" alt="GHCR pulls (live)"></a>
  <a href="https://github.com/mcdays94/ghcr-pulls-badge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square" alt="MIT License"></a>
  <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Runs on Cloudflare Workers"></a>
</p>

<p align="center">
  <em>The first two badges above are live, fetching real numbers from <a href="https://github.com/mcdays94/nas-doctor">nas-doctor</a> via this exact codebase.</em>
</p>

---

## What this is

GitHub Container Registry shows pull counts on the public package landing page (a "Total downloads" number plus a 30-day sparkline) but **does not expose them via any public API**. shields.io has an `npm/dm` badge for npm packages and a `docker/pulls` badge for Docker Hub. There's no equivalent for GHCR.

This repo is a tiny Cloudflare Worker that fills the gap:

1. **Cron handler** scrapes the GHCR package page on a configurable schedule (default: every 6h)
2. **Parses two values** from the server-rendered HTML: exact total all-time pulls and 30 daily counts from the sparkline SVG
3. **Stores in KV** (exact integers, not just rounded display values)
4. **HTTP handler** serves a [shields.io endpoint badge](https://shields.io/badges/endpoint-badge) JSON that any README can render via a single `<img>` tag

It runs comfortably on the Workers free tier. One Worker per package; one shared codebase.

> **Inspired by** [kimiflare](https://github.com/sinameraji/kimiflare)'s `npm downloads/month` badge. Same vibe, different registry.

## Quickstart

```bash
# 1. Use this template (or clone)
gh repo create my-ghcr-stats --template mcdays94/ghcr-pulls-badge --public --clone
cd my-ghcr-stats
npm install

# 2. Create the KV namespace
npx wrangler kv namespace create STATS
# → copy the printed `id` into wrangler.jsonc → kv_namespaces[0].id

# 3. Edit wrangler.jsonc → vars.GHCR_PACKAGE_URL (and the click-through URL)
#    to point at your own GHCR package, e.g.:
#       https://github.com/your-org/your-repo/pkgs/container/your-image

# 4. Deploy
npx wrangler deploy
```

That's it. Visit your Worker's URL (printed by `wrangler deploy`). There's a landing page at `/` with the README markdown ready to copy-paste.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fmcdays94%2Fghcr-pulls-badge)

## Add the badge to your README

Wrap the `<img>` in an `<a>` so clicks open the GHCR package page:

```html
<a href="https://github.com/OWNER/REPO/pkgs/container/PACKAGE">
  <img
    src="https://img.shields.io/endpoint?url=https%3A%2F%2FYOUR_WORKER.workers.dev%2Fbadge-monthly.json&style=flat-square&logo=docker&logoColor=white"
    alt="GHCR pulls/month"
  />
</a>
```

Replace `YOUR_WORKER.workers.dev` with the hostname of your deployed Worker (or your custom domain).

## Endpoints

| Path                  | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `/`                   | Plain HTML landing page with copy-paste badge markdown               |
| `/badge.json`         | Alias for `/badge-monthly.json`                                      |
| `/badge-monthly.json` | shields.io endpoint badge for last-30-days pulls (e.g. `8.7K /month`)  |
| `/badge-total.json`   | shields.io endpoint badge for all-time pulls (e.g. `14.4K`)            |
| `/stats.json`         | Raw stats incl. exact integers + per-day series for the last 30 days |
| `/health`             | `{ ok: true, package: "..." }` for liveness checks                   |

## Customisation

Every dial lives in `wrangler.jsonc`. No code changes needed for any of this.

### 1. Cron frequency

How often the Worker re-scrapes GHCR. GHCR daily counts only update once per UTC day, so running more often than every few hours is wasted work, but you can if you want. **Set `BADGE_CACHE_SECONDS` to roughly match your cron interval** so shields.io doesn't cache fresher-than-source data.

| Cron expression  | Cadence            | Recommended `BADGE_CACHE_SECONDS` | Use when                                                             |
| ---------------- | ------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `*/15 * * * *`   | every 15 min       | `900` (15 min)                    | Live launch day, watching numbers in real time                       |
| `0 * * * *`      | every hour         | `3600` (1 h)                      | High-velocity project, want fresh numbers in the README              |
| `0 */6 * * *`    | every 6 hours      | `21600` (6 h)                     | **Default (recommended).** Plenty fresh, low GHCR pressure           |
| `0 0,12 * * *`   | twice a day        | `43200` (12 h)                    | Stable project, daily-ish updates are fine                           |
| `0 4 * * *`      | daily, 04:00 UTC   | `86400` (24 h)                    | Mature project, low traffic, minimise Worker invocations             |
| `0 4 * * 1`      | weekly, Mondays    | `604800` (7 d)                    | Archived or low-activity project where pulls barely move week-to-week |

### 2. Pill colour

`vars.BADGE_COLOR` accepts a 6-char hex (no leading `#`) or one of shields.io's named colours.

<table>
<thead><tr><th align="left"><code>BADGE_COLOR</code></th><th align="left">Renders as</th></tr></thead>
<tbody>
<tr><td><code>2496ed</code> (default, Docker blue)</td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>brightgreen</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-brightgreen?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>blueviolet</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-blueviolet?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>orange</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-orange?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>cb3837</code> (npm red)</td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-cb3837?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>black</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-black?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
</tbody></table>

### 3. Label text

`vars.BADGE_LABEL_MONTHLY` and `vars.BADGE_LABEL_TOTAL` control the left side of the pill. Match your project's voice:

<table>
<thead><tr><th align="left">Label</th><th align="left">Renders as</th></tr></thead>
<tbody>
<tr><td><code>ghcr pulls/month</code> (default)</td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>docker pulls</code></td><td><img src="https://img.shields.io/badge/docker%20pulls-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>users last 30d</code></td><td><img src="https://img.shields.io/badge/users%20last%2030d-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>container pulls</code></td><td><img src="https://img.shields.io/badge/container%20pulls-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>📦 monthly</code> (emoji)</td><td><img src="https://img.shields.io/badge/%F0%9F%93%A6%20monthly-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
</tbody></table>

### 4. Cache TTL (`BADGE_CACHE_SECONDS`)

Tells shields.io how long to cache the badge SVG before re-fetching from your Worker. Lower = fresher pill but more Worker invocations; higher = staler pill but cheaper. **Rule of thumb: match your cron interval.** See the cron table above.

### 5. shields.io URL parameters (no Worker change needed)

The README author controls these. They're appended to the shields.io URL in the `<img src="...">`, not configured in the Worker. Mix and match freely.

#### Style

<table>
<thead><tr><th align="left">URL param</th><th align="left">Renders as</th></tr></thead>
<tbody>
<tr><td><code>&style=flat</code> (default)</td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>&style=flat-square</code> <em>(recommended for README rows)</em></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>&style=for-the-badge</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=for-the-badge&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>&style=plastic</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=plastic&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>&style=social</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=social&logo=docker&logoColor=white" alt=""></td></tr>
</tbody></table>

#### Logo

Add any [simple-icons](https://simpleicons.org) slug as `&logo=<slug>`. A few popular ones for container projects:

<table>
<thead><tr><th align="left">URL param</th><th align="left">Renders as</th></tr></thead>
<tbody>
<tr><td><code>&logo=docker</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=docker&logoColor=white" alt=""></td></tr>
<tr><td><code>&logo=github</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=github&logoColor=white" alt=""></td></tr>
<tr><td><code>&logo=kubernetes</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=kubernetes&logoColor=white" alt=""></td></tr>
<tr><td><code>&logo=podman</code></td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square&logo=podman&logoColor=white" alt=""></td></tr>
<tr><td>(none)</td><td><img src="https://img.shields.io/badge/ghcr%20pulls%2Fmonth-14.1K%20%2Fmonth-2496ed?style=flat-square" alt=""></td></tr>
</tbody></table>

#### Override colour from the README (without redeploying)

`&color=<hex-or-name>` overrides whatever the Worker returns. Useful if you want different colours in different contexts (e.g. a darker palette in your docs site than your README).

```html
<img src="https://img.shields.io/endpoint?url=...&color=ff69b4">  <!-- hot pink -->
```

## Architecture

```
┌─────────────┐     6h cron     ┌──────────────────┐  put   ┌──────┐
│ scheduled() │ ──────────────▶ │  scrape + parse  │ ─────▶ │  KV  │
└─────────────┘                 └──────────────────┘        └──────┘
                                                                ▲
                                                                │ get
┌─────────────┐                 ┌──────────────────┐  fall‐    │
│  fetch()    │ ──────────────▶ │  /badge-*.json   │  back ────┘
│             │                 │  /stats.json     │  to scrape
└─────────────┘                 └──────────────────┘  on cold start
        ▲
        │
   shields.io ─── caches SVG for BADGE_CACHE_SECONDS ─── README <img>
```

Two extractions per scrape:

1. **Total all-time pulls** from `<h3 title="14360">14.4K</h3>` after the "Total downloads" label. The exact integer is in the `title` attribute; the visible text is the rounded version GHCR shows users.
2. **30-day daily series** from `<rect data-merge-count="N" data-date="YYYY-MM-DD">` × 30 in the sparkline SVG. Their sum = the "/month" metric.

**Fail-loud parser.** When GitHub changes the page format, the parser throws `GHCRParseError` and the cron logs the error. KV retains the previous good value. Better stale than `?` or `0`.

**Cold-start synchronous scrape.** When the very first request hits a freshly deployed Worker (KV is empty before the cron has fired), the HTTP handler does an inline scrape so day-zero badge requests still work.

## FAQ

<details>
<summary><strong>Is HTML scraping reliable long-term?</strong></summary>

It's the most fragile thing in the project. GitHub can change the `<h3 title="...">` attribute or the `<rect data-merge-count="..." data-date="...">` shape at any time. The parser fails fast in that case and your badge keeps showing the last known good count until you fix the parser. No silent zeros, no `?` placeholders.

If you're shipping production-critical infrastructure, don't make this a load-bearing dependency. It's a vanity badge.
</details>

<details>
<summary><strong>Why scrape instead of using the GitHub API?</strong></summary>

The [GitHub Packages REST API](https://docs.github.com/en/rest/packages/packages) returns container package metadata but the `download_count` field is always `0` or absent for container packages. GitHub doesn't track per-pull counts at the API level. Only the website's package page renders them, derived from internal aggregation that hasn't been productised as an API endpoint.
</details>

<details>
<summary><strong>What does "pulls" actually count?</strong></summary>

Same caveat as every container registry pull metric: it includes CI re-pulls, probe traffic, and `latest`-tag rolls-over. It overstates "real users". Use it as a relative-popularity signal, not a unique-user count.
</details>

<details>
<summary><strong>Does this work for private packages?</strong></summary>

No. The package page requires GitHub auth for private packages. This Worker uses unauthenticated requests by design. Adding auth would require GitHub App / PAT management out of scope for a read-only badge.
</details>

<details>
<summary><strong>Does this work for organisation-owned packages?</strong></summary>

Yes. Both `https://github.com/<user>/<repo>/pkgs/container/<package>` and `https://github.com/<org>/<repo>/pkgs/container/<package>` use the same page layout.
</details>

<details>
<summary><strong>Does this work for other registries (Docker Hub, quay.io, …)?</strong></summary>

No, but they don't need it:

- **Docker Hub** has its own API (`https://hub.docker.com/v2/repositories/<owner>/<image>/`) and shields.io has a built-in `docker/pulls` badge. Use that.
- **quay.io** doesn't publish pull counts at all.
- **Other registries** vary; check whether their UI exposes counts before forking this.
</details>

<details>
<summary><strong>How much does running this cost?</strong></summary>

It fits inside the Cloudflare Workers free tier comfortably. Default cron is 4 ticks/day. Each tick does one outbound `fetch()` to GitHub plus one KV write. The HTTP handler does one KV read per badge request, but shields.io caches the response for `BADGE_CACHE_SECONDS`, so you'll typically see a handful of Worker requests per day per README that embeds the badge.

Free tier limits at time of writing: 100k requests/day, 1k KV writes/day, 100k KV reads/day. You'd need ~25,000 README embeds before brushing against any of these.
</details>

<details>
<summary><strong>Can I track multiple packages from one Worker?</strong></summary>

Not yet. One Worker per package. Adding multi-package support is on the roadmap (see issue tracker). For now, deploy multiple Workers from the same template repo with different `wrangler.jsonc` configs.
</details>

## Local development

```bash
npm install
npm run test           # vitest run, parser unit tests
npm run typecheck      # tsc --noEmit
npm run dev            # wrangler dev, runs Worker locally
```

To smoke-test the cron handler:

```bash
npm run dev -- --test-scheduled
# then in another terminal:
curl http://localhost:8787/__scheduled
```

## Roadmap

- [x] Monthly + total endpoint badges
- [x] Configurable cron, label, colour, cache TTL
- [x] Cold-start synchronous scrape
- [x] Fail-loud parser preserving last-known-good on format drift
- [ ] **`/sparkline.svg`** to render the 30-day daily series as an inline SVG mini-chart for READMEs (data is already in `/stats.json`, just needs the renderer)
- [ ] **Customisation-cycling demo GIFs** in this README (color / text / style / cron tradeoffs)
- [ ] Multi-package support (one Worker, N packages, separate badge URLs)
- [ ] Optional Slack/Discord webhook on milestone pulls (10K, 100K, 1M)

PRs welcome. Each feature is independent and a good first contribution.

## Contributing

1. Fork
2. `npm install && npm test`
3. Branch off `main`
4. Conventional commit messages preferred but not required
5. Open a PR with a brief description and any screenshots if it touches output

## License

[MIT](LICENSE) © Miguel Caetano Dias

---

<sub>Inspired by [kimiflare](https://github.com/sinameraji/kimiflare)'s `npm downloads/month` badge. Built because GHCR shipped without the API I wanted.</sub>
