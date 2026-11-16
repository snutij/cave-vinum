import { readFile } from "node:fs/promises";
import { isMissingFile, isRecord } from "./text.ts";

/** One cave page, published at /<slug>/. url is an HTTPS CSV URL or a relative local path. */
export interface Cave {
  slug: string;
  url: string;
  title: string;
}
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const DEMO_SLUG = "demo";
export const RESERVED_SLUGS = new Set([DEMO_SLUG]);

/** Public, non-secret links shown on the home page (site.config.json). Empty = hidden. */
export interface SiteConfig {
  templateUrl: string;
  repoUrl: string;
}
export const SITE_CONFIG_FILE = "site.config.json";

/** "bob" → "Cave de Bob", "alice" → "Cave d'Alice", "jean-marc" → "Cave de Jean-Marc". */
export function defaultTitle(slug: string): string {
  const name = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
  return /^[aeiouy]/i.test(slug) ? `Cave d'${name}` : `Cave de ${name}`;
}

/** INVENTORIES: JSON array of { slug, url, title? }. Error messages never include the URLs. */
export function resolveCaves(): Cave[] {
  const raw = process.env.INVENTORIES?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("INVENTORIES must be valid JSON."); }
  if (!Array.isArray(parsed)) {
    throw new Error('INVENTORIES must be a JSON array, for example [{"slug": "alice", "url": "https://…", "title": "La cave d\'Alice"}].');
  }
  const seen = new Set<string>();
  return parsed.map((item: unknown, i): Cave => {
    const where = `INVENTORIES[${i}]`;
    if (!isRecord(item)) throw new Error(`${where} must be an object with "slug" and "url".`);
    const { slug, url, title } = item;
    if (typeof slug !== "string" || !SLUG.test(slug)) {
      throw new Error(`${where}: "slug" is required and uses lowercase letters, digits and dashes (for example "alice").`);
    }
    if (RESERVED_SLUGS.has(slug)) throw new Error(`${where}: "${slug}" is reserved, choose another slug.`);
    if (seen.has(slug)) throw new Error(`${where}: duplicate slug "${slug}".`);
    seen.add(slug);
    if (typeof url !== "string" || !url.trim()) throw new Error(`${where} ("${slug}"): "url" is required.`);
    if (title !== undefined && typeof title !== "string") throw new Error(`${where} ("${slug}"): "title" must be text.`);
    return { slug, url: url.trim(), title: title?.trim() || defaultTitle(slug) };
  });
}

export async function readSiteConfig(): Promise<SiteConfig> {
  const raw = await readFile(SITE_CONFIG_FILE, "utf8").catch((err: unknown) => {
    if (isMissingFile(err)) return "{}";
    throw err;
  });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${SITE_CONFIG_FILE} must be valid JSON.`); }
  const obj = isRecord(parsed) ? parsed : {};
  const pick = (key: keyof SiteConfig): string => {
    const value = obj[key];
    const v = typeof value === "string" ? value.trim() : "";
    if (v && !v.startsWith("https://")) throw new Error(`${SITE_CONFIG_FILE}: "${key}" must be an HTTPS URL or empty.`);
    return v;
  };
  return { templateUrl: pick("templateUrl"), repoUrl: pick("repoUrl") };
}
