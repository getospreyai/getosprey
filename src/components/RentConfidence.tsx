import type { RentBasis, StressResult } from "@/osprey/engine";
import { formatMoney, formatSignedMonthly } from "@/lib/format";

/** Monthly rent + AVM range bar + source note, optionally with a low-end
 *  stress badge (stressAtRangeLow re-underwrites at rangeLow — "if rent
 *  comes in at the pessimistic end, does this still work?"). Pure display,
 *  server-safe. */
export default function RentConfidence({
  rent,
  stress,
}: {
  rent: RentBasis;
  stress?: StressResult | null;
}) {
  const hasRange = rent.rangeLow != null && rent.rangeHigh != null && rent.rangeHigh > rent.rangeLow;
  const markerPct = hasRange
    ? Math.min(100, Math.max(0, ((rent.monthlyRent - rent.rangeLow!) / (rent.rangeHigh! - rent.rangeLow!)) * 100))
    : 50;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-white">Rent estimate</h2>
        <span className="text-lg font-semibold text-white">
          {formatMoney(rent.monthlyRent)}
          <span className="text-sm font-normal text-white/50">/mo</span>
        </span>
      </div>

      {hasRange && (
        <div className="mt-4">
          <div className="relative h-2 rounded-full bg-white/10">
            <div
              aria-hidden
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[#0a0718] bg-violet-400"
              style={{ left: `${markerPct}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/50">
            <span>{formatMoney(rent.rangeLow!)}</span>
            <span>{formatMoney(rent.rangeHigh!)}</span>
          </div>
        </div>
      )}

      {stress && rent.rangeLow != null && (
        <div
          className={
            stress.holdsAtLowEnd
              ? "mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] px-3 py-2 text-sm text-emerald-300"
              : "mt-4 rounded-xl border border-amber-400/30 bg-amber-500/[0.08] px-3 py-2 text-sm text-amber-300"
          }
        >
          {stress.holdsAtLowEnd ? "Holds at the low end: " : "Below your bar at the low end: "}
          {formatSignedMonthly(stress.lowEndCashFlow)} at {formatMoney(rent.rangeLow)}
        </div>
      )}

      <p className="mt-3 text-xs text-white/50">
        {rent.note ?? (rent.source === "manual" ? "Manually entered" : rent.source)}
      </p>
    </div>
  );
}
