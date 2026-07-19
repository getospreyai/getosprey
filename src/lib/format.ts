// Small formatting helpers shared by the dashboard and settings pages.
// Deliberately dependency-free (no date/number-formatting libraries).

/** "3h ago" / "5d ago" style relative timestamp from an ISO date string. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;

  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;

  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/** "$150,000" — plain dollar formatting, no cents. */
export function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "+$633/mo" or "−$811/mo" — always signed, for cash-flow figures. */
export function formatSignedMonthly(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "−" : "+";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}/mo`;
}
