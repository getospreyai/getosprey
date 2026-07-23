"use client";

// The interactive centerpiece of /try: pick one of three sample deals, flip
// the financing, and watch a REAL Osprey verdict recompute. `initial` is
// server-precomputed (correct first paint, no flash, crawlable) — every
// subsequent number comes back from POST /api/try, the same pure-engine
// endpoint, so nothing displayed here is ever a hardcoded figure. The result
// panel reuses MaxOfferCard/UnderwritingBreakdown/ProjectionTable verbatim —
// they're prop-only with no server-only imports (verified before wiring this
// up), so a visitor sees the literal same workup a signed-in user gets.

import { useEffect, useRef, useState } from "react";
import type { DemoDeal } from "@/lib/demo-deals";
import { DEMO_BAR } from "@/lib/demo-deals";
import type { FinancingProfile, MaxOfferResult, Projection, Underwriting } from "@/osprey/engine";
import MaxOfferCard from "@/components/MaxOfferCard";
import UnderwritingBreakdown from "@/components/UnderwritingBreakdown";
import ProjectionTable from "@/components/ProjectionTable";
import { PROPERTY_TYPE_LABELS } from "@/lib/property-labels";
import { formatMoney, formatSignedMonthly } from "@/lib/format";

type Kind = FinancingProfile["kind"];

const KIND_LABELS: Record<Kind, string> = {
  conventional: "Conventional",
  fha: "FHA",
  dscr: "DSCR",
  cash: "Cash",
};

// Sensible starting rate/down-payment per loan type for the toggle — not
// vendored figures. Whatever ends up in the fields still underwrites live.
const TYPE_DEFAULTS: Record<Kind, { rate: number; downPct: number }> = {
  conventional: { rate: 6.75, downPct: 25 },
  fha: { rate: 6.75, downPct: 3.5 },
  dscr: { rate: 7.5, downPct: 25 },
  cash: { rate: 0, downPct: 0 },
};

const DEBOUNCE_MS = 400;

interface TryResult {
  underwriting: Underwriting;
  projection: Projection;
  maxOffer: MaxOfferResult | null;
}

/** 0.0675 -> "6.75" */
function pctToDisplay(v: number): string {
  return String(Math.round(v * 10000) / 100);
}

/** "6.75" -> 0.0675; unparsable -> 0 */
function displayToPct(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / 100 : 0;
}

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";

