import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseGHCRPage,
  formatCount,
  GHCRParseError,
} from "../src/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixture(name: string): Promise<string> {
  return readFile(resolve(__dirname, "fixtures", name), "utf8");
}

describe("parseGHCRPage", () => {
  // The fixture is an arbitrary public GHCR package page captured at a known
  // moment. The exact numbers below are pinned to that capture. When
  // refreshing the fixture, update both the title-attribute integer and the
  // pretty-text together (they always come from the same <h3> block).
  it("extracts total downloads as exact integer + pretty string", async () => {
    const html = await loadFixture("ghcr-page-example.html");
    const stats = parseGHCRPage(html);
    expect(stats.totalDownloads).toBe(14360);
    expect(stats.totalDownloadsPretty).toBe("14.4K");
  });

  it("extracts 30 daily counts from the sparkline, newest first", async () => {
    const html = await loadFixture("ghcr-page-example.html");
    const stats = parseGHCRPage(html);

    expect(stats.daily).toHaveLength(30);
    // Newest entry: the rightmost bar in the sparkline (right-to-left order).
    expect(stats.daily[0]).toEqual({ date: "2026-05-10", count: 412 });
    expect(stats.daily[1]).toEqual({ date: "2026-05-09", count: 847 });

    // Every entry has a well-formed date and a non-negative count.
    for (const day of stats.daily) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.count).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes monthlyDownloads as sum of daily counts", async () => {
    const html = await loadFixture("ghcr-page-example.html");
    const stats = parseGHCRPage(html);

    const expectedSum = stats.daily.reduce((s, d) => s + d.count, 0);
    expect(stats.monthlyDownloads).toBe(expectedSum);

    // Sanity: monthly should be a substantial fraction of total but not exceed it.
    expect(stats.monthlyDownloads).toBeGreaterThan(0);
    expect(stats.monthlyDownloads).toBeLessThanOrEqual(stats.totalDownloads);
  });

  it("does not set capturedAt; that's the caller's responsibility", async () => {
    const html = await loadFixture("ghcr-page-example.html");
    const stats = parseGHCRPage(html);
    expect(stats.capturedAt).toBeUndefined();
  });

  it("throws GHCRParseError when Total downloads block is missing", () => {
    const html = "<html>nothing matching the pattern here</html>";
    expect(() => parseGHCRPage(html)).toThrow(GHCRParseError);
    expect(() => parseGHCRPage(html)).toThrow(/Total downloads/);
  });

  it("throws GHCRParseError when sparkline has no day rects", () => {
    // Total-downloads block is present, but no <rect data-merge-count=...> at all.
    const html = `
      <span>Total downloads</span><h3 title="100">100</h3>
      <svg>no data-merge-count attributes here</svg>
    `;
    expect(() => parseGHCRPage(html)).toThrow(GHCRParseError);
    expect(() => parseGHCRPage(html)).toThrow(/sparkline/);
  });

  it("ignores malformed daily entries but keeps the well-formed ones", () => {
    const html = `
      <span>Total downloads</span><h3 title="50">50</h3>
      <rect data-merge-count="10" data-date="2026-05-10" />
      <rect data-merge-count="not-a-number" data-date="2026-05-09" />
      <rect data-merge-count="5" data-date="2026-05-08" />
    `;
    const stats = parseGHCRPage(html);
    expect(stats.daily).toHaveLength(2);
    expect(stats.daily.map((d) => d.count)).toEqual([10, 5]);
  });
});

describe("formatCount", () => {
  it.each([
    [0, "0"],
    [42, "42"],
    [999, "999"],
    [1_000, "1.0K"],
    [14_360, "14.4K"],
    [99_500, "99.5K"],
    [1_000_000, "1.0M"],
    [12_345_678, "12.3M"],
  ])("formats %i as %s", (n, expected) => {
    expect(formatCount(n)).toBe(expected);
  });
});
