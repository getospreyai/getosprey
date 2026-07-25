"use client";

import { useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Pricing is COPY ONLY today — no billing, no Stripe. Every CTA routes to the
// waitlist (or email for brokerage). These are founding-rate placeholders:
// edit the numbers here and the whole page updates.
//
// Prices are stored as plain numbers (no "$") so both billing periods render
// consistently. Annual = "2 months free" (monthly × 10), shown as a per-month
// equivalent with the yearly total underneath. A tier with `custom` set skips
// pricing entirely (e.g. Brokerage — "Let's talk").
// ---------------------------------------------------------------------------
type Price = {
  /** Founding per-month price for this period. */
  perMonth: number;
  /** Struck-through regular (post-launch) per-month price. */
  wasPerMonth: number;
  /** Total charged per year (annual only). */
  yearly?: number;
};

type Tier = {
  name: string;
  audience: string;
  monthly?: Price;
  annual?: Price;
  /** Set for non-priced tiers (Brokerage). Overrides monthly/annual. */
  custom?: { headline: string; note: string };
  features: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
  badge?: string;
};

const tiers: Tier[] = [
  {
    name: "Solo investor",
    audience: "For the investor hunting their next door.",
    monthly: { perMonth: 29, wasPerMonth: 49 },
    annual: { perMonth: 24, wasPerMonth: 41, yearly: 290 },
    features: [
      "One buy box, underwritten at your financing",
      "Telegram verdicts the moment a deal clears your bar",
      "Deep-dive, Scenario Studio & side-by-side compare",
      "Max-offer solver on every near-miss",
      "Price-cut watch & the Sunday digest",
    ],
    cta: { label: "Join the waitlist", href: "/#join" },
  },
  {
    name: "Agent",
    audience: "One seat, your whole client list.",
    monthly: { perMonth: 99, wasPerMonth: 149 },
    annual: { perMonth: 83, wasPerMonth: 124, yearly: 990 },
    highlight: true,
    badge: "Best for realtors",
    features: [
      "Everything in Solo investor",
      "A buy box per client — run them all at once",
      "Client-ready share links with your name on them",
      "Lender-ready branded PDF packets, one tap each",
      "Show up as the most prepared person in the room",
    ],
    cta: { label: "Join the waitlist", href: "/#join" },
  },
  {
    name: "Brokerage",
    audience: "Your whole team, under your brand.",
    custom: {
      headline: "Let's talk",
      note: "Custom founding pricing for teams",
    },
    features: [
      "Everything in Agent, for every seat",
      "Seats for your whole roster",
      "Brokerage branding across reports & share links",
      "Team rollups across every client's buy box",
      "White-glove onboarding & priority support",
    ],
    cta: { label: "Talk to us", href: "mailto:hello@getosprey.ai" },
  },
];

type Period = "monthly" | "annual";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function PricingPlans() {
  const [period, setPeriod] = useState<Period>("monthly");

  return (
    <div className="mx-auto max-w-6xl">
      {/* billing toggle */}
      <div
        role="group"
        aria-label="Billing period"
        className="mx-auto mb-10 flex w-fit items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm backdrop-blur-md"
      >
        <button
          type="button"
          aria-pressed={period === "monthly"}
          onClick={() => setPeriod("monthly")}
          className={
            period === "monthly"
              ? "rounded-full bg-white/10 px-4 py-1.5 font-medium text-white transition"
              : "rounded-full px-4 py-1.5 text-white/55 transition hover:text-white"
          }
        >
          Monthly
        </button>
        <button
          type="button"
          aria-pressed={period === "annual"}
          onClick={() => setPeriod("annual")}
          className={
            period === "annual"
              ? "flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 font-medium text-white transition"
              : "flex items-center gap-2 rounded-full px-4 py-1.5 text-white/55 transition hover:text-white"
          }
        >
          Annual
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-200">
            2 months free
          </span>
        </button>
      </div>

      {/* plans */}
      <div className="grid items-stretch gap-5 lg:grid-cols-3">
        {tiers.map((tier) => {
          const price =
            period === "annual" ? tier.annual : tier.monthly;

          return (
            <div
              key={tier.name}
              className={
                tier.highlight
                  ? "group relative flex h-full flex-col rounded-2xl border border-violet-400/30 bg-violet-500/[0.08] p-7 shadow-[0_0_50px_-12px_rgba(139,124,255,0.4)] backdrop-blur-md transition duration-300 ease-out hover:border-violet-400/60 hover:bg-violet-500/[0.12] hover:shadow-[0_24px_70px_-20px_rgba(139,124,255,0.75)] motion-safe:hover:-translate-y-1.5"
                  : "group relative flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.05] p-7 backdrop-blur-md transition duration-300 ease-out hover:border-white/25 hover:bg-white/[0.07] hover:shadow-[0_24px_60px_-24px_rgba(139,124,255,0.5)] motion-safe:hover:-translate-y-1.5"
              }
            >
              {tier.badge && (
                <span className="absolute -top-3 left-7 rounded-full border border-violet-400/40 bg-[#1a1136] px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-violet-200">
                  {tier.badge}
                </span>
              )}

              <h2 className="text-lg font-medium">{tier.name}</h2>
              <p className="mt-1.5 text-sm text-white/55">{tier.audience}</p>

              {/* price block — fixed height so CTAs line up across all cards */}
              <div className="mt-6 flex min-h-[78px] flex-col justify-start">
                {tier.custom ? (
                  <>
                    <span className="text-4xl font-semibold tracking-tight">
                      {tier.custom.headline}
                    </span>
                    <p className="mt-2 text-xs text-violet-200/80">
                      {tier.custom.note}
                    </p>
                  </>
                ) : price ? (
                  <>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-semibold tracking-tight">
                        ${price.perMonth}
                      </span>
                      <span className="pb-1 text-sm text-white/50">/mo</span>
                      <span className="pb-1 text-sm text-white/35 line-through">
                        ${price.wasPerMonth}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-violet-200/80">
                      {period === "annual"
                        ? `Billed $${price.yearly}/yr · locked in when you join`
                        : "Founding rate · locked in when you join"}
                    </p>
                  </>
                ) : null}
              </div>

              <Link
                href={tier.cta.href}
                className={
                  tier.highlight
                    ? "mt-6 inline-flex items-center justify-center rounded-xl bg-indigo-500 px-5 py-3 text-sm font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400"
                    : "mt-6 inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.08]"
                }
              >
                {tier.cta.label}
                <span aria-hidden className="ml-1.5">
                  →
                </span>
              </Link>

              <ul className="mt-7 space-y-3 border-t border-white/10 pt-6 text-sm text-white/75">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
