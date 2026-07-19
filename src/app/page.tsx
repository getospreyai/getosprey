import WaitlistForm from "@/components/WaitlistForm";
import Backdrop from "@/components/Backdrop";
import PhoneDemo from "@/components/PhoneDemo";

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

const steps = [
  {
    title: "Set your buy box",
    body: "Markets, property types, price range — and how you actually buy: FHA, conventional, DSCR, or cash. Run multiple financing profiles at once.",
  },
  {
    title: "Osprey underwrites everything",
    body: "Every matching listing gets a full workup at your numbers — cash flow, cap rate, cash-on-cash, DSCR, break-even — before it ever reaches you.",
  },
  {
    title: "You get the verdict",
    body: "One text with the number that matters: monthly cash flow at your financing. Clears your bar, you hear about it. Doesn't, you don't.",
  },
];

const portalPoints = [
  "Every new listing, zero analysis",
  "You run the numbers at midnight",
  "The same alert every other buyer got",
  "One more app to check",
];

const ospreyPoints = [
  "Only deals that clear your cash-flow bar",
  "Underwritten before it hits your phone",
  "Your down payment, your rate, your loan",
  "Lives in your texts — reply to dig in",
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
      <section className="relative z-10 px-6 pb-16 pt-8 sm:px-10 lg:pt-14">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs text-violet-100 backdrop-blur-md">
              <FeatherIcon className="h-3.5 w-3.5" />
              Launching first in Nevada · Single-family to fourplex
            </span>

            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Every app sends you listings.{" "}
              <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
                Osprey sends you verdicts.
              </span>
            </h1>

            <p className="mt-5 max-w-xl text-balance text-base text-white/60 sm:text-lg">
              Osprey is an AI deal-finder for real-estate investors. It watches
              the market, underwrites every listing at{" "}
              <span className="text-white/85">your</span> financing, and texts
              you only when a property clears your cash-flow bar. No dashboards
              to babysit. No midnight spreadsheets. Just a text when a deal is
              worth your time.
            </p>

            <div id="join" className="mt-8 w-full max-w-md scroll-mt-24">
              <p className="mb-3 text-sm text-white/50">
                Join the waitlist — founding members get first access at launch
                pricing.
              </p>
              <WaitlistForm />
            </div>
          </div>

          <div>
            <PhoneDemo />
            <p className="mt-4 text-center text-xs text-white/40">
              Real output from Osprey&apos;s underwriting engine — not a mockup
              of one.
            </p>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="relative z-10 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            How Osprey{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              hunts
            </span>
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md"
              >
                <span className="text-sm font-medium text-violet-300">
                  0{i + 1}
                </span>
                <h3 className="mt-2 text-lg font-medium">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-white/50">
            Below your bar, Osprey stays quiet — and every deal it saw still
            lands on your dashboard.{" "}
            <span className="text-white/70">Silence is a feature.</span>
          </p>
        </div>
      </section>

      {/* comparison */}
      <section className="relative z-10 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-balance text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Alerts tell you something was listed.{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              Osprey tells you what it&apos;s worth — to you.
            </span>
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide text-white/40">
                Portal alerts
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-white/55">
                {portalPoints.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span aria-hidden className="text-white/30">
                      —
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-violet-400/30 bg-violet-500/[0.08] p-6 shadow-[0_0_45px_rgba(139,124,255,0.15)] backdrop-blur-md">
              <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-violet-200">
                <FeatherIcon className="h-4 w-4" /> Osprey
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-white/85">
                {ospreyPoints.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span aria-hidden className="text-violet-300">
                      ✓
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-white/50">
            {["FHA", "Conventional", "DSCR", "Cash"].map((k) => (
              <span
                key={k}
                className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1"
              >
                {k}
              </span>
            ))}
            <span className="px-1">
              — every way you buy is a first-class citizen.
            </span>
          </div>
        </div>
      </section>

      {/* final CTA */}
      <section className="relative z-10 px-6 py-16 text-center sm:px-10">
        <div className="mx-auto max-w-xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Let Osprey{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              hunt for you.
            </span>
          </h2>
          <p className="mt-4 text-white/60">
            Free to join. Nevada investors get the first verdicts — the rest of
            the West is next.
          </p>
          <a
            href="#join"
            className="mt-7 inline-block rounded-xl bg-indigo-500 px-8 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400"
          >
            Join the waitlist
          </a>

          <div className="mt-10 flex items-center justify-center gap-3">
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
      </section>

      <footer className="relative z-10 flex flex-col items-center gap-1 px-6 pb-8 text-xs text-white/40">
        <p>&copy; {new Date().getFullYear()} Osprey. All rights reserved.</p>
        <a href="/privacy" className="underline hover:text-white/70">
          Privacy Policy
        </a>
      </footer>
    </main>
  );
}
