export const norm = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\(auto\)/g, "").replace(/\s+/g, " ").trim();

export const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

export const toInt = (v: string | undefined): number | null => {
  const t = (v ?? "").replace(/\s/g, "");
  return /^[+-]?\d+$/.test(t) ? Number.parseInt(t, 10) : null;
};

export const plural = (n: number, word: string): string => `${n} ${word}${Math.abs(n) > 1 ? "s" : ""}`;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isMissingFile = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "ENOENT";
