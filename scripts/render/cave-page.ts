import { CAVE_CLIENT_JS, CAVE_CSS } from "./cave-page-assets.ts";
import { hasTag, isDrinkSoon, isInStock, KNOWN_TAGS, sameTag, STATUS, STATUS_KEY, colorRank, dotColor, splitName, totalBottles, NOTES_SEPARATOR } from "../lib/wines.ts";
import type { Status, Wine } from "../lib/wines.ts";
import { esc, norm, plural } from "../lib/text.ts";

interface YearScale {
  min: number;
  max: number;
}

/** Position of a year on the timeline, as a percentage string with one decimal. */
const percentOnScale = (y: number, scale: YearScale): string => (((y - scale.min) / (scale.max - scale.min)) * 100).toFixed(1);

function renderPeakBar(peak: { start: number; end: number }, scale: YearScale, year: number): string {
  const left = percentOnScale(peak.start, scale);
  const width = (Number(percentOnScale(peak.end + 1, scale)) - Number(left)).toFixed(1);
  return `<div class="v-track-wrap"><div class="v-bar" style="--n:${scale.max - scale.min}">
    <span class="v-window" style="left:${left}%;width:${width}%"></span>
    <span class="v-now" style="left:${percentOnScale(year + 0.5, scale)}%"><span>${year}</span></span>
  </div><div class="v-scale"><span>${scale.min}</span><span>${scale.max - 1}</span></div></div>`;
}

export interface CardLayout {
  scale: YearScale;
  year: number;
  index: number;
}

/** Delay between the entrance animations of two consecutive cards. */
const CARD_ANIMATION_STEP_MS = 70;

function renderCardLabel(w: Wine): string {
  const { house, cuvee } = splitName(w.name);
  return `<div class="v-label">
    <span class="v-ribbon" hidden>À ouvrir en premier</span>
    ${w.color ? `<span class="v-kicker"><span class="v-dot v-dot--${dotColor(w.color)}"></span>${esc(w.color)}</span>` : ""}
    <h2 class="v-house">${esc(house)}</h2>
    ${cuvee ? `<p class="v-cuvee">${esc(cuvee)}</p>` : ""}
    ${w.vintage !== null ? `<div class="v-vintage">${w.vintage}</div>` : ""}
    ${w.region ? `<p class="v-aoc">${esc(w.region)}</p>` : ""}
  </div>`;
}

function renderCardTop(w: Wine): string {
  return `<div class="v-top"><span class="v-status v-status--${STATUS[w.status].css}"><i></i>${esc(STATUS[w.status].label)}</span>
      <span class="v-qty" aria-label="${plural(w.qty ?? 0, "bouteille")}"><svg viewBox="0 0 11 30" aria-hidden="true"><path d="M4 .5h3v7.2c0 1.1 3.5 2.6 3.5 6.6v14.2c0 .8-.7 1.5-1.5 1.5H2c-.8 0-1.5-.7-1.5-1.5V14.3C.5 10.3 4 8.8 4 7.7z" fill="currentColor"/></svg><b><small>×</small>${w.qty ?? "?"}</b></span>
    </div>`;
}

function renderCardTime(w: Wine, scale: YearScale, year: number): string {
  if (w.peakEnd === null) return "";
  const range = renderPeakBar({ start: w.peakStart ?? w.peakEnd, end: w.peakEnd }, scale, year);
  return `<div class="v-time"><div class="v-time-head"><p class="v-cap">Apogée</p><span class="v-years"><strong>${w.peakStart ?? "?"} → ${w.peakEnd}</strong>${w.yearsLeft !== null ? `<span class="v-delta">${w.yearsLeft > 0 ? "+" : w.yearsLeft < 0 ? "−" : ""}${plural(Math.abs(w.yearsLeft), "an")}</span>` : ""}</span></div>${range}</div>`;
}

function renderCardTags(w: Wine): string {
  return w.tags.length ? `<div><p class="v-cap">Accords mets-vins</p><ul class="v-tags">${w.tags.map((t) => `<li data-tag="${esc(norm(t))}">${esc(t)}</li>`).join("")}</ul></div>` : "";
}

function renderCardNotes(w: Wine): string {
  if (!w.notes) return "";
  const notes = esc(w.notes).replace(NOTES_SEPARATOR, '<span class="v-sep" aria-hidden="true"> · </span>');
  return `<div class="v-notes-wrap"><p class="v-cap">Notes / Service</p><p class="v-notes">${notes}</p></div>`;
}

export function renderCard(w: Wine, { scale, year, index }: CardLayout): string {
  const inStock = isInStock(w);
  const search = norm([w.name, w.vintage ?? "", w.region, w.color, w.notes, ...w.tags].join(" "));
  return `<article class="v-card${isDrinkSoon(w) ? " is-urgent" : ""}${inStock ? "" : " is-out"}" data-color="${esc(norm(w.color))}" data-tags="${esc(w.tags.map(norm).join("|"))}"
  data-search="${esc(search)}" data-stock="${inStock ? 1 : 0}" data-qty="${w.qty ?? 0}" style="animation-delay:${index * CARD_ANIMATION_STEP_MS}ms"${inStock ? "" : " hidden"}>
  ${renderCardLabel(w)}
  <div class="v-details">
    ${renderCardTop(w)}
    ${renderCardTime(w, scale, year)}
    ${renderCardTags(w)}
    ${renderCardNotes(w)}
  </div>
</article>`;
}

