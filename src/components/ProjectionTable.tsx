import type { Projection } from "@/osprey/engine";
import { formatMoney, formatPct, formatSignedMoney } from "@/lib/format";

const KEY_YEARS = [1, 2, 3, 5, 10, 20, 30];

/** Key-year rows from a multi-year Projection + exit summary. Pure display,
 *  server-safe. Shows whichever of KEY_YEARS exist in the projection. */
export default function ProjectionTable({ projection }: { projection: Projection }) {
  const rows = projection.years.filter((y) => KEY_YEARS.includes(y.year));
  const exitYear = projection.years[projection.years.length - 1];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-sm font-medium text-white">
        {projection.years.length}-year projection
      </h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="text-xs text-white/50">
              <th className="py-2 pr-4 font-normal">Year</th>
              <th className="py-2 pr-4 font-normal">Annual cash flow</th>
              <th className="py-2 pr-4 font-normal">Value</th>
              <th className="py-2 pr-4 font-normal">Loan balance</th>
              <th className="py-2 pr-4 font-normal">Equity</th>
              <th className="py-2 font-normal">ROE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.map((y) => (
              <tr key={y.year} className="text-white/80">
                <td className="py-2 pr-4 font-medium text-white">{y.year}</td>
                <td className="py-2 pr-4">{formatSignedMoney(y.cashFlow)}</td>
                <td className="py-2 pr-4">{formatMoney(y.propertyValue)}</td>
                <td className="py-2 pr-4">{formatMoney(y.loanBalance)}</td>
                <td className="py-2 pr-4">{formatMoney(y.equity)}</td>
                <td className="py-2">{formatPct(y.returnOnEquityPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {exitYear && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-white/50">Total profit at exit</p>
            <p className="mt-1 text-base font-medium text-white">
              {formatMoney(projection.totalProfitAtExit)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-white/50">IRR at exit</p>
            <p className="mt-1 text-base font-medium text-white">
              {projection.irrAtExitPct != null ? formatPct(projection.irrAtExitPct) : "n/a"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-white/50">Equity multiple</p>
            <p className="mt-1 text-base font-medium text-white">
              {projection.equityMultipleAtExit != null
                ? `${projection.equityMultipleAtExit.toFixed(2)}x`
                : "n/a"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
