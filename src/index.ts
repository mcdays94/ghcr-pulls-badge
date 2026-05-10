/**
 * ghcr-pulls-badge Cloudflare Worker.
 *
 * Cron handler scrapes the configured GHCR package page on a schedule and
 * stashes the parsed stats in KV. HTTP handler reads KV and returns
 * shields.io endpoint-badge JSON. On a cold KV (first request after deploy
 * before the cron has fired) the HTTP path falls back to a synchronous
 * scrape so the very first README render still returns correct data.
 *
 * Every package-specific value is a `vars` entry in wrangler.jsonc. There's
 * nothing GHCR-package-specific in this source file. Fork it, change the
 * config, deploy. See README for the customisation table.
 */

import { parseGHCRPage, formatCount, type PackageStats } from "./parser.js";

interface Env {
  STATS: KVNamespace;
  GHCR_PACKAGE_URL: string;
  GHCR_PACKAGE_PAGE_URL: string;
  BADGE_LABEL_MONTHLY: string;
  BADGE_LABEL_TOTAL: string;
  BADGE_COLOR: string;
  /** Cache TTL for the badge JSON response (seconds). Honors the `cacheSeconds` field of shields.io endpoint badges. */
  BADGE_CACHE_SECONDS: string;
}

const KV_KEY = "stats:v1";
const DEFAULT_CACHE_SECONDS = 21600; // 6h

// Identifying user-agent so GitHub can rate-limit us specifically (and so the
// owner of a scraped package can find us in their access logs and complain
// before we get banned by a generic bot rule). Includes the project URL so
// reachability is one click away.
const USER_AGENT =
  "ghcr-pulls-badge/0.1 (+https://github.com/mcdays94/ghcr-pulls-badge)";

/** shields.io endpoint-badge schema. https://shields.io/badges/endpoint-badge */
interface ShieldsBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  cacheSeconds?: number;
  isError?: boolean;
}

function parseCacheSeconds(env: Env): number {
  const n = Number.parseInt(env.BADGE_CACHE_SECONDS ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CACHE_SECONDS;
  return n;
}

/**
 * Scrape GHCR, parse, write to KV, return parsed stats.
 * Throws on network failure or parse failure. The caller decides whether to
 * suppress (cron) or propagate (HTTP cold-start fallback).
 */
async function refresh(env: Env): Promise<PackageStats> {
  const response = await fetch(env.GHCR_PACKAGE_URL, {
    headers: {
      "user-agent": USER_AGENT,
      // Without these, GitHub sometimes returns an empty 200 to non-browser UAs.
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
    // Follow the /users/.../packages/container/package/... -> /<owner>/<repo>/pkgs/container/...
    // redirect transparently.
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `GHCR returned ${response.status} ${response.statusText} for ${env.GHCR_PACKAGE_URL}`,
    );
  }

  // The page is ~240KB. Well under any practical Worker memory limit, but
  // we read it whole because regex-over-string is simpler than streaming
  // for two well-defined extractions.
  const html = await response.text();
  const stats = parseGHCRPage(html);
  stats.capturedAt = new Date().toISOString();

  await env.STATS.put(KV_KEY, JSON.stringify(stats));

  return stats;
}

/**
 * Read latest stats from KV, falling back to a synchronous scrape on cold start.
 */
async function readStats(env: Env): Promise<PackageStats> {
  const raw = await env.STATS.get(KV_KEY);
  if (raw) {
    return JSON.parse(raw) as PackageStats;
  }
  // KV is empty (first ever request, before any cron has fired). Scrape now
  // so we don't serve a broken-looking pill on day zero.
  return refresh(env);
}

function buildBadge(
  metric: "monthly" | "total",
  stats: PackageStats,
  env: Env,
): ShieldsBadge {
  const value =
    metric === "monthly" ? stats.monthlyDownloads : stats.totalDownloads;
  const message =
    metric === "monthly"
      ? `${formatCount(value)} /month`
      : formatCount(value);
  const label =
    metric === "monthly" ? env.BADGE_LABEL_MONTHLY : env.BADGE_LABEL_TOTAL;
  return {
    schemaVersion: 1,
    label,
    message,
    color: env.BADGE_COLOR,
    cacheSeconds: parseCacheSeconds(env),
  };
}

function errorBadge(): ShieldsBadge {
  return {
    schemaVersion: 1,
    label: "ghcr",
    message: "error",
    color: "lightgrey",
    isError: true,
    // Short cache on errors so the badge recovers quickly once the underlying
    // problem clears. Independent of BADGE_CACHE_SECONDS, since we never want
    // user-configured-long cache on error responses.
    cacheSeconds: 60,
  };
}

function commonHeaders(env: Env): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "cache-control": `public, max-age=${parseCacheSeconds(env)}`,
    "content-type": "application/json; charset=utf-8",
  };
}

