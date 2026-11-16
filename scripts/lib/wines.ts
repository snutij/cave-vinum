import { LOCALE } from "./locale.ts";
import { norm, toInt } from "./text.ts";

export interface Wine {
  name: string;
  vintage: number | null;
  qty: number | null;
  color: string;
  region: string;
  peakStart: number | null;
  peakEnd: number | null;
  tags: string[];
  notes: string;
  status: Status;
  yearsLeft: number | null;
}

export const STATUS_KEY = {
  URGENT: "urgent",
  THIS_YEAR: "this-year",
  READY: "ready",
  KEEP: "keep",
  INCOMPLETE: "incomplete",
  EMPTY: "empty",
} as const;

export type Status = (typeof STATUS_KEY)[keyof typeof STATUS_KEY];

/** css is the modifier used by the status badge and the card. */
export const STATUS: Record<Status, { rank: number; label: string; css: string }> = {
  [STATUS_KEY.URGENT]: { rank: 1, label: "Urgent (apogée dépassée)", css: "urgent" },
  [STATUS_KEY.THIS_YEAR]: { rank: 2, label: "À boire cette année", css: "urgent" },
  [STATUS_KEY.READY]: { rank: 3, label: "Prêt à boire", css: "ready" },
  [STATUS_KEY.KEEP]: { rank: 4, label: "À garder (trop jeune)", css: "wait" },
  [STATUS_KEY.INCOMPLETE]: { rank: 5, label: "Infos à compléter", css: "neutral" },
  [STATUS_KEY.EMPTY]: { rank: 6, label: "Épuisé", css: "out" },
};

export const isInStock = (w: Wine): boolean => w.status !== STATUS_KEY.EMPTY;
export const isDrinkSoon = (w: Wine): boolean => w.status === STATUS_KEY.URGENT || w.status === STATUS_KEY.THIS_YEAR;

export const sameTag = (a: string, b: string): boolean => norm(a) === norm(b);
export const hasTag = (w: Wine, tag: string): boolean => w.tags.some((t) => sameTag(t, tag));

/** Sort fallbacks: wines with unknown peak sort last, unknown colours after known ones. */
export const UNKNOWN_YEARS_LEFT = 999;
export const UNRANKED_COLOR = 99;
/** A wine name is "House - Cuvée"; notes separate items with " · ". */
export const NAME_SEPARATOR = " - ";
export const NOTES_SEPARATOR = /\s+·\s+/g;

/** Tags offered by the filter, in order (unknown tags are appended). */
export const KNOWN_TAGS = [
  "Apéro", "Fruits de mer", "Poisson", "Volaille & viande blanche",
  "Viande rouge & grillades", "Plat mijoté & gibier", "Charcuterie & cuisine italienne",
  "Végétarien", "Épicé & cuisine du monde", "Fromage", "Dessert",
];

/** CSV positions from the supplied workbook. Header text is intentionally ignored. */
export const COLUMN = {
  name: 0,
  vintage: 1,
  qty: 2,
  color: 3,
  region: 4,
  peakStart: 5,
  peakEnd: 6,
  tags: 7,
  notes: 8,
} as const;
export const CSV_COLUMN_COUNT = 9;

export const COLOR_ORDER = ["rouge", "blanc", "rose", "bulles"];
export const colorRank = (key: string): number => (COLOR_ORDER.indexOf(key) + 1) || UNRANKED_COLOR;
/** Colours with their own dot; any other colour uses the fallback dot. */
const DOT_COLORS = ["rouge", "blanc", "rose"];
const FALLBACK_DOT_COLOR = "other";
export const dotColor = (color: string): string => (DOT_COLORS.includes(norm(color)) ? norm(color) : FALLBACK_DOT_COLOR);

export function splitName(name: string): { house: string; cuvee: string } {
  const [house = "", ...cuvee] = name.split(NAME_SEPARATOR);
  return { house, cuvee: cuvee.join(NAME_SEPARATOR) };
}

