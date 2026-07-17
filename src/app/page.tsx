import WaitlistForm from "@/components/WaitlistForm";
import Backdrop from "@/components/Backdrop";

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

const socials = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/getospreyai/",
    path: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </>
    ),
    fill: false,
  },
];

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      {/* nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-violet-200">
            <FeatherIcon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Osprey</span>
        </div>
        <a
          href="mailto:hello@getosprey.ai"
          className="text-sm text-white/60 transition hover:text-white"
        >
          Need help?
        </a>
      </nav>

      {/* hero */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <span className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-violet-100 shadow-[0_0_45px_rgba(139,124,255,0.4)] backdrop-blur-md">
          <FeatherIcon className="h-6 w-6" />
        </span>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Join the{" "}
          <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic">
            waitlist
          </span>
        </h1>

        <p className="mt-4 max-w-md text-balance text-base text-white/60 sm:text-lg">
          Osprey is almost here. Drop your details and be first to know the
          moment we launch.
        </p>

        <div className="mt-9 w-full max-w-md">
          <WaitlistForm />
        </div>

        {/* social */}
        <div className="mt-8 flex items-center gap-3">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                fill={s.fill ? "currentColor" : "none"}
                stroke={s.fill ? "none" : "currentColor"}
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                {s.path}
              </svg>
            </a>
          ))}
        </div>
      </div>

      <footer className="relative z-10 flex flex-col items-center gap-1 px-6 pb-8 text-xs text-white/40">
        <p>&copy; {new Date().getFullYear()} Osprey. All rights reserved.</p>
        <a href="/privacy" className="underline hover:text-white/70">
          Privacy Policy
        </a>
      </footer>
    </main>
  );
}
