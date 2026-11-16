export const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll("(auto)", "")
    .replaceAll(/\s+/gu, " ")
    .trim();

export const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (s: string): string => s.replaceAll(/[&<>"']/gu, (c) => HTML_ESCAPES[c] ?? c);

export const toInt = (v: string | undefined): number | null => {
  const t = (v ?? "").replaceAll(/\s/gu, "");
  return /^[+-]?\d+$/u.test(t) ? Math.trunc(Number(t)) : null;
};

export const plural = (n: number, word: string): string =>
  `${n} ${word}${Math.abs(n) > 1 ? "s" : ""}`;

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isMissingFile = (err: unknown): boolean =>
  err instanceof Error && "code" in err && err.code === "ENOENT";