interface Inventory {
  stock: Wine[];
  year: number;
  scale: { min: number; max: number };
  colors: (readonly [string, string])[];
  extraTags: string[];
  urgent: number;
  ready: number;
}

function summarize(wines: Wine[], year: number): Inventory {
  const stock = wines.filter(isInStock);
  const bottlesWith = (...statuses: Status[]) => totalBottles(stock.filter((w) => statuses.includes(w.status)));
  const years = wines.flatMap((w) => [w.peakStart, w.peakEnd]).filter((y): y is number => y !== null);
  return {
    stock,
    year,
    scale: { min: Math.min(year, ...years), max: Math.max(year, ...years) + 1 },
    colors: [...new Map(stock.filter((w) => w.color).map((w) => [norm(w.color), w.color] as const))]
      .sort(([a], [b]) => colorRank(a) - colorRank(b)),
    extraTags: [...new Set(stock.flatMap((w) => w.tags))].filter((t) => !KNOWN_TAGS.some((k) => sameTag(k, t))),
    urgent: bottlesWith(STATUS_KEY.URGENT, STATUS_KEY.THIS_YEAR),
    ready: bottlesWith(STATUS_KEY.READY),
  };
}

function renderHero({ stock, year, urgent, ready }: Inventory, title?: string): string {
  const bottles = totalBottles;
  return `<header class="v-hero">
    <svg class="v-monogram" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="38.5" fill="none" stroke="currentColor"/><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" opacity=".55"/><text x="40" y="49" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="29" fill="currentColor">CV</text></svg>
    <h1 class="v-title">Cave <em>Vinum</em></h1><p class="v-tagline">${title ? esc(title) : "Chaque vin a son heure."}</p>
    <div class="v-orn" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M7 0 9 5l5 2-5 2-2 5-2-5-5-2 5-2z" fill="currentColor"/></svg></div>
    <div class="v-stats">
      <div class="v-stat"><b>${bottles(stock)}</b><span>bouteilles</span></div>
      <div class="v-stat"><b>${stock.length}</b><span>références</span></div>
      <div class="v-stat"><b>${year}</b><span>année</span></div>
    </div>
    <div class="v-alerts">${urgent ? `<span class="v-alert v-alert--urgent"><i></i><b>${urgent}</b> à boire en priorité</span>` : ""}${ready ? `<span class="v-alert v-alert--ready"><i></i><b>${ready}</b> prêtes</span>` : ""}</div>
  </header>`;
}

function renderControls({ stock, colors, extraTags }: Inventory): string {
  const bottles = totalBottles;
  return `<section class="v-controls" aria-label="Filtres">
      <label class="v-search"><span class="v-sr">Rechercher</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/></svg><input id="v-q" type="search" placeholder="Rechercher un vin, une région…" autocomplete="off"></label>
      <div class="v-row">
        <div class="v-seg" id="v-seg" role="group" aria-label="Couleur">
          <button type="button" data-color="" aria-pressed="true"><span class="v-dot v-dot--all"></span>Toutes <small>${bottles(stock)}</small></button>${colors.map(([key, label]) => `<button type="button" data-color="${esc(key)}" aria-pressed="false"><span class="v-dot v-dot--${["rouge", "blanc", "rose"].includes(key) ? key : "other"}"></span>${esc(label)} <small>${bottles(stock.filter((w) => norm(w.color) === key))}</small></button>`).join("")}
        </div>
        <div class="v-meta"><span class="v-count" id="v-count" aria-live="polite"></span><label class="v-toggle"><input type="checkbox" id="v-out"><span class="v-track"></span>Afficher les épuisés</label></div>
      </div>
      <div class="v-dishes"><span class="v-dishes-label">Quel plat ?</span><div class="v-chips" id="v-chips" role="group" aria-label="Quel plat ?"><button type="button" class="v-chip" data-dish="" aria-pressed="true">Tous</button>${[...KNOWN_TAGS, ...extraTags].map((t) => `<button type="button" class="v-chip${stock.some((w) => hasTag(w, t)) ? "" : " is-zero"}" data-dish="${esc(norm(t))}" aria-pressed="false">${esc(t)} <small>${stock.filter((w) => hasTag(w, t)).length}</small></button>`).join("")}</div></div>
    </section>`;
}

export function renderHtml(wines: Wine[], year: number, generatedAt: string, title?: string): string {
  const inventory = summarize(wines, year);
  const { scale } = inventory;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#120809">
<title>${title ? `${esc(title)} · Cave Vinum` : "Cave Vinum"}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23120809' stroke='%23c9a76b' stroke-width='2'/%3E%3Ctext x='32' y='41' text-anchor='middle' font-family='Georgia,serif' font-style='italic' font-size='24' fill='%23ead7a8'%3ECV%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
${CAVE_CSS}
</style>
</head>
<body>
<div class="vinum">
${renderHero(inventory, title)}
  <main class="v-main">
    ${renderControls(inventory)}
    <section class="v-list" id="v-list" aria-label="Vins">
${wines.map((w, i) => renderCard(w, { scale, year, index: i })).join("\n")}
      <div class="v-empty" id="v-empty" hidden><span>Aucun vin adapté dans ta cave pour ce choix.</span></div>
    </section>
  </main>
  <footer class="v-foot"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="38.5" fill="none" stroke="currentColor" stroke-width="1.4"/><text x="40" y="49" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="29" fill="currentColor">CV</text></svg><span>Mis à jour le ${esc(generatedAt)} · <a href="../">Cave Vinum</a></span></footer>
</div>
<script>
${CAVE_CLIENT_JS}
</script>
</body>
</html>
`;
}
