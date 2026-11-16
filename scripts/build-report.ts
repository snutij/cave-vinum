/**
 * Cave Vinum: generate the static wine-cellar site, one page per cave listed in INVENTORIES.
 *
 *   npm run build
 *   INVENTORIES='[{"slug": "alice", "url": "https://…/alice.csv", "title": "Cave Alice"}]' npm run build
 *
 * Node >= 22.18 (runs TypeScript natively). No runtime dependencies.
 * INVENTORIES is a JSON array of { slug, url, title? }. url is an HTTPS CSV URL or a relative local path.
 * Always writes a generic home page, a 404 page and a demo cave; each cave goes to dist/<slug>/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { demoCsv } from "./demo.ts";
import { parseCsv, loadCsv } from "./lib/csv.ts";
import { DEMO_SLUG, readSiteConfig, resolveCaves } from "./lib/config.ts";
import type { Cave, SiteConfig } from "./lib/config.ts";
import { isInStock, toWines, totalBottles } from "./lib/wines.ts";
import type { Wine } from "./lib/wines.ts";
import { renderHtml } from "./templates/cave-page.ts";
import { HEADERS, ROOT_SERVICE_WORKER, serviceWorker } from "./templates/service-worker.ts";
import { render404, renderHome } from "./templates/site.ts";

const LOCALE = "fr-FR";
const TIMEZONE = "Europe/Paris";

// ─── Main ──────────────────────────────────────────────────────────────────
interface LoadedCave {
  slug: string;
  title: string;
  wines: Wine[];
  warnings: string[];
}

const demoCave = (year: number): LoadedCave => ({
  slug: DEMO_SLUG,
  title: "Cave de démonstration",
  wines: toWines(parseCsv(demoCsv(year)), year).wines,
  warnings: [],
});

async function loadCave(cave: Cave, year: number): Promise<LoadedCave> {
  try {
    const { wines, warnings } = toWines(parseCsv(await loadCsv(cave.url)), year);
    if (wines.length === 0) throw new Error("No wines found in the CSV; refusing to generate an empty report.");
    return { slug: cave.slug, title: cave.title, wines, warnings: warnings.map((w) => `/${cave.slug}/ ${w}`) };
  } catch (err: unknown) {
    throw new Error(`/${cave.slug}/: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

function resolveYear(requested: string | undefined, now: Date): number {
  const year = requested ? Number(requested) : Number(new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, year: "numeric" }).format(now));
  if (!Number.isInteger(year)) throw new Error("--year must be a year (for example, 2027).");
  return year;
}

async function writeSiteRoot(out: string, site: SiteConfig, generatedAt: string): Promise<void> {
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(join(out, "index.html"), renderHome(site, generatedAt)),
    writeFile(join(out, "404.html"), render404()),
    writeFile(join(out, "sw.js"), ROOT_SERVICE_WORKER),
    writeFile(join(out, "_headers"), HEADERS),
    writeFile(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n"),
  ]);
  console.log(`✓ home page → ${join(out, "index.html")}`);
}

async function writeCave(out: string, cave: LoadedCave, year: number, generatedAt: string): Promise<void> {
  const dir = join(out, cave.slug);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "index.html"), renderHtml(cave.wines, year, generatedAt, cave.title)),
    writeFile(join(dir, "sw.js"), serviceWorker(cave.slug)),
  ]);
  for (const w of cave.warnings) console.warn(`⚠ ${w}`);
  const inStock = cave.wines.filter(isInStock);
  console.log(`✓ ${inStock.length} wine references in stock, ${totalBottles(inStock)} bottles → ${join(dir, "index.html")}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: "string", default: "dist" }, year: { type: "string" } },
  });
  const now = new Date();
  const year = resolveYear(values.year, now);
  const out = values.out ?? "dist";

  const site = await readSiteConfig();
  const caves = resolveCaves();
  if (caves.length === 0) console.warn("⚠ INVENTORIES is not set: only the home page, the 404 page and the demo are generated.");

  // Load and validate every cave before writing anything: if one source fails,
  // the build fails and the host keeps serving the previous deployment for everyone.
  const loaded = [demoCave(year)];
  for (const cave of caves) loaded.push(await loadCave(cave, year));

  const generatedAt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, dateStyle: "long", timeStyle: "short" }).format(now);
  await writeSiteRoot(out, site, generatedAt);
  for (const cave of loaded) await writeCave(out, cave, year, generatedAt);
}

main().catch((err: unknown) => {
  // Print only the message, never the full error object, which could contain the URL.
  console.error(`✗ ${err instanceof Error ? err.message : "Unknown error"}`);
  process.exitCode = 1;
});