export default function TryDemo({
  deals,
  initial,
}: {
  deals: DemoDeal[];
  initial: { dealId: string; underwriting: Underwriting; projection: Projection; maxOffer: MaxOfferResult | null };
}) {
  const initialFinancing = initial.underwriting.financing;

  const [dealId, setDealId] = useState(initial.dealId);
  const [kind, setKind] = useState<Kind>(initialFinancing.kind);
  const [rate, setRate] = useState(pctToDisplay((initialFinancing as { rate?: number }).rate ?? 0.0675));
  const [downPct, setDownPct] = useState(
    pctToDisplay((initialFinancing as { downPct?: number }).downPct ?? 0.25),
  );
  const [result, setResult] = useState<TryResult>({
    underwriting: initial.underwriting,
    projection: initial.projection,
    maxOffer: initial.maxOffer,
  });
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  // Guards against an in-flight request resolving after a newer one — always
  // show the latest input's output, never a stale one that lands late.
  const requestSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function buildFinancing(k: Kind, rateStr: string, downStr: string): FinancingProfile {
    const r = displayToPct(rateStr);
    const d = displayToPct(downStr);
    switch (k) {
      case "conventional":
        return { kind: "conventional", rate: r, downPct: d };
      case "fha":
        return { kind: "fha", rate: r, downPct: d };
      case "dscr":
        return { kind: "dscr", rate: r, downPct: d };
      case "cash":
        return { kind: "cash" };
    }
  }

  async function run(dId: string, k: Kind, rateStr: string, downStr: string) {
    const deal = deals.find((d) => d.id === dId) ?? deals[0];
    const seq = ++requestSeq.current;
    setStatus("loading");
    try {
      const res = await fetch("/api/try", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: deal.price,
          rent: deal.rent,
          propertyType: deal.propertyType,
          financing: buildFinancing(k, rateStr, downStr),
          projectionYears: 10,
          targetMonthlyCashFlow: DEMO_BAR,
        }),
      });
      const data = await res.json().catch(() => null);
      if (seq !== requestSeq.current) return; // superseded by a newer request
      if (!res.ok || !data) {
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("idle");
    } catch {
      if (seq !== requestSeq.current) return;
      setStatus("error");
    }
  }

  function selectDeal(id: string) {
    if (id === dealId) return;
    setDealId(id);
    run(id, kind, rate, downPct);
  }

  function selectKind(k: Kind) {
    if (k === kind) return;
    const d = TYPE_DEFAULTS[k];
    const nextRate = String(d.rate);
    const nextDown = String(d.downPct);
    setKind(k);
    setRate(nextRate);
    setDownPct(nextDown);
    run(dealId, k, nextRate, nextDown);
  }

  function onRateChange(v: string) {
    setRate(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => run(dealId, kind, v, downPct), DEBOUNCE_MS);
  }

  function onDownChange(v: string) {
    setDownPct(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => run(dealId, kind, rate, v), DEBOUNCE_MS);
  }

  const clears = result.underwriting.monthlyCashFlow >= DEMO_BAR;
  const showFinancingFields = kind !== "cash";

  return (
    <div className="flex flex-col gap-5">
      {/* deal selector */}
      <div className="grid gap-3 sm:grid-cols-3">
        {deals.map((deal) => {
          const active = deal.id === dealId;
          return (
            <button
              key={deal.id}
              type="button"
              onClick={() => selectDeal(deal.id)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-2xl border border-violet-400/50 bg-violet-500/[0.12] p-4 text-left shadow-[0_0_30px_rgba(139,124,255,0.15)]"
                  : "rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left transition hover:bg-white/[0.08]"
              }
            >
              <p className="text-sm font-medium text-white">
                {deal.city}, {deal.state}
              </p>
              <p className="mt-0.5 text-xs text-white/50">
                {PROPERTY_TYPE_LABELS[deal.propertyType]} · {formatMoney(deal.price)}
              </p>
              <p className="mt-2 text-xs text-white/60">{deal.blurb}</p>
            </button>
          );
        })}
      </div>

      {/* financing controls */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
        <h2 className="text-sm font-medium text-white">Financing</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => selectKind(k)}
              aria-pressed={kind === k}
              className={
                kind === k
                  ? "rounded-full bg-violet-500 px-4 py-1.5 text-xs font-medium text-white"
                  : "rounded-full border border-white/15 bg-white/[0.04] px-4 py-1.5 text-xs text-white/70 transition hover:bg-white/[0.08]"
              }
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {showFinancingFields && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:w-72">
            <div>
              <label className="mb-1 block text-xs text-white/50">Rate %</label>
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.05}
                value={rate}
                onChange={(e) => onRateChange(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Down %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={downPct}
                onChange={(e) => onDownChange(e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
        )}

        <div className="mt-3 h-4 text-xs">
          {status === "loading" && <p className="text-violet-200/70">Recalculating…</p>}
          {status === "error" && (
            <p className="text-red-400">Those numbers don&apos;t look right — try a smaller change.</p>
          )}
        </div>
      </div>

      {/* verdict + full workup — dims briefly while a recompute is in flight */}
      <div
        aria-busy={status === "loading"}
        className={status === "loading" ? "flex flex-col gap-5 opacity-60 transition" : "flex flex-col gap-5 transition"}
      >
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/40">Osprey&apos;s verdict</p>
              <p
                className={
                  clears
                    ? "mt-1 text-3xl font-semibold text-emerald-400"
                    : "mt-1 text-3xl font-semibold text-white"
                }
              >
                {formatSignedMonthly(result.underwriting.monthlyCashFlow)}
              </p>
              <p className="mt-1 text-sm text-white/50">at {result.underwriting.loan.label}</p>
            </div>
            <span
              className={
                clears
                  ? "rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-2 text-sm font-medium text-emerald-400"
                  : "rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/60"
              }
            >
              {clears ? `Clears your ${formatMoney(DEMO_BAR)}/mo bar` : `Below your ${formatMoney(DEMO_BAR)}/mo bar`}
            </span>
          </div>
        </div>

        <MaxOfferCard
          maxOffer={result.maxOffer}
          clearingRate={null}
          profileRate={result.underwriting.loan.rate}
          bar={DEMO_BAR}
        />
        <UnderwritingBreakdown uw={result.underwriting} />
        <ProjectionTable projection={result.projection} />
      </div>
    </div>
  );
}
