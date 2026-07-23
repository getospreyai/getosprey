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

  return (
    <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-violet-200">
          <FeatherIcon className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Osprey</span>
      </Link>
      <div className="flex items-center gap-5">
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
          className="rounded-full border border-violet-400/40 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20"
        >
          Join
        </Link>
      </div>
    </nav>
  );
}
