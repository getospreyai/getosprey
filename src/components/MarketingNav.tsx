import Link from "next/link";

// Feather brand mark — duplicated from app/page.tsx's icon set (not shared
// via import) so this nav has no dependency on the landing page module.
function FeatherIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

/** Shared top nav for public marketing pages (/, /try). */
export default function MarketingNav({ active }: { active?: "try" }) {
  const tryLinkClass =
    active === "try"
      ? "text-sm text-white"
      : "text-sm text-white/60 transition hover:text-white";

  // Wide floating glass pill, centered with inset side margins (nash.ai-style):
  // brand left, actions right. In normal flow, not sticky/fixed — the page's
  // `overflow-hidden` main would break position:sticky, so it floats at the
  // top rather than pinning on scroll.
  return (
    <div className="relative z-20 px-4 pt-5 sm:pt-6">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-full border border-white/15 bg-white/[0.06] py-2.5 pl-5 pr-2.5 shadow-[0_10px_40px_rgba(10,7,24,0.5)] backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-violet-200">
            <FeatherIcon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Osprey</span>
        </Link>

        <div className="flex items-center gap-5 sm:gap-6">
          <Link href="/try" className={tryLinkClass}>
            Try it
          </Link>
          <Link
            href="/login"
            className="text-sm text-white/60 transition hover:text-white"
          >
            Log in
          </Link>
          <Link
            href="/#join"
            className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-medium text-white shadow-[0_0_20px_rgba(139,124,255,0.35)] transition hover:bg-violet-400"
          >
            Join
          </Link>
        </div>
      </nav>
    </div>
  );
}
