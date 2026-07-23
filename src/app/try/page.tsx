import type { Metadata } from "next";
import Link from "next/link";
import Backdrop from "@/components/Backdrop";
import TryDemo from "@/components/TryDemo";
import { DEMO_BAR, DEMO_DEALS, DEMO_FINANCING, dealProperty, rentIncome } from "@/lib/demo-deals";
import { project, solveMaxOffer, underwrite } from "@/osprey/engine";

// Public marketing page — no auth gate, deliberately indexable (unlike
// dashboard/property). Do not add a `robots` field here.
export const metadata: Metadata = {
  title: "Try Osprey — See a real verdict, no signup",
  description:
    "Pick a sample property, flip the financing, and watch Osprey's underwriting engine produce a real cash-flow verdict live. No signup required.",
};

export default function TryPage() {
  // Server-computed default so the first paint (and any crawler) sees a
  // correct verdict with zero client-side work — TryDemo takes it as `initial`
  // and only calls /api/try once a visitor actually changes something.
  const deal = DEMO_DEALS[0];
  const property = dealProperty(deal);
  const income = rentIncome(deal);
  const underwriting = underwrite({ property, income, financing: DEMO_FINANCING });
  const projection = project(underwriting, 10);
  const maxOffer = solveMaxOffer({
    property,
    income,
    financing: DEMO_FINANCING,
    targetMonthlyCashFlow: DEMO_BAR,
  });

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Osprey
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-white/60 transition hover:text-white">
            Log in
          </Link>
          <Link href="/#join" className="text-sm text-white/60 transition hover:text-white">
            Join
          </Link>
        </div>
      </nav>

      <section className="relative z-10 px-6 pb-20 pt-8 sm:px-10 lg:pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            See what Osprey{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              actually says.
            </span>
          </h1>
          <p className="mt-5 text-balance text-base text-white/60 sm:text-lg">
            Pick a sample property, flip the financing, and watch a real verdict recompute.{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              No signup required.
            </span>
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl">
          <TryDemo deals={DEMO_DEALS} initial={{ dealId: deal.id, underwriting, projection, maxOffer }} />
          <p className="mt-4 text-center text-xs text-white/40">
            Illustrative properties, real math — every figure is live output from Osprey&apos;s underwriting
            engine.
          </p>
        </div>

        {/* address teaser — copy only, no input: not a live lookup today */}
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center backdrop-blur-md">
          <p className="text-sm text-white/70">
            Want a verdict on a specific address? Live address lookups are coming soon — join free and yours
            is first.
          </p>
          <Link
            href="/#join"
            className="mt-4 inline-block rounded-full border border-violet-400/40 bg-violet-500/10 px-5 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20"
          >
            Join the waitlist
          </Link>
        </div>

        {/* primary CTA */}
        <div className="mx-auto mt-16 max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Osprey runs this on every new listing in your market — and messages you only when one clears
            your bar.
          </h2>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/#join"
              className="rounded-xl bg-indigo-500 px-8 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400"
            >
              Join the waitlist
            </Link>
            <Link
              href="/signup"
              className="rounded-xl border border-white/15 bg-white/[0.04] px-8 py-3 font-medium text-white/80 transition hover:bg-white/[0.08]"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 mt-auto flex flex-col items-center gap-1 px-6 pb-8 text-xs text-white/40">
        <p>&copy; {new Date().getFullYear()} Osprey. All rights reserved.</p>
        <p>
          <Link href="/terms" className="underline hover:text-white/70">
            Terms of Service
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="underline hover:text-white/70">
            Privacy Policy
          </Link>
        </p>
      </footer>
    </main>
  );
}
