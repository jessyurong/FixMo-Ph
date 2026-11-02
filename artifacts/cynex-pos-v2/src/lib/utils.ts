import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount)
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date))
}

/**
 * Rank-first text search. Never hides rows — it only reorders them so the
 * best matches appear on top:
 *   0 = name starts with the term
 *   1 = name contains the term
 *   2 = an extra field (e.g. category) starts with the term
 *   3 = an extra field contains the term
 *   4 = no match (stays at the bottom, original order kept)
 */
export function rankFirst<T>(
  rows: T[],
  term: string,
  fields: (row: T) => { name: string; extra?: Array<string | undefined | null> },
): T[] {
  const t = term.trim().toLowerCase();
  if (!t) return rows;
  return rows
    .map((row, index) => {
      const { name, extra } = fields(row);
      const n = String(name ?? "").toLowerCase();
      let score = 4;
      if (n.startsWith(t)) {
        score = 0;
      } else if (n.includes(t)) {
        score = 1;
      } else if (extra) {
        for (const e of extra) {
          const s = String(e ?? "").toLowerCase();
          if (!s) continue;
          if (s.startsWith(t)) {
            score = 2;
            break;
          }
          if (s.includes(t)) {
            score = 3;
            break;
          }
        }
      }
      return { row, score, index };
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((s) => s.row);
}