export function computeStatus({ qty, peakStart: start, peakEnd: end }: Pick<Wine, "qty" | "peakStart" | "peakEnd">, year: number): Pick<Wine, "status" | "yearsLeft"> {
  if (qty !== null && qty <= 0) return { status: STATUS_KEY.EMPTY, yearsLeft: null };
  const yearsLeft = end === null ? null : end - year;
  if (qty === null || end === null || (start !== null && start > end)) return { status: STATUS_KEY.INCOMPLETE, yearsLeft };
  if (end < year) return { status: STATUS_KEY.URGENT, yearsLeft };
  if (end === year) return { status: STATUS_KEY.THIS_YEAR, yearsLeft };
  if (start === null || year >= start) return { status: STATUS_KEY.READY, yearsLeft };
  return { status: STATUS_KEY.KEEP, yearsLeft };
}

export function toWines(rows: string[][], year: number): { wines: Wine[]; warnings: string[] } {
  const [header, ...data] = rows;
  if (!header) throw new Error("CSV vide.");
  if (header.length < CSV_COLUMN_COUNT) {
    throw new Error(`Incomplete CSV: expected at least ${CSV_COLUMN_COUNT} columns in the template's order.`);
  }
  const warnings: string[] = [];
  const wines: Wine[] = [];
  data.forEach((row, i) => {
    const wine = parseWineRow(row, year);
    if (!wine) return;
    warnings.push(...rowWarnings(wine, i + FIRST_DATA_LINE));
    wines.push(wine);
  });
  return { wines: sortForDrinking(wines), warnings };
}

/** Spreadsheet line of the first data row (the header is line 1). */
const FIRST_DATA_LINE = 2;
const TAG_SEPARATOR = /[,;]/;

const cell = (row: string[], key: keyof typeof COLUMN): string => (row[COLUMN[key]] ?? "").trim();

/** Returns null for a blank line (no wine name). */
function parseWineRow(row: string[], year: number): Wine | null {
  const name = cell(row, "name");
  if (!name) return null;
  const qty = toInt(cell(row, "qty"));
  const peakStart = toInt(cell(row, "peakStart"));
  const peakEnd = toInt(cell(row, "peakEnd"));
  return {
    name,
    vintage: toInt(cell(row, "vintage")),
    qty,
    peakStart,
    peakEnd,
    tags: [...new Set(cell(row, "tags").split(TAG_SEPARATOR).map((t) => t.trim()).filter(Boolean))],
    color: cell(row, "color"),
    region: cell(row, "region"),
    notes: cell(row, "notes"),
    ...computeStatus({ qty, peakStart, peakEnd }, year),
  };
}

function rowWarnings(wine: Wine, line: number): string[] {
  const where = `ligne ${line} (${wine.name})`;
  const warnings: string[] = [];
  if (wine.qty === null) warnings.push(`${where} : quantité vide ou invalide`);
  if (wine.peakEnd === null) warnings.push(`${where} : apogée fin vide ou invalide`);
  if (wine.peakStart !== null && wine.peakEnd !== null && wine.peakStart > wine.peakEnd) warnings.push(`${where} : apogée début > apogée fin`);
  return warnings;
}

/** Sort by status, years remaining, oldest vintage (non-vintage first), then name. */
function sortForDrinking(wines: Wine[]): Wine[] {
  return wines.sort((a, b) =>
    STATUS[a.status].rank - STATUS[b.status].rank
    || (a.yearsLeft ?? UNKNOWN_YEARS_LEFT) - (b.yearsLeft ?? UNKNOWN_YEARS_LEFT)
    || (a.vintage ?? 0) - (b.vintage ?? 0)
    || a.name.localeCompare(b.name, LOCALE));
}

export function totalBottles(list: Wine[]): number {
  return list.reduce((sum, w) => sum + (w.qty ?? 0), 0);
}
