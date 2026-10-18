/**
 * Cave Vinum: generate the static wine-cellar site from a CSV published by Google Sheets.
 *
 *   CAVE_CSV_URL="https://docs.google.com/…/pub?…&output=csv" node scripts/build-report.ts
 *   node scripts/build-report.ts --file "Inventaire.csv"         # local test
 *   node scripts/build-report.ts --file "Inventaire.csv" --year 2027 --out dist
 *
 * Node >= 22.18 (runs TypeScript natively). No runtime dependencies.
 * Security: the CSV URL is never printed to logs or included in the HTML.
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
  if (inQuotes) throw new Error("CSV invalide : guillemet non fermé.");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Fetch CSV without exposing its URL ────────────────────────────────────
async function fetchCsv(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("CAVE_CSV_URL n'est pas une URL valide."); }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("CAVE_CSV_URL doit être une URL https.");
  }
  let reason = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) })
      .catch((err: unknown) => new Error(err instanceof Error && err.name === "TimeoutError" ? "délai dépassé" : "erreur réseau"));
    if (res instanceof Error) {
      reason = res.message;
    } else if (res.ok) {
      // Google returns HTML if publishing is disabled or the link is not a CSV export.
      if ((res.headers.get("content-type") ?? "").includes("html")) {
        throw new Error("Le lien renvoie une page HTML et non un CSV : vérifier que l'onglet est publié au format CSV.");
      }
      return await res.text();
    } else {
      reason = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // inutile de réessayer une erreur client
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2_000));
  }
  throw new Error(`Téléchargement du CSV impossible (${reason}).`);
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
function renderCard(w: Wine, scale: { min: number; max: number }, year: number): string {
  const inStock = w.status !== "empty";
  const colorKey = norm(w.color) || "autre";
  const pct = (y: number) => (((y - scale.min) / (scale.max - scale.min)) * 100).toFixed(1);
  const left = w.yearsLeft === null ? "" : w.yearsLeft === 0 ? "dernière année" : `${w.yearsLeft > 0 ? "+" : ""}${plural(w.yearsLeft, "an")}`;
  const window = w.peakEnd === null
    ? `<p class="window-text">Apogée non renseignée</p>`
    : `<div class="bar" aria-hidden="true">
        <span class="range" style="left:${pct(w.peakStart ?? w.peakEnd)}%;width:${(Number(pct(w.peakEnd + 1)) - Number(pct(w.peakStart ?? w.peakEnd))).toFixed(1)}%"></span>
        <span class="now" style="left:${pct(year + 0.5)}%"></span>
      </div>
      <p class="window-text">Apogée ${w.peakStart ?? "?"} → ${w.peakEnd}${left ? ` · <strong>${left}</strong>` : ""}</p>`;
  const meta = [w.color, w.appellation, w.location && `Emplacement ${w.location}`].filter(Boolean).map(esc).join(" · ");
  const notes = w.notes ? `<ul class="notes">${w.notes.split(/\s+·\s+/).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const tags = w.tags.length ? `<ul class="tags">${w.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  const search = norm([w.name, w.vintage ?? "", w.appellation, w.color, w.location, w.notes, ...w.tags].join(" "));

  return `<article class="card c-${esc(colorKey)} st-${w.status}" data-color="${esc(colorKey)}" data-tags="${esc(w.tags.map(norm).join("|"))}"
  data-search="${esc(search)}" data-stock="${inStock ? 1 : 0}" data-qty="${w.qty ?? 0}"${inStock ? "" : " hidden"}>
  <div class="top"><span class="badge s-${w.status}">${STATUS[w.status].label}</span><span class="qty">${w.qty === null ? "? bt." : `× ${w.qty}`}</span></div>
  <h2>${esc(w.name)} <span class="vintage">${w.vintage ?? "NM"}</span></h2>
  <p class="meta">${meta}</p>
  ${window}
  ${tags}
  ${notes}
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

  const summary = [
    [by("urgent", "this-year"), "à boire en priorité", "s-urgent"],
    [by("ready"), "prêtes", "s-ready"],
    [by("keep"), "à garder", "s-keep"],
    [by("incomplete"), "à compléter", "s-incomplete"],
  ].filter(([n]) => Number(n) > 0).map(([n, label, cls]) => `<li class="badge ${cls}">${n} ${label}</li>`).join("");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#4a1525">
<title>Cave Vinum</title>
<style>
:root{--bg:#f6f3f1;--card:#fff;--text:#1f1a17;--muted:#6b625d;--line:#e7e0dc;--wine:#4a1525;--accent:#7a2038}
@media (prefers-color-scheme:dark){:root{--bg:#141012;--card:#1f191c;--text:#f2ecea;--muted:#a99f9b;--line:#352b2f;--accent:#e2a2b4}}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
header{background:var(--wine);color:#fff;padding:16px 16px 12px}
h1{margin:0;font-size:22px;letter-spacing:.02em}
.motto{font-size:13px;font-weight:400;font-style:italic;letter-spacing:0;opacity:.8;margin-left:4px}
.sub{margin:2px 0 10px;opacity:.85;font-size:13px}
.summary{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.controls{position:sticky;top:0;z-index:2;background:var(--bg);padding:10px 12px;border-bottom:1px solid var(--line);display:grid;gap:8px}
.controls input[type=search],.controls select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font-size:16px}
.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.chip{flex:none;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);cursor:pointer;font-size:14px}
.chip input{display:none}.chip small{color:var(--muted)}
.chip:has(input:checked){background:var(--accent);border-color:var(--accent);color:#fff}.chip:has(input:checked) small{color:#fff}
.row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted)}
main{padding:12px;display:grid;gap:12px;max-width:760px;margin:0 auto}
.card{position:relative;background:var(--card);border-radius:14px;padding:14px 14px 12px;border-left:6px solid var(--muted);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.c-rouge{border-left-color:#9f1239}.c-blanc{border-left-color:#ca8a04}.c-rose{border-left-color:#db2777}.c-bulles{border-left-color:#0284c7}
.card.s-empty{opacity:.55}
.card.first{outline:2px solid var(--accent)}
.card.first::before{content:"À ouvrir en premier";position:absolute;top:-10px;right:12px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700}
.s-urgent{background:#fde8e8;color:#9b1c1c}.s-this-year{background:#fef3c7;color:#92400e}.s-ready{background:#def7ec;color:#03543f}
.s-keep{background:#e1effe;color:#1e429f}.s-incomplete{background:#ede9fe;color:#5b21b6}.s-empty{background:#f3f4f6;color:#6b7280}
.card.s-urgent,.card.s-this-year,.card.s-ready,.card.s-keep,.card.s-incomplete,.card.s-empty{background:var(--card);color:var(--text)}
.qty{font-weight:800;font-size:18px}
h2{margin:8px 0 2px;font-size:17px;line-height:1.3}
.vintage{color:var(--accent);white-space:nowrap}
.meta{margin:0 0 8px;color:var(--muted);font-size:13px}
.bar{position:relative;height:8px;border-radius:99px;background:var(--line);margin:4px 0}
.range{position:absolute;top:0;bottom:0;border-radius:99px;background:#86b89a}
.st-urgent .range{background:#e59a9a}.st-this-year .range{background:#e8b65a}.st-keep .range{background:#8fb0e8}.st-incomplete .range{background:#b9a6e8}
.now{position:absolute;top:-4px;width:2px;height:16px;background:var(--text);border-radius:2px}
.window-text{margin:2px 0 8px;font-size:13px}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 8px;padding:0;list-style:none}
.tags li{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--line)}
.notes{margin:0;padding-left:18px;font-size:13px;color:var(--muted)}
#none{text-align:center;color:var(--muted);padding:24px}
footer{text-align:center;color:var(--muted);font-size:12px;padding:16px 12px 32px}
</style>
</head>
<body>
<header>
  <h1>Cave Vinum <span class="motto">attention, vin à boire</span></h1>
  <p class="sub">${plural(bottles(stock), "bouteille")} · ${plural(stock.length, "référence")} · année ${year}</p>
  <ul class="summary">${summary}</ul>
</header>
<form class="controls" onsubmit="return false">
  <input type="search" id="q" placeholder="Rechercher un vin, une appellation…" aria-label="Rechercher" autocomplete="off">
  <div class="chips" role="radiogroup" aria-label="Couleur">
    <label class="chip"><input type="radio" name="color" value="" checked> Toutes <small>${bottles(stock)}</small></label>${colorChips}
  </div>
  <select id="meal" aria-label="Quel plat ?"><option value="">Quel plat ? (tous)</option>${mealOptions}</select>
  <div class="row"><span id="count" aria-live="polite"></span><label><input type="checkbox" id="showEmpty"> Afficher les épuisés</label></div>
</form>
<main>
${wines.map((w) => renderCard(w, scale, year)).join("\n")}
<p id="none" hidden>Aucun vin adapté dans ta cave pour ce choix.</p>
</main>
<footer>Mis à jour le ${esc(generatedAt)}</footer>
<script>
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var norm = function (s) { return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim(); };
  function apply() {
    var q = norm(document.getElementById("q").value);
    var color = document.querySelector("input[name=color]:checked").value;
    var meal = document.getElementById("meal").value;
    var showEmpty = document.getElementById("showEmpty").checked;
    var n = 0, bottles = 0, firstDone = false;
    cards.forEach(function (c) {
      var d = c.dataset;
      var ok = (showEmpty || d.stock === "1") && (!color || d.color === color)
        && (!meal || d.tags.split("|").indexOf(meal) !== -1) && (!q || d.search.indexOf(q) !== -1);
      c.hidden = !ok;
      var first = ok && !firstDone && d.stock === "1";
      c.classList.toggle("first", first);
      if (first) firstDone = true;
      if (ok) { n++; bottles += Number(d.qty) || 0; }
    });
    document.getElementById("count").textContent = n + " vin" + (n > 1 ? "s" : "") + " · " + bottles + " bouteille" + (bottles > 1 ? "s" : "");
    document.getElementById("none").hidden = n > 0;
  }
  document.addEventListener("input", apply);
  document.addEventListener("change", apply);
  apply();
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

// Cloudflare Pages headers: prevent search engine indexing.
const HEADERS = `/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;

// ─── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { file: { type: "string" }, out: { type: "string", default: "dist" }, year: { type: "string" } },
  });
  const now = new Date();
  const parisYear = Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(now));
  const year = values.year ? Number(values.year) : parisYear;
  if (!Number.isInteger(year)) throw new Error("--year doit être une année (ex. 2027).");

  let csv: string;
  if (values.file) {
    csv = await readFile(values.file, "utf8");
  } else if (process.env.CAVE_CSV_URL) {
    csv = await fetchCsv(process.env.CAVE_CSV_URL);
  } else {
    throw new Error("Aucune source : définir CAVE_CSV_URL (Cloudflare > projet > Settings > Variables and Secrets) ou passer --file <chemin.csv>.");
  }

  const warnings: string[] = [];
  const wines = toWines(parseCsv(csv), year, warnings);
  if (wines.length === 0) throw new Error("Aucun vin trouvé dans le CSV : rien n'est publié (le site actuel reste en ligne).");

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
  console.log(`✓ ${plural(inStock.length, "référence")} en stock, ${plural(total, "bouteille")} → ${join(out, "index.html")}`);
}

main().catch((err: unknown) => {
  // Print only the message, never the full error object, which could contain the URL.
  console.error(`✗ ${err instanceof Error ? err.message : "Erreur inconnue"}`);
  process.exitCode = 1;
});
