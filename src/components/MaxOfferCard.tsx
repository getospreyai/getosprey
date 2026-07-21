import type { MaxOfferResult } from "@/osprey/engine";
import { showClearingRateLine } from "@/lib/property-insights";
import { formatMoney, formatPct } from "@/lib/format";

/** Verdict-aware max-offer + clearing-rate card. Figures are solved
 *  server-side (solveMaxOffer/solveClearingRate — cheap, pure engine math);
 *  this is pure display. */
export default function MaxOfferCard({
  maxOffer,
  clearingRate,
  profileRate,
  bar,
  daysOnMarket,
}: {
  maxOffer: MaxOfferResult | null;
  clearingRate: number | null;
  /** uw.loan.rate as a decimal, e.g. 0.0675. */
  profileRate: number;
  bar: number;
  daysOnMarket?: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-sm font-medium text-white">Max offer</h2>

      {!maxOffer ? (
        <p className="mt-3 text-sm text-white/60">
          Doesn&apos;t clear your {formatMoney(bar)}/mo bar even well below ask — the numbers don&apos;t
          work at any realistic price for this financing.
        </p>
      ) : maxOffer.clearsAtAsk ? (
        <p className="mt-3 text-sm text-white/80">
          <span className="font-medium text-emerald-400">Clears your {formatMoney(bar)}/mo bar at ask</span>
          {" — headroom to "}
          {formatMoney(maxOffer.maxPrice)}
          {maxOffer.pctVsAsk > 0 && ` (${formatPct(maxOffer.pctVsAsk)} above ask)`}.
        </p>
      ) : (
        <p className="mt-3 text-sm text-white/80">
          <span className="font-medium text-amber-300">
            Doesn&apos;t clear your {formatMoney(bar)}/mo bar at ask.
          </span>{" "}
          Max offer: {formatMoney(maxOffer.maxPrice)} — {Math.abs(maxOffer.pctVsAsk).toFixed(1)}% below ask
          {daysOnMarket != null && ` · ${Math.round(daysOnMarket)} days on market`}.
        </p>
      )}

      {showClearingRateLine(clearingRate, profileRate) && (
        <p className="mt-2 text-xs text-white/50">
          Clears at {(clearingRate * 100).toFixed(2)}% rate (profile: {(profileRate * 100).toFixed(2)}%).
        </p>
      )}
    </div>
  );
}
