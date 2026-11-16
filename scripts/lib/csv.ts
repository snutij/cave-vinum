import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isMissingFile } from "./text.ts";

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_FETCH_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 2000;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVER_ERROR = 500;
const BYTE_ORDER_MARK = "\uFEFF";
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** RFC 4180 CSV parser: quotes, escaped "", commas and newlines in fields, CRLF, and BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (next === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") endField();
    else if (c === "\r" && next === "\n") {
      endRow();
      i++;
    } else if (c === "\n" || c === "\r") endRow();
    else field += c;
  }
  if (inQuotes) throw new Error("Invalid CSV: unterminated quoted field.");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// ─── Fetch CSV ─────────────────────────────────────────────────────────────
export type FetchAttempt = { text: string } | { reason: string; retryable: boolean };

export async function attemptFetch(url: URL): Promise<FetchAttempt> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((error: unknown) => error);
  if (!(res instanceof Response)) {
    return {
      reason:
        res instanceof Error && res.name === "TimeoutError" ? "request timed out" : "network error",
      retryable: true,
    };
  }
  if (!res.ok) {
    return {
      reason: `HTTP ${res.status}`,
      retryable: res.status >= HTTP_SERVER_ERROR || res.status === HTTP_TOO_MANY_REQUESTS,
    };
  }
  // A CSV URL may return an HTML error page instead of the export.
  if ((res.headers.get("content-type") ?? "").includes("html")) {
    throw new Error("The CSV URL returned HTML instead of CSV (is the sheet published as CSV?).");
  }
  return { text: await res.text() };
}

export async function fetchCsv(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("The CSV URL must be a valid URL.");
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("The CSV URL must use HTTPS.");
  }
  let reason = "";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const result = await attemptFetch(url);
    if ("text" in result) return result.text;
    ({ reason } = result);
    if (!result.retryable || attempt === MAX_FETCH_ATTEMPTS) break;
    await delay(attempt * RETRY_BACKOFF_MS);
  }
  throw new Error(`Could not download CSV (${reason}).`);
}

/** HTTPS URL, or a relative path inside the project (handy for local tests). */
export async function loadCsv(url: string): Promise<string> {
  if (/^https?:\/\//iu.test(url)) return fetchCsv(url);
  if (isAbsolute(url) || url.split(/[\\/]/u).includes("..")) {
    throw new Error(
      'A local "url" must be a relative path inside the project (for example "data/inventory.csv").',
    );
  }
  try {
    return await readFile(url, "utf8");
  } catch (error: unknown) {
    throw isMissingFile(error) ? new Error("Local CSV file not found.", { cause: error }) : error;
  }
}
