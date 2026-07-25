import type { Metadata } from "next";
import Link from "next/link";
import Backdrop from "@/components/Backdrop";
import MarketingNav from "@/components/MarketingNav";
import PricingPlans from "@/components/PricingPlans";

// Public marketing page — no auth gate, deliberately indexable (like /try).
// Do not add a `robots` field here.
export const metadata: Metadata = {
  title: "Pricing — Osprey",
  description:
    "Founding pricing for Osprey. Plans for solo investors, agents, and brokerages. Billing isn't live yet — join the waitlist to lock in the founding rate before launch.",
};

export default function PricingPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <MarketingNav active="pricing" />

      {/* header */}
      <section className="relative z-10 px-6 pb-8 pt-8 sm:px-10 lg:pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs text-violet-100 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
            Coming soon · Founding pricing
          </span>

          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Plans for every way you{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              hunt.
            </span>
          </h1>

          <p className="mt-5 text-balance text-base text-white/60 sm:text-lg">
            Osprey isn&apos;t charging yet. Join now and lock in the founding
            rate —{" "}
            <span className="text-white/85">
              the price you start at is the price you keep.
            </span>
          </p>
        </div>
      </section>

      {/* plans */}
      <section className="relative z-10 px-6 pb-8 pt-4 sm:px-10">
        <PricingPlans />
      </section>

      {/* reassurance */}
      <section className="relative z-10 px-6 py-10 sm:px-10">
        <div className="mx-auto flex max-w-md flex-col items-center gap-1.5 text-center text-xs text-white/45">
          <p>Free to join the waitlist — no card, no commitment.</p>
          <p>You&apos;ll always hear from us before anything is billed.</p>
          <p>Founding rates are provisional and may change before launch.</p>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 pb-16 pt-4 text-center sm:px-10">
        <div className="mx-auto max-w-xl">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Get in before pricing goes{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              live.
            </span>
          </h2>
          <p className="mt-4 text-white/60">
            Founding members get first access at launch — and keep the rate they
            joined at.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/#join"
              className="rounded-xl bg-indigo-500 px-8 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400"
            >
              Join the waitlist
            </Link>
            <Link
              href="/try"
              className="rounded-xl border border-white/15 bg-white/[0.04] px-8 py-3 font-medium text-white/80 transition hover:bg-white/[0.08]"
            >
              Try a live verdict first
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
