import type { RentBasis } from "@/osprey/engine";
import { formatMoney } from "@/lib/format";

/** Monthly rent + AVM range bar + source note. Pure display, server-safe. */
export default function RentConfidence({ rent }: { rent: RentBasis }) {
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

      <p className="mt-3 text-xs text-white/50">
        {rent.note ?? (rent.source === "manual" ? "Manually entered" : rent.source)}
      </p>
    </div>
  );
}
