/**
 * Cave Vinum: generate the static wine-cellar site from a local CSV or INVENTORY_URL.
 *
 *   npm run build
 *   INVENTORY_URL="https://example.com/inventory.csv" npm run build
 *
 * Node >= 22.18 (runs TypeScript natively). No runtime dependencies.
 * Without INVENTORY_URL, reads data/inventory.csv. Writes the report to dist/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ─── Data model ────────────────────────────────────────────────────────────
type Status = "urgent" | "this-year" | "ready" | "keep" | "incomplete" | "empty";

interface Wine {
  name: string;
  vintage: number | null;
  qty: number | null;
  color: string;
  appellation: string;
  peakStart: number | null;
  peakEnd: number | null;
  tags: string[];
  location: string;
  notes: string;
  status: Status;
  yearsLeft: number | null;
}

const STATUS: Record<Status, { rank: number; label: string }> = {
  urgent: { rank: 1, label: "Urgent (apogée dépassée)" },
  "this-year": { rank: 2, label: "À boire cette année" },
  ready: { rank: 3, label: "Prêt à boire" },
  keep: { rank: 4, label: "À garder (trop jeune)" },
  incomplete: { rank: 5, label: "Infos à compléter" },
  empty: { rank: 6, label: "Épuisé" },
};

/** Tags offered by the filter, in order (unknown tags are appended). */
const KNOWN_TAGS = [
  "Apéro", "Poisson cuit", "Huîtres / Fruits de mer crus", "Volaille / Viande blanche",
  "Viande rouge / Canard", "Plat mijoté / Gibier", "Fromage à pâte dure",
  "Pizza / Pâtes / Charcuterie", "Cuisine épicée", "Dessert",
];

/** CSV positions from the supplied workbook. Header text is intentionally ignored. */
const COLUMN = {
  name: 0,
  vintage: 1,
  qty: 2,
  color: 3,
  appellation: 4,
  peakStart: 5,
  peakEnd: 6,
  tags: 9,
  location: 10,
  notes: 11,
} as const;
const CSV_COLUMN_COUNT = 12;

// ─── Utilities ─────────────────────────────────────────────────────────────
const norm = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\(auto\)/g, "").replace(/\s+/g, " ").trim();

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

const toInt = (v: string | undefined): number | null => {
  const t = (v ?? "").replace(/\s/g, "");
  return /^[+-]?\d+$/.test(t) ? Number.parseInt(t, 10) : null;
};

const plural = (n: number, word: string): string => `${n} ${word}${Math.abs(n) > 1 ? "s" : ""}`;

const COLOR_ORDER = ["rouge", "blanc", "rose", "bulles"];
const colorRank = (key: string): number => (COLOR_ORDER.indexOf(key) + 1) || 99;

