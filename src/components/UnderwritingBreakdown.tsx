import type { Underwriting } from "@/osprey/engine";
import { formatMoney, formatPct, formatSignedMonthly } from "@/lib/format";

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md";
const tileClass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

/** Monthly cash-flow statement + metrics grid + loan breakdown + qualification
 *  checks for one Underwriting run. Pure display — no fetching, server-safe. */
export default function UnderwritingBreakdown({ uw }: { uw: Underwriting }) {
  const m = uw.metrics;
  const e = uw.monthly.expenses;

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Monthly cash flow — {uw.loan.label}</h2>
          <span
            className={
              uw.monthlyCashFlow >= 0
                ? "text-lg font-semibold text-emerald-400"
                : "text-lg font-semibold text-red-400"
            }
          >
            {formatSignedMonthly(uw.monthlyCashFlow)}
          </span>
        </div>

        <dl className="mt-4 flex flex-col divide-y divide-white/[0.06] text-sm">
          <Row label="Gross rent" value={formatMoney(uw.monthly.grossRent)} />
          {uw.monthly.otherIncome > 0 && (
            <Row label="Other income" value={formatMoney(uw.monthly.otherIncome)} />
          )}
          <Row label="Vacancy loss" value={`−${formatMoney(uw.monthly.vacancyLoss)}`} />
          <Row
            label="Effective gross income"
            value={formatMoney(uw.monthly.effectiveGrossIncome)}
            strong
          />
          <Row label="Taxes" value={`−${formatMoney(e.taxes)}`} />
          <Row label="Insurance" value={`−${formatMoney(e.insurance)}`} />
          <Row label="Maintenance" value={`−${formatMoney(e.maintenance)}`} />
          <Row label="CapEx reserve" value={`−${formatMoney(e.capex)}`} />
          <Row label="Management" value={`−${formatMoney(e.management)}`} />
          {e.utilities > 0 && <Row label="Utilities" value={`−${formatMoney(e.utilities)}`} />}
          {e.hoa > 0 && <Row label="HOA" value={`−${formatMoney(e.hoa)}`} />}
          {e.other > 0 && <Row label="Other" value={`−${formatMoney(e.other)}`} />}
          <Row label="Net operating income" value={formatMoney(uw.monthly.netOperatingIncome)} strong />
          <Row label="Debt service" value={`−${formatMoney(uw.monthly.debtService)}`} />
        </dl>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-medium text-white">Metrics</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Cap rate" value={formatPct(m.capRatePct)} />
          <Tile label="Cash on cash" value={formatPct(m.cashOnCashPct)} />
          <Tile label="GRM" value={m.grossRentMultiplier.toFixed(1)} />
          <Tile
            label="1% rule"
            value={`${formatPct(m.rentToValuePct, 2)}`}
            hint={m.onePercentRule ? "Passes" : "Fails"}
            good={m.onePercentRule}
          />
          <Tile label="Break-even occupancy" value={formatPct(m.breakEvenOccupancyPct)} />
          <Tile label="Opex ratio" value={formatPct(m.operatingExpenseRatioPct)} />
          {m.lenderDscr != null && <Tile label="Lender DSCR" value={m.lenderDscr.toFixed(2)} />}
          {m.noiDscr != null && <Tile label="NOI DSCR" value={m.noiDscr.toFixed(2)} />}
          <Tile label="Cash to close" value={formatMoney(uw.cashToClose)} />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-medium text-white">Loan</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Down payment" value={formatMoney(uw.loan.downPayment)} />
          <Tile label="Amount financed" value={formatMoney(uw.loan.amountFinanced)} />
          <Tile label="LTV" value={formatPct(uw.loan.ltv * 100)} />
          <Tile label="Rate" value={formatPct(uw.loan.rate * 100, 3)} />
          <Tile label="Term" value={`${uw.loan.termYears}y`} />
          <Tile label="P&I" value={formatMoney(uw.loan.monthlyPrincipalAndInterest)} />
          {uw.loan.monthlyMortgageInsurance > 0 && (
            <Tile label="Mortgage insurance" value={formatMoney(uw.loan.monthlyMortgageInsurance)} />
          )}
          {uw.loan.upfrontFeesCash > 0 && (
            <Tile label="Upfront fees" value={formatMoney(uw.loan.upfrontFeesCash)} />
          )}
        </div>
      </div>

      {uw.qualification.checks.length > 0 && (
        <div className={cardClass}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Qualification</h2>
            <span
              className={
                uw.qualification.pass
                  ? "text-xs font-medium text-emerald-400"
                  : "text-xs font-medium text-amber-300"
              }
            >
              {uw.qualification.pass ? "Passes" : "Needs a look"}
            </span>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-white/60">
            {uw.qualification.checks.map((c) => (
              <li key={c.name} className="flex gap-2.5">
                <span aria-hidden className={c.pass ? "text-emerald-400" : "text-amber-300"}>
                  {c.pass ? "✓" : "!"}
                </span>
                {c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={strong ? "text-white/80" : "text-white/50"}>{label}</span>
      <span className={strong ? "font-medium text-white" : "text-white/80"}>{value}</span>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  good,
}: {
  label: string;
  value: string;
  hint?: string;
  good?: boolean;
}) {
  return (
    <div className={tileClass}>
      <p className="text-xs text-white/50">{label}</p>
      <p className="mt-1 text-base font-medium text-white">{value}</p>
      {hint && (
        <p className={good ? "mt-0.5 text-xs text-emerald-400" : "mt-0.5 text-xs text-amber-300"}>
          {hint}
        </p>
      )}
    </div>
  );
}
