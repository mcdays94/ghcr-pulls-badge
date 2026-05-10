/**
 * GHCR package-page HTML parser.
 *
 * GHCR (GitHub Container Registry) does not expose pull counts via any public
 * API, but the public package landing page does render them server-side. This
 * module extracts:
 *
 *   - Total all-time downloads as an exact integer (from the <h3 title="...">
 *     attribute that follows the "Total downloads" label).
 *   - Per-day downloads for the last ~30 days (from <rect data-merge-count="N"
 *     data-date="YYYY-MM-DD"> elements inside the page's sparkline SVG).
 *
 * Both extractions are pure functions over a single HTML string. They throw
 * GHCRParseError on missing structure so the caller can preserve the previous
 * KV value rather than overwriting it with garbage when GitHub changes the
 * page format. NEVER swallow the error and write a "?" or "0" — silence is
 * worse than staleness for a public-facing badge.
 *
 * No DOM parser dependency on purpose: the two structures we care about are
 * regex-friendly, and adding a parser dep just to extract two values from a
 * 240KB page is more failure surface than it's worth.
 */

export interface DailyCount {
  /** ISO date in YYYY-MM-DD format, e.g. "2026-05-10" */
  date: string;
  /** Pulls recorded on that calendar day (UTC) */
  count: number;
}

export interface PackageStats {
  /** Exact total all-time download count. */
  totalDownloads: number;
  /** GHCR's own pretty-formatted version of totalDownloads, e.g. "14.4K". */
  totalDownloadsPretty: string;
  /** Sum of `daily[*].count`. */
  monthlyDownloads: number;
  /** Per-day series, newest first (matches GHCR's right-to-left bar ordering). */
  daily: DailyCount[];
  /** ISO timestamp when this snapshot was scraped. Set by the caller, not the parser. */
  capturedAt?: string;
}

export class GHCRParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GHCRParseError";
  }
}

/**
 * Format a number using K/M suffixes the same way GHCR does:
 *   423        -> "423"
 *   1_000      -> "1.0K"
 *   14_360     -> "14.4K"
 *   12_345_678 -> "12.3M"
 */
export function formatCount(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return String(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.trunc(n));
}

/**
 * Parse a GHCR package-page HTML string into structured stats.
 * Throws GHCRParseError if either the total-downloads block or the
 * sparkline rects can't be located — these are signals that GitHub
 * changed the page format and the caller must NOT overwrite KV.
 */
export function parseGHCRPage(html: string): PackageStats {
  // ----- 1. Total downloads -------------------------------------------------
  // Target structure (as of 2026-05-10):
  //   <span class="d-block color-fg-muted text-small tmp-mb-1">Total downloads</span>
  //   <h3 title="14360">14.4K</h3>
  //
  // The exact integer lives in the `title` attribute; the visible text is
  // an abbreviated rendering. We capture both — title for storage/math,
  // text for display fallback.
  const totalRegex =
    /Total downloads<\/span>\s*<h3\s+title="(\d+)"[^>]*>([^<]+)<\/h3>/i;
  const totalMatch = html.match(totalRegex);
  if (!totalMatch) {
    throw new GHCRParseError(
      'Could not locate "Total downloads" → <h3 title=...> block. ' +
        "GHCR may have changed the page format.",
    );
  }
  const totalDownloads = Number.parseInt(totalMatch[1], 10);
  const totalDownloadsPretty = totalMatch[2].trim();
  if (!Number.isFinite(totalDownloads) || totalDownloads < 0) {
    throw new GHCRParseError(
      `Parsed totalDownloads (${totalMatch[1]}) is not a valid non-negative integer.`,
    );
  }

  // ----- 2. Daily counts (sparkline) ---------------------------------------
  // Each bar in the 30-day sparkline carries:
  //   <rect ... data-merge-count="412" data-date="2026-05-10" ... />
  //
  // The attribute order on a single rect is stable in the rendered HTML
  // (count then date), but we tolerate either order by using two anchored
  // matches per rect.
  const daily: DailyCount[] = [];
  const rectRegex =
    /data-merge-count="(\d+)"\s+data-date="(\d{4}-\d{2}-\d{2})"/g;
  for (const match of html.matchAll(rectRegex)) {
    const count = Number.parseInt(match[1], 10);
    const date = match[2];
    if (Number.isFinite(count) && count >= 0) {
      daily.push({ date, count });
    }
  }

  if (daily.length === 0) {
    throw new GHCRParseError(
      "Could not locate any daily-count <rect> elements in sparkline. " +
        "GHCR may have changed the page format.",
    );
  }

  const monthlyDownloads = daily.reduce((sum, d) => sum + d.count, 0);

  return {
    totalDownloads,
    totalDownloadsPretty,
    monthlyDownloads,
    daily,
  };
}