/** RFC 4180 CSV parser: quotes, escaped "", commas and newlines in fields, CRLF, and BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (inQuotes) throw new Error("Invalid CSV: unterminated quoted field.");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Fetch CSV ─────────────────────────────────────────────────────────────
async function fetchCsv(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("INVENTORY_URL must be a valid URL."); }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("INVENTORY_URL must use HTTPS.");
  }
  let reason = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) })
      .catch((err: unknown) => new Error(err instanceof Error && err.name === "TimeoutError" ? "request timed out" : "network error"));
    if (res instanceof Error) {
      reason = res.message;
    } else if (res.ok) {
      // A CSV URL may return an HTML error page instead of the export.
      if ((res.headers.get("content-type") ?? "").includes("html")) {
        throw new Error("INVENTORY_URL returned HTML instead of CSV.");
      }
      return await res.text();
    } else {
      reason = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw new Error(`Could not download CSV (${reason}).`);
}

// ─── CSV to wines ──────────────────────────────────────────────────────────
function computeStatus(qty: number | null, start: number | null, end: number | null, year: number): Pick<Wine, "status" | "yearsLeft"> {
  if (qty !== null && qty <= 0) return { status: "empty", yearsLeft: null };
  const yearsLeft = end === null ? null : end - year;
  if (qty === null || end === null || (start !== null && start > end)) return { status: "incomplete", yearsLeft };
  if (end < year) return { status: "urgent", yearsLeft };
  if (end === year) return { status: "this-year", yearsLeft };
  if (start === null || year >= start) return { status: "ready", yearsLeft };
  return { status: "keep", yearsLeft };
}

function toWines(rows: string[][], year: number, warnings: string[]): Wine[] {
  const [header, ...data] = rows;
  if (!header) throw new Error("CSV vide.");
  if (header.length < CSV_COLUMN_COUNT) {
    throw new Error(`Incomplete CSV: expected at least ${CSV_COLUMN_COUNT} columns in the template's order.`);
  }
  const get = (row: string[], key: keyof typeof COLUMN): string => (row[COLUMN[key]] ?? "").trim();

  const wines: Wine[] = [];
  data.forEach((row, i) => {
    const name = get(row, "name");
    if (!name) return; // ligne vide
    const line = i + 2;
    const qty = toInt(get(row, "qty"));
    const vintage = toInt(get(row, "vintage"));
    const peakStart = toInt(get(row, "peakStart"));
    const peakEnd = toInt(get(row, "peakEnd"));
    if (qty === null) warnings.push(`ligne ${line} (${name}) : quantité vide ou invalide`);
    if (peakEnd === null) warnings.push(`ligne ${line} (${name}) : apogée fin vide ou invalide`);
    if (peakStart !== null && peakEnd !== null && peakStart > peakEnd) warnings.push(`ligne ${line} (${name}) : apogée début > apogée fin`);
    const tags = [...new Set(get(row, "tags").split(/[,;]/).map((t) => t.trim()).filter(Boolean))];
    wines.push({
      name, vintage, qty, peakStart, peakEnd, tags,
      color: get(row, "color"),
      appellation: get(row, "appellation"),
      location: get(row, "location"),
      notes: get(row, "notes"),
      ...computeStatus(qty, peakStart, peakEnd, year),
    });
  });

  // Sort by status, years remaining, oldest vintage (non-vintage first), then name.
  return wines.sort((a, b) =>
    STATUS[a.status].rank - STATUS[b.status].rank
    || (a.yearsLeft ?? 999) - (b.yearsLeft ?? 999)
    || (a.vintage ?? 0) - (b.vintage ?? 0)
    || a.name.localeCompare(b.name, "fr"));
}

// ─── Render HTML ───────────────────────────────────────────────────────────
function renderCard(w: Wine, scale: { min: number; max: number }, year: number, index: number): string {
  const inStock = w.status !== "empty";
  const colorKey = ["rouge", "blanc", "rose"].includes(norm(w.color)) ? norm(w.color) : "other";
  const pct = (y: number) => (((y - scale.min) / (scale.max - scale.min)) * 100).toFixed(1);
  const range = w.peakEnd === null ? "" : `<div class="v-track-wrap"><div class="v-bar" style="--n:${scale.max - scale.min}">
    <span class="v-window" style="left:${pct(w.peakStart ?? w.peakEnd)}%;width:${(Number(pct(w.peakEnd + 1)) - Number(pct(w.peakStart ?? w.peakEnd))).toFixed(1)}%"></span>
    <span class="v-now" style="left:${pct(year + 0.5)}%"><span>${year}</span></span>
  </div><div class="v-scale"><span>${scale.min}</span><span>${scale.max - 1}</span></div></div>`;
  const statusClass = w.status === "urgent" || w.status === "this-year" ? "urgent"
    : w.status === "ready" ? "ready" : w.status === "keep" ? "wait"
    : w.status === "empty" ? "out" : "neutral";
  const parts = w.name.split(" - ");
  const house = parts[0];
  const cuvee = parts.slice(1).join(" - ");
  const notes = w.notes
    ? esc(w.notes).replace(/\s+·\s+/g, '<span class="v-sep" aria-hidden="true"> · </span>')
    : "";
  const search = norm([w.name, w.vintage ?? "", w.appellation, w.color, w.location, w.notes, ...w.tags].join(" "));
  return `<article class="v-card${statusClass === "urgent" ? " is-urgent" : ""}${inStock ? "" : " is-out"}" data-color="${esc(norm(w.color))}" data-tags="${esc(w.tags.map(norm).join("|"))}"
  data-search="${esc(search)}" data-stock="${inStock ? 1 : 0}" data-qty="${w.qty ?? 0}" style="animation-delay:${index * 70}ms"${inStock ? "" : " hidden"}>
  <div class="v-label">
    <span class="v-ribbon" hidden>À ouvrir en premier</span>
    ${w.color ? `<span class="v-kicker"><span class="v-dot v-dot--${colorKey}"></span>${esc(w.color)}</span>` : ""}
    <h2 class="v-house">${esc(house)}</h2>
    ${cuvee ? `<p class="v-cuvee">${esc(cuvee)}</p>` : ""}
    ${w.vintage !== null ? `<div class="v-vintage">${w.vintage}</div>` : ""}
    ${w.appellation ? `<p class="v-aoc">${esc(w.appellation)}</p>` : ""}
  </div>
  <div class="v-details">
    <div class="v-top"><span class="v-status v-status--${statusClass}"><i></i>${esc(STATUS[w.status].label)}</span>
      <span class="v-qty" aria-label="${plural(w.qty ?? 0, "bouteille")}"><svg viewBox="0 0 11 30" aria-hidden="true"><path d="M4 .5h3v7.2c0 1.1 3.5 2.6 3.5 6.6v14.2c0 .8-.7 1.5-1.5 1.5H2c-.8 0-1.5-.7-1.5-1.5V14.3C.5 10.3 4 8.8 4 7.7z" fill="currentColor"/></svg><b><small>×</small>${w.qty ?? "?"}</b></span>
    </div>
    ${w.peakEnd !== null ? `<div class="v-time"><div class="v-time-head"><p class="v-cap">Apogée</p><span class="v-years"><strong>${w.peakStart ?? "?"} → ${w.peakEnd}</strong>${w.yearsLeft !== null ? `<span class="v-delta">${w.yearsLeft > 0 ? "+" : w.yearsLeft < 0 ? "−" : ""}${plural(Math.abs(w.yearsLeft), "an")}</span>` : ""}</span></div>${range}</div>` : ""}
    ${w.tags.length ? `<div><p class="v-cap">Accords mets-vins</p><ul class="v-tags">${w.tags.map((t) => `<li data-tag="${esc(norm(t))}">${esc(t)}</li>`).join("")}</ul></div>` : ""}
    ${notes || w.location ? `<div class="v-notes-wrap">${notes ? `<p class="v-cap">Notes / Service</p><p class="v-notes">${notes}</p>` : ""}${w.location ? `<p class="v-place"><span class="v-cap">Emplacement</span> ${esc(w.location)}</p>` : ""}</div>` : ""}
  </div>
</article>`;
}

function renderHtml(wines: Wine[], year: number, generatedAt: string): string {
  const stock = wines.filter((w) => w.status !== "empty");
  const bottles = (list: Wine[]) => list.reduce((sum, w) => sum + (w.qty ?? 0), 0);
  const by = (...st: Status[]) => bottles(stock.filter((w) => st.includes(w.status)));
  const years = wines.flatMap((w) => [w.peakStart, w.peakEnd]).filter((y): y is number => y !== null);
  const scale = { min: Math.min(year, ...years), max: Math.max(year, ...years) + 1 };

  const colors = [...new Map(stock.filter((w) => w.color).map((w) => [norm(w.color), w.color] as const))]
    .sort(([a], [b]) => colorRank(a) - colorRank(b));
  const colorChips = colors.map(([key, label]) => {
    const n = bottles(stock.filter((w) => norm(w.color) === key));
    return `<label class="chip"><input type="radio" name="color" value="${esc(key)}"> ${esc(label)} <small>${n}</small></label>`;
  }).join("");

  const extraTags = [...new Set(stock.flatMap((w) => w.tags))].filter((t) => !KNOWN_TAGS.some((k) => norm(k) === norm(t)));
  const mealOptions = [...KNOWN_TAGS, ...extraTags].map((t) => {
    const n = stock.filter((w) => w.tags.some((x) => norm(x) === norm(t))).length;
    return `<option value="${esc(norm(t))}">${esc(t)} (${n})</option>`;
  }).join("");

  const urgent = by("urgent", "this-year");
  const ready = by("ready");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#120809">
<title>Cave Vinum</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:#120809}
body{font:15px/1.5 "Jost","Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",sans-serif}
.vinum{--night:#120809;--velvet:#1f0c11;--bordeaux:#6e1a2d;--bordeaux-deep:#4a0f1d;--garnet:#9e2b35;--gold:#c9a76b;--gold-hi:#ead7a8;--gold-lo:#9b7b45;--gold-ink:#7a5a22;--ivory:#f7f1e6;--paper:#fbf8f1;--ink:#24161a;--ink-soft:#5a484b;--ink-mute:#8b7a76;--line:rgba(201,167,107,.32);--serif:"Cormorant Garamond","Cormorant",Georgia,"Times New Roman",serif;--sans:"Jost","Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",sans-serif;position:relative;min-height:100vh;overflow-x:hidden;color:var(--ivory);font-family:var(--sans);font-size:15px;line-height:1.5;font-variant-numeric:lining-nums;-webkit-font-smoothing:antialiased;background:radial-gradient(1100px 680px at 50% -14%,rgba(122,28,50,.78),transparent 64%),radial-gradient(700px 520px at 105% 38%,rgba(110,26,45,.2),transparent 60%),radial-gradient(600px 480px at -10% 75%,rgba(201,167,107,.06),transparent 60%),var(--night)}
.vinum *,.vinum *::before,.vinum *::after{box-sizing:border-box}
.vinum::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.06;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.vinum button{font:inherit;color:inherit}.vinum :focus-visible{outline:2px solid var(--gold);outline-offset:3px}.vinum [hidden]{display:none!important}
.v-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.v-hero{position:relative;z-index:1;text-align:center;padding:clamp(52px,9vw,104px) 20px clamp(34px,5vw,56px)}
.v-monogram{display:block;width:78px;height:78px;margin:0 auto 22px;color:var(--gold)}
.v-title{margin:0;font-family:var(--serif);font-weight:500;font-size:clamp(50px,10vw,104px);line-height:.92;letter-spacing:.005em;color:var(--paper)}
.v-title em{font-style:italic;font-weight:400;background:linear-gradient(180deg,#f3e3bb 10%,#c9a76b 90%);-webkit-background-clip:text;background-clip:text;color:transparent}
.v-tagline{margin:16px 0 0;font-family:var(--serif);font-style:italic;font-size:clamp(19px,2.4vw,23px);color:rgba(247,241,230,.72)}
.v-orn{display:flex;align-items:center;justify-content:center;gap:14px;max-width:440px;margin:30px auto;color:var(--gold)}.v-orn::before,.v-orn::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--gold))}.v-orn::after{background:linear-gradient(270deg,transparent,var(--gold))}.v-orn svg{width:14px;height:14px}
.v-stats{display:flex;justify-content:center;max-width:600px;margin:0 auto}.v-stat{flex:1;padding:2px 14px}.v-stat+.v-stat{border-left:1px solid var(--line)}.v-stat b{display:block;font-family:var(--serif);font-weight:500;font-size:clamp(36px,6.4vw,54px);line-height:1;color:var(--paper)}.v-stat span{display:block;margin-top:10px;font-size:10.5px;letter-spacing:.26em;text-transform:uppercase;color:var(--gold)}
.v-alerts{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:30px}.v-alert{display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border-radius:999px;border:1px solid;font-size:13px;letter-spacing:.04em;backdrop-filter:blur(8px)}.v-alert i{width:7px;height:7px;border-radius:50%}.v-alert b{font-family:var(--serif);font-size:18px;font-weight:600;line-height:1}.v-alert--urgent{border-color:rgba(224,103,95,.45);background:rgba(158,43,53,.2);color:#f4cdc7}.v-alert--urgent i{background:#e0675f}.v-alert--ready{border-color:rgba(201,167,107,.45);background:rgba(201,167,107,.1);color:var(--gold-hi)}.v-alert--ready i{background:var(--gold);box-shadow:0 0 10px rgba(201,167,107,.8)}
.v-main{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:0 18px 40px}
.v-controls{display:grid;gap:18px;padding:20px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(43,16,24,.78),rgba(26,10,14,.78));backdrop-filter:blur(16px);box-shadow:0 30px 60px -32px rgba(0,0,0,.8),inset 0 1px 0 rgba(234,215,168,.08)}
.v-search{position:relative}.v-search svg{position:absolute;left:18px;top:50%;width:18px;height:18px;transform:translateY(-50%);color:var(--gold);pointer-events:none}.v-search input{width:100%;height:54px;padding:0 18px 0 50px;border:1px solid rgba(201,167,107,.26);border-radius:16px;background:rgba(0,0,0,.28);color:var(--paper);font:400 16px var(--sans);outline:none}.v-search input::placeholder{color:rgba(247,241,230,.45);font-family:var(--serif);font-style:italic;font-size:19px}.v-search input:focus{border-color:var(--gold);box-shadow:0 0 0 4px rgba(201,167,107,.14)}
.v-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px 20px}.v-seg{display:inline-flex;gap:4px;padding:4px;border:1px solid rgba(201,167,107,.22);border-radius:999px;background:rgba(0,0,0,.3);max-width:100%}.v-seg button{display:inline-flex;align-items:center;gap:9px;padding:10px 18px;border:0;border-radius:999px;background:transparent;color:rgba(247,241,230,.78);font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;white-space:nowrap}.v-seg button small{font-size:11px;letter-spacing:.04em;opacity:.65}.v-seg button[aria-pressed=true]{background:linear-gradient(180deg,var(--gold-hi),var(--gold));color:var(--velvet);box-shadow:0 6px 16px -8px rgba(201,167,107,.8)}
.v-dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}.v-dot--all{background:conic-gradient(#8a1e33 0 50%,#e9d68f 50% 100%)}.v-dot--rouge{background:radial-gradient(circle at 35% 30%,#c0435a,#5c0f20)}.v-dot--blanc{background:radial-gradient(circle at 35% 30%,#fff5cc,#d6b85e)}.v-dot--rose{background:radial-gradient(circle at 35% 30%,#ffd0d6,#d77b8a)}.v-dot--other{background:radial-gradient(circle at 35% 30%,#f3e3bb,#9b7b45)}
.v-meta{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.v-count{font-family:var(--serif);font-size:18px;color:rgba(247,241,230,.82)}.v-count b{font-weight:600;color:var(--gold-hi)}
.v-toggle{position:relative;display:inline-flex;align-items:center;gap:10px;font-size:13px;color:rgba(247,241,230,.75);cursor:pointer;user-select:none}.v-toggle input{position:absolute;opacity:0;width:1px;height:1px}.v-track{position:relative;width:40px;height:22px;border:1px solid rgba(201,167,107,.38);border-radius:11px;background:rgba(0,0,0,.35)}.v-track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:rgba(247,241,230,.7);transition:transform .25s,background .25s}.v-toggle input:checked+.v-track{background:rgba(201,167,107,.35);border-color:var(--gold)}.v-toggle input:checked+.v-track::after{transform:translateX(18px);background:var(--gold-hi)}.v-toggle input:focus-visible+.v-track{outline:2px solid var(--gold);outline-offset:3px}
.v-dishes{display:grid;gap:10px;padding-top:16px;border-top:1px solid rgba(201,167,107,.14)}.v-dishes-label{font-family:var(--serif);font-style:italic;font-size:19px;color:var(--gold-hi)}.v-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 24px 4px 2px;margin:0 -2px;scrollbar-width:none;mask-image:linear-gradient(90deg,#000 88%,transparent);scroll-snap-type:x proximity}.v-chips::-webkit-scrollbar{display:none}@media(min-width:860px){.v-chips{flex-wrap:wrap;overflow:visible;padding-right:2px;mask-image:none}}
.v-chip{flex:none;display:inline-flex;align-items:center;gap:8px;padding:8px 10px 8px 15px;border:1px solid rgba(201,167,107,.28);border-radius:999px;background:transparent;color:rgba(247,241,230,.86);font-size:13.5px;white-space:nowrap;cursor:pointer;scroll-snap-align:start}.v-chip small{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:rgba(201,167,107,.16);color:var(--gold-hi);font-size:11px}.v-chip.is-zero{opacity:.42}.v-chip[aria-pressed=true]{border-color:var(--gold);background:linear-gradient(180deg,var(--gold-hi),var(--gold));color:var(--velvet);opacity:1}.v-chip[aria-pressed=true] small{background:rgba(31,12,17,.14);color:var(--velvet)}
.v-list{display:grid;gap:24px;margin-top:38px;container-type:inline-size}
.v-card{position:relative;display:grid;grid-template-columns:1fr;overflow:hidden;border-radius:22px;background:var(--ivory);color:var(--ink);box-shadow:0 0 0 1px rgba(201,167,107,.38),0 26px 50px -26px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.7);transition:transform .4s,box-shadow .4s}.v-card.is-out{filter:grayscale(.85);opacity:.6}@media(hover:hover){.v-card:hover{transform:translateY(-4px);box-shadow:0 0 0 1px var(--gold),0 40px 70px -30px rgba(0,0,0,.9),0 0 50px -20px rgba(201,167,107,.35),inset 0 1px 0 rgba(255,255,255,.7)}}@container(min-width:740px){.v-card{grid-template-columns:minmax(280px,35%) 1fr}}
.v-label{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:38px 30px 34px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,#fffdf7 0%,#f4ebdb 70%,#efe3cd 100%);border-bottom:1px solid rgba(155,123,69,.28)}@container(min-width:740px){.v-label{border-bottom:0;border-right:1px solid rgba(155,123,69,.28);padding:44px 30px}}.v-label::before,.v-label::after{content:"";position:absolute;pointer-events:none;border-radius:13px}.v-label::before{inset:12px;border:1px solid rgba(155,123,69,.5)}.v-label::after{inset:16px;border:1px solid rgba(155,123,69,.22);border-radius:10px}.is-urgent .v-label{background:radial-gradient(120% 90% at 50% 0%,#fffaf6 0%,#f5e6dc 70%,#efd9cc 100%)}
.v-ribbon{position:absolute;top:0;left:50%;z-index:2;transform:translateX(-50%);padding:7px 18px 8px;border-radius:0 0 12px 12px;background:linear-gradient(180deg,var(--bordeaux),var(--bordeaux-deep));color:var(--gold-hi);font-size:10px;font-weight:500;letter-spacing:.26em;text-transform:uppercase;white-space:nowrap;box-shadow:0 8px 18px -8px rgba(74,15,29,.7)}.is-first .v-label{padding-top:52px}
.v-kicker{display:inline-flex;align-items:center;justify-content:center;gap:9px;font-size:10.5px;font-weight:500;letter-spacing:.26em;text-transform:uppercase;color:var(--gold-lo)}.v-kicker .v-dot{box-shadow:inset 0 0 0 1px rgba(0,0,0,.18),0 0 0 3px rgba(155,123,69,.14)}.v-house{margin:16px 0 0;font-family:var(--serif);font-weight:600;font-size:clamp(25px,3.3vw,31px);line-height:1.06;color:var(--ink);text-wrap:balance}.v-cuvee{margin:7px 0 0;font-family:var(--serif);font-style:italic;font-size:20px;line-height:1.2;color:var(--bordeaux);text-wrap:balance}.v-vintage{margin:16px 0 8px;font-family:var(--serif);font-weight:500;font-size:58px;line-height:1;letter-spacing:.05em;color:#9a7638;text-shadow:0 1px 0 rgba(255,255,255,.8)}.v-aoc{display:flex;align-items:center;gap:10px;margin:0;font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-soft)}.v-aoc::before,.v-aoc::after{content:"";width:18px;height:1px;background:rgba(155,123,69,.6)}
.v-details{display:grid;align-content:start;gap:22px;padding:26px 24px 28px}@container(min-width:740px){.v-details{padding:30px 36px 32px}}.v-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.v-status{display:inline-flex;align-items:center;gap:8px;padding:7px 13px;border-radius:999px;font-size:10.5px;font-weight:500;letter-spacing:.18em;text-transform:uppercase}.v-status i{width:6px;height:6px;border-radius:50%;background:currentColor}.v-status--ready{color:var(--gold-ink);background:rgba(201,167,107,.18);box-shadow:inset 0 0 0 1px rgba(155,123,69,.35)}.v-status--urgent{color:var(--garnet);background:rgba(158,43,53,.08);box-shadow:inset 0 0 0 1px rgba(158,43,53,.32)}.v-status--wait,.v-status--out,.v-status--neutral{color:var(--ink-soft);background:rgba(36,22,26,.05);box-shadow:inset 0 0 0 1px rgba(36,22,26,.15)}
.v-qty{display:inline-flex;align-items:center;gap:8px;color:var(--ink)}.v-qty svg{width:11px;height:30px;color:var(--bordeaux)}.v-qty b{font-family:var(--serif);font-size:32px;font-weight:600;line-height:1}.v-qty b small{font-family:var(--sans);font-size:17px;font-weight:300;color:var(--ink-mute);margin-right:4px}
.v-time{display:grid;gap:12px}.v-time-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 14px}.v-cap{margin:0;font-size:10.5px;font-weight:500;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-mute)}.v-years{display:inline-flex;align-items:baseline;gap:12px}.v-years strong{font-family:var(--serif);font-size:23px;font-weight:600;color:var(--ink)}.v-delta{padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--gold-ink);background:rgba(201,167,107,.22)}.is-urgent .v-delta{color:#fff;background:var(--garnet)}.v-track-wrap{padding-top:20px}.v-bar{position:relative;height:8px;border-radius:4px;background-color:rgba(36,22,26,.07);background-image:linear-gradient(90deg,rgba(36,22,26,.14) 1px,transparent 1px);background-size:calc(100% / var(--n,15)) 100%}.v-window{position:absolute;top:0;bottom:0;border-radius:4px;background:linear-gradient(90deg,#e2c891,#b08a48);box-shadow:0 0 14px rgba(201,167,107,.55)}.is-urgent .v-window{background:repeating-linear-gradient(135deg,rgba(158,43,53,.6) 0 5px,rgba(158,43,53,.28) 5px 10px);box-shadow:none}.v-now{position:absolute;top:-6px;bottom:-6px;width:2px;margin-left:-1px;border-radius:1px;background:var(--ink)}.v-now span{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);padding:0 5px;border-radius:4px;background:var(--ink);color:var(--paper);font-size:10.5px;line-height:17px}.v-scale{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;letter-spacing:.08em;color:var(--ink-mute)}
.v-tags{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 0;padding:0;list-style:none}.v-tags li{padding:6px 12px;border:1px solid rgba(155,123,69,.36);border-radius:999px;background:rgba(255,255,255,.55);color:var(--ink-soft);font-size:12.5px}.v-tags li.is-match{border-color:var(--bordeaux);background:var(--bordeaux);color:var(--gold-hi)}
.v-notes-wrap{padding-top:18px;border-top:1px dashed rgba(155,123,69,.4)}.v-notes{margin:10px 0 0;padding-left:18px;border-left:2px solid var(--gold);font-family:var(--serif);font-style:italic;font-size:20.5px;line-height:1.42;color:var(--ink);white-space:pre-line}.v-sep{color:var(--gold);font-style:normal;font-weight:600;padding:0 .12em}.v-place{margin:10px 0 0;font-size:14px;color:var(--ink-soft)}
.v-empty{display:grid;justify-items:center;gap:14px;padding:70px 24px;border:1px dashed var(--line);border-radius:24px;text-align:center;font-family:var(--serif);font-style:italic;font-size:23px;color:rgba(247,241,230,.78)}.v-empty svg{width:34px;height:34px;color:var(--gold)}.v-foot{position:relative;z-index:1;display:grid;justify-items:center;gap:12px;padding:30px 20px 60px;color:rgba(247,241,230,.5);font-size:12px;letter-spacing:.14em;text-align:center}.v-foot svg{width:34px;height:34px;color:var(--gold);opacity:.7}
@media(max-width:560px){.v-main{padding:0 12px 32px}.v-controls{padding:14px;border-radius:20px;gap:16px}.v-row{gap:12px}.v-seg{display:flex;width:100%}.v-seg button{flex:1;justify-content:center;padding:10px 8px;letter-spacing:.1em}.v-meta{width:100%;justify-content:space-between}.v-stat{padding:2px 8px}.v-stat span{letter-spacing:.18em;font-size:9.5px}.v-label{padding:36px 24px 30px}.v-vintage{font-size:50px}.v-details{padding:22px 20px 24px;gap:20px}}
@media(prefers-reduced-motion:reduce){.vinum *{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="vinum">
  <header class="v-hero">
    <svg class="v-monogram" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="38.5" fill="none" stroke="currentColor"/><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" opacity=".55"/><text x="40" y="49" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="29" fill="currentColor">CV</text></svg>
    <h1 class="v-title">Cave <em>Vinum</em></h1><p class="v-tagline">attention, vin à boire</p>
    <div class="v-orn" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M7 0 9 5l5 2-5 2-2 5-2-5-5-2 5-2z" fill="currentColor"/></svg></div>
    <div class="v-stats">
      <div class="v-stat"><b>${bottles(stock)}</b><span>bouteilles</span></div>
      <div class="v-stat"><b>${stock.length}</b><span>références</span></div>
      <div class="v-stat"><b>${year}</b><span>année</span></div>
    </div>
    <div class="v-alerts">${urgent ? `<span class="v-alert v-alert--urgent"><i></i><b>${urgent}</b> à boire en priorité</span>` : ""}${ready ? `<span class="v-alert v-alert--ready"><i></i><b>${ready}</b> prêtes</span>` : ""}</div>
  </header>
  <main class="v-main">
    <section class="v-controls" aria-label="Filtres">
      <label class="v-search"><span class="v-sr">Rechercher</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/></svg><input id="v-q" type="search" placeholder="Rechercher un vin, une appellation…" autocomplete="off"></label>
      <div class="v-row">
        <div class="v-seg" id="v-seg" role="group" aria-label="Couleur">
          <button type="button" data-color="" aria-pressed="true"><span class="v-dot v-dot--all"></span>Toutes <small>${bottles(stock)}</small></button>${colors.map(([key, label]) => `<button type="button" data-color="${esc(key)}" aria-pressed="false"><span class="v-dot v-dot--${["rouge", "blanc", "rose"].includes(key) ? key : "other"}"></span>${esc(label)} <small>${bottles(stock.filter((w) => norm(w.color) === key))}</small></button>`).join("")}
        </div>
        <div class="v-meta"><span class="v-count" id="v-count" aria-live="polite"></span><label class="v-toggle"><input type="checkbox" id="v-out"><span class="v-track"></span>Afficher les épuisés</label></div>
      </div>
      <div class="v-dishes"><span class="v-dishes-label">Quel plat ?</span><div class="v-chips" id="v-chips" role="group" aria-label="Quel plat ?"><button type="button" class="v-chip" data-dish="" aria-pressed="true">Tous</button>${[...KNOWN_TAGS, ...extraTags].map((t) => `<button type="button" class="v-chip${stock.some((w) => w.tags.some((x) => norm(x) === norm(t))) ? "" : " is-zero"}" data-dish="${esc(norm(t))}" aria-pressed="false">${esc(t)} <small>${stock.filter((w) => w.tags.some((x) => norm(x) === norm(t))).length}</small></button>`).join("")}</div></div>
    </section>
    <section class="v-list" id="v-list" aria-label="Vins">
${wines.map((w, i) => renderCard(w, scale, year, i)).join("\n")}
      <div class="v-empty" id="v-empty" hidden><span>Aucun vin adapté dans ta cave pour ce choix.</span></div>
    </section>
  </main>
  <footer class="v-foot"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="38.5" fill="none" stroke="currentColor" stroke-width="1.4"/><text x="40" y="49" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="29" fill="currentColor">CV</text></svg><span>Mis à jour le ${esc(generatedAt)}</span></footer>
</div>
<script>
(function () {
  "use strict";
  var cards = Array.prototype.slice.call(document.querySelectorAll(".v-card"));
  var q = document.getElementById("v-q"), color = "", dish = "", showOut = document.getElementById("v-out").checked;
  var norm = function (s) { return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim(); };
  function render() {
    var query = norm(q.value), count = 0, bottles = 0, first = null;
    cards.forEach(function (card) {
      var d = card.dataset;
      var matches = (showOut || d.stock === "1") && (!color || d.color === color)
        && (!dish || d.tags.split("|").indexOf(dish) !== -1) && (!query || d.search.indexOf(query) !== -1);
      card.hidden = !matches;
      card.classList.remove("is-first");
      if (matches) {
        count++;
        bottles += Number(d.qty) || 0;
        if (!first && d.stock === "1") first = card;
      }
      card.querySelectorAll(".v-tags li").forEach(function (tag) { tag.classList.toggle("is-match", Boolean(dish) && tag.dataset.tag === dish); });
    });
    if (first) {
      first.classList.add("is-first");
      first.querySelector(".v-ribbon").hidden = false;
    }
    cards.forEach(function (card) { if (card !== first) card.querySelector(".v-ribbon").hidden = true; });
    document.getElementById("v-count").innerHTML = "<b>" + count + (count === 1 ? " vin" : " vins") + "</b> · " + bottles + (bottles === 1 ? " bouteille" : " bouteilles");
    document.getElementById("v-empty").hidden = count > 0;
  }
  document.getElementById("v-seg").addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    color = button.dataset.color;
    document.querySelectorAll("#v-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
    render();
  });
  document.getElementById("v-chips").addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    dish = button.dataset.dish;
    document.querySelectorAll("#v-chips button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
    render();
  });
  q.addEventListener("input", render);
  document.getElementById("v-out").addEventListener("change", function (event) { showOut = event.target.checked; render(); });
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(function () {});
})();
</script>
</body>
</html>
`;
}

// Offline support: try the network first, then fall back to the cache.
const SERVICE_WORKER = `const CACHE = "cave-vinum";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("./"))));
});
`;

// Static-host headers: prevent search engine indexing.
const HEADERS = `/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;

// ─── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: "string", default: "dist" }, year: { type: "string" } },
  });
  const now = new Date();
  const parisYear = Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(now));
  const year = values.year ? Number(values.year) : parisYear;
  if (!Number.isInteger(year)) throw new Error("--year must be a year (for example, 2027).");

  const inventoryUrl = process.env.INVENTORY_URL?.trim();
  const csv = inventoryUrl
    ? await fetchCsv(inventoryUrl)
    : await readFile("data/inventory.csv", "utf8").catch((err: unknown) => {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new Error("No inventory source: set INVENTORY_URL or add data/inventory.csv.");
      }
      throw err;
    });

  const warnings: string[] = [];
  const wines = toWines(parseCsv(csv), year, warnings);
  if (wines.length === 0) throw new Error("No wines found in the CSV; refusing to generate an empty report.");

  const generatedAt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" }).format(now);
  const out = values.out ?? "dist";
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(join(out, "index.html"), renderHtml(wines, year, generatedAt)),
    writeFile(join(out, "sw.js"), SERVICE_WORKER),
    writeFile(join(out, "_headers"), HEADERS),
    writeFile(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n"),
  ]);

  for (const w of warnings) console.warn(`⚠ ${w}`);
  const inStock = wines.filter((w) => w.status !== "empty");
  const total = inStock.reduce((s, w) => s + (w.qty ?? 0), 0);
  console.log(`✓ ${inStock.length} wine references in stock, ${total} bottles → ${join(out, "index.html")}`);
}

main().catch((err: unknown) => {
  // Print only the message, never the full error object, which could contain the URL.
  console.error(`✗ ${err instanceof Error ? err.message : "Unknown error"}`);
  process.exitCode = 1;
});