function landingPage(env: Env, origin: string): string {
  // Pre-baked example badge URL the user can copy into a README. Substitutes
  // the runtime origin so the example matches whatever Worker hostname this
  // is deployed under (workers.dev or a custom domain).
  const monthlyBadgeUrl = `https://img.shields.io/endpoint?url=${encodeURIComponent(`${origin}/badge-monthly.json`)}&style=flat-square&logo=docker&logoColor=white`;
  const totalBadgeUrl = `https://img.shields.io/endpoint?url=${encodeURIComponent(`${origin}/badge-total.json`)}&style=flat-square&logo=docker&logoColor=white`;
  const packageDisplay = env.GHCR_PACKAGE_URL.replace(
    /^https:\/\/github\.com\//,
    "",
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ghcr-pulls-badge</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif;
           max-width: 70ch; margin: 3rem auto; padding: 0 1rem; color: #1f2328;
           line-height: 1.6; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; }
    code, pre { background: #f6f8fa; border-radius: 4px;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    code { padding: 0.1em 0.4em; font-size: 0.9em; }
    pre { padding: 0.75rem 1rem; overflow-x: auto; font-size: 0.85em;
          border: 1px solid #d1d9e0; }
    a { color: #0969da; }
    .preview { margin: 1rem 0; }
    .preview img { vertical-align: middle; }
    .muted { color: #59636e; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>ghcr-pulls-badge</h1>
  <p>Cloudflare Worker that scrapes a GHCR package page on a schedule and exposes
     <a href="https://shields.io/badges/endpoint-badge">shields.io endpoint badges</a>
     with pull counts.</p>
  <p>Currently tracking
     <a href="${env.GHCR_PACKAGE_PAGE_URL}"><code>${packageDisplay}</code></a>.</p>

  <h2>Live preview</h2>
  <div class="preview">
    <a href="${env.GHCR_PACKAGE_PAGE_URL}"><img src="${monthlyBadgeUrl}" alt="GHCR pulls/month"></a>
    &nbsp;
    <a href="${env.GHCR_PACKAGE_PAGE_URL}"><img src="${totalBadgeUrl}" alt="GHCR pulls"></a>
  </div>
  <p class="muted">These badges fetch from this Worker via shields.io. Click one to see the GHCR package page.</p>

  <h2>Endpoints</h2>
  <ul>
    <li><a href="/badge-monthly.json"><code>/badge-monthly.json</code></a> for last-30-days pulls</li>
    <li><a href="/badge-total.json"><code>/badge-total.json</code></a> for all-time pulls</li>
    <li><a href="/stats.json"><code>/stats.json</code></a> for raw stats incl. 30-day daily series</li>
    <li><a href="/health"><code>/health</code></a> for liveness checks</li>
  </ul>

  <h2>README markdown (copy-paste)</h2>
  <pre>&lt;a href="${env.GHCR_PACKAGE_PAGE_URL}"&gt;
  &lt;img src="${monthlyBadgeUrl}"
       alt="GHCR pulls/month"&gt;
&lt;/a&gt;</pre>

  <p class="muted">Source &amp; documentation: <a href="https://github.com/mcdays94/ghcr-pulls-badge">github.com/mcdays94/ghcr-pulls-badge</a></p>
</body>
</html>`;
}

export default {
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Use waitUntil so the cron event-loop tick can return immediately;
    // the scrape continues to completion in the background. Errors are
    // logged but NOT rethrown. KV retains the previous good value, which
    // is the right behaviour for a cron that runs a few times a day.
    ctx.waitUntil(
      refresh(env).then(
        (stats) =>
          console.log(
            `[cron] refreshed: total=${stats.totalDownloads} monthly=${stats.monthlyDownloads} daily=${stats.daily.length}`,
          ),
        (err) => console.error("[cron] refresh failed:", err),
      ),
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = url.origin;

    try {
      switch (url.pathname) {
        case "/":
          if (req.method !== "GET") {
            return new Response("Method not allowed", { status: 405 });
          }
          return new Response(landingPage(env, origin), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "public, max-age=300",
            },
          });
        case "/badge.json":
        case "/badge-monthly.json": {
          const stats = await readStats(env);
          return Response.json(buildBadge("monthly", stats, env), {
            headers: commonHeaders(env),
          });
        }
        case "/badge-total.json": {
          const stats = await readStats(env);
          return Response.json(buildBadge("total", stats, env), {
            headers: commonHeaders(env),
          });
        }
        case "/stats.json": {
          const stats = await readStats(env);
          return Response.json(stats, { headers: commonHeaders(env) });
        }
        case "/health":
          return Response.json(
            { ok: true, package: env.GHCR_PACKAGE_URL },
            { headers: commonHeaders(env) },
          );
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      console.error("[fetch] handler failed:", err);
      // shields.io renders the badge from the JSON we return, so we MUST
      // return 200 even on errors. A non-200 yields a generic broken-badge
      // graphic. isError=true tells shields.io to colour it red.
      return Response.json(errorBadge(), {
        status: 200,
        headers: commonHeaders(env),
      });
    }
  },
} satisfies ExportedHandler<Env>;
