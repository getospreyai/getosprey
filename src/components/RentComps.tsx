import type { RentComparable } from "@/lib/rent-comparables";
import { formatMoney } from "@/lib/format";

/** Top-N rent comparables table (by RentCast's correlation score) — the
 *  "show your work" companion to the AVM point estimate. Pure display,
 *  server-safe; caller passes an already-sorted/truncated list
 *  (lib/rent-comparables.ts topComparables). */
export default function RentComps({ comparables }: { comparables: RentComparable[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-sm font-medium text-white">Rent comparables</h2>

      {comparables.length === 0 ? (
        <p className="mt-3 text-sm text-white/60">
          No comparable rentals came back with this AVM estimate.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs text-white/50">
                <th className="py-2 pr-4 font-normal">Address</th>
                <th className="py-2 pr-4 font-normal">Rent</th>
                <th className="py-2 pr-4 font-normal">Bd/Ba</th>
                <th className="py-2 pr-4 font-normal">Sqft</th>
                <th className="py-2 pr-4 font-normal">Distance</th>
                <th className="py-2 pr-4 font-normal">Match</th>
                <th className="py-2 font-normal">DOM / status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {comparables.map((c, i) => (
                <tr key={`${c.formattedAddress}-${i}`} className="text-white/80">
                  <td className="py-2 pr-4">{c.formattedAddress}</td>
                  <td className="py-2 pr-4">{formatMoney(c.price)}</td>
                  <td className="py-2 pr-4">
                    {c.bedrooms ?? "–"}/{c.bathrooms ?? "–"}
                  </td>
                  <td className="py-2 pr-4">
                    {c.squareFootage != null ? c.squareFootage.toLocaleString() : "–"}
                  </td>
                  <td className="py-2 pr-4">{c.distance != null ? `${c.distance.toFixed(1)} mi` : "–"}</td>
                  <td className="py-2 pr-4">{Math.round(c.correlation * 100)}%</td>
                  <td className="py-2">
                    {c.status ?? "–"}
                    {c.daysOnMarket != null && ` · ${c.daysOnMarket}d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
