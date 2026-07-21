"use client";

// Scenario Studio: model any financing / assumption overrides against the
// snapshotted listing via POST /api/property/[listingId]/scenario, without
// touching the saved profile. Up to 3 results can be pinned side-by-side.
// No persistence — pins live only in this component's state (v1).

import { useState } from "react";
import type { FinancingProfile, Underwriting } from "@/osprey/engine/types";
import { formatMoney, formatPct, formatSignedMonthly } from "@/lib/format";

type Kind = FinancingProfile["kind"];

const KIND_LABELS: Record<Kind, string> = {
  conventional: "Conventional",
  fha: "FHA",
  dscr: "DSCR",
  cash: "Cash",
};

interface ScenarioResult {
  underwriting: Underwriting;
}

interface Pinned {
  id: number;
  label: string;
  result: ScenarioResult;
}

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";

/** 0.0675 -> "6.75"; undefined -> "" */
function pctToDisplay(v: number | undefined): string {
  if (v == null) return "";
  return String(Math.round(v * 10000) / 100);
}

/** "6.75" -> 0.0675; "" -> undefined */
function displayToPct(s: string): number | undefined {
  if (s.trim() === "") return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / 100 : undefined;
}

let pinIdSeq = 0;

export default function ScenarioStudio({
  listingId,
  initialFinancing,
  initialAssumptions,
  initialRent,
}: {
  listingId: string;
  initialFinancing: FinancingProfile;
  initialAssumptions: { vacancyPct: number; maintenancePct: number; managementPct: number };
  initialRent: number | null;
}) {
  const [kind, setKind] = useState<Kind>(initialFinancing.kind);
  const [rate, setRate] = useState(pctToDisplay((initialFinancing as { rate?: number }).rate ?? 0.0675));
  const [downPct, setDownPct] = useState(
    pctToDisplay((initialFinancing as { downPct?: number }).downPct ?? 0.2),
  );
  const [termYears, setTermYears] = useState(
    String((initialFinancing as { termYears?: number }).termYears ?? 30),
  );
  const [rentOverride, setRentOverride] = useState("");
  const [vacancyPct, setVacancyPct] = useState(Math.round(initialAssumptions.vacancyPct * 100));
  const [maintenancePct, setMaintenancePct] = useState(
    Math.round(initialAssumptions.maintenancePct * 100),
  );
  const [managementPct, setManagementPct] = useState(
    Math.round(initialAssumptions.managementPct * 100),
  );

  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [pinned, setPinned] = useState<Pinned[]>([]);

  function buildFinancing(): FinancingProfile {
    const r = displayToPct(rate) ?? 0;
    const d = displayToPct(downPct);
    const t = termYears.trim() === "" ? undefined : parseInt(termYears, 10);
    switch (kind) {
      case "conventional":
        return { kind, rate: r, downPct: d ?? 0.2, termYears: t, label: "Scenario" };
      case "fha":
        return { kind, rate: r, downPct: d, termYears: t, label: "Scenario" };
      case "dscr":
        return { kind, rate: r, downPct: d ?? 0.2, termYears: t, label: "Scenario" };
      case "cash":
        return { kind, label: "Scenario" };
    }
  }

  async function run() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/property/${listingId}/scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financing: buildFinancing(),
          assumptions: {
            vacancyPct: vacancyPct / 100,
            maintenancePct: maintenancePct / 100,
            managementPct: managementPct / 100,
          },
          rentOverride: rentOverride.trim() === "" ? undefined : Number(rentOverride),
          projectionYears: 30,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(scenarioErrorMessage(data?.error));
        return;
      }
      setResult(data);
      setStatus("idle");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  function pin() {
    if (!result || pinned.length >= 3) return;
    const label = `${KIND_LABELS[kind]} ${rate}%${kind !== "cash" ? ` / ${downPct}% down` : ""}`;
    setPinned((prev) => [...prev, { id: ++pinIdSeq, label, result }]);
  }

  function unpin(id: number) {
    setPinned((prev) => prev.filter((p) => p.id !== id));
  }

  const showDown = kind === "conventional" || kind === "dscr" || kind === "fha";
  const showRate = kind !== "cash";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-sm font-medium text-white">Scenario Studio</h2>
      <p className="mt-1 text-xs text-white/50">
        Model any financing without touching your saved profile.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
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

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {showRate && (
          <div>
            <label className="mb-1 block text-xs text-white/50">Rate %</label>
            <input
              type="number"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={fieldClass}
            />
          </div>
        )}
        {showDown && (
          <div>
            <label className="mb-1 block text-xs text-white/50">
              Down % {kind === "fha" && "(optional)"}
            </label>
            <input
              type="number"
              step="0.5"
              value={downPct}
              onChange={(e) => setDownPct(e.target.value)}
              placeholder={kind === "fha" ? "3.5" : undefined}
              className={fieldClass}
            />
          </div>
        )}
        {kind !== "cash" && (
          <div>
            <label className="mb-1 block text-xs text-white/50">Term (yrs)</label>
            <input
              type="number"
              value={termYears}
              onChange={(e) => setTermYears(e.target.value)}
              className={fieldClass}
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-white/50">Rent override</label>
          <input
            type="number"
            value={rentOverride}
            onChange={(e) => setRentOverride(e.target.value)}
            placeholder={initialRent != null ? String(initialRent) : "monthly $"}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SliderField
          label="Vacancy"
          value={vacancyPct}
          onChange={setVacancyPct}
          max={30}
        />
        <SliderField
          label="Maintenance"
          value={maintenancePct}
          onChange={setMaintenancePct}
          max={30}
        />
        <SliderField
          label="Management"
          value={managementPct}
          onChange={setManagementPct}
          max={30}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={status === "loading"}
          className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60"
        >
          {status === "loading" ? "Running…" : "Run scenario"}
        </button>
        {status === "error" && <p className="text-sm text-red-400">{errorMsg}</p>}
      </div>

      {result && (
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Stat label="Cash flow" value={formatSignedMonthly(result.underwriting.monthlyCashFlow)} />
              <Stat label="Cap rate" value={formatPct(result.underwriting.metrics.capRatePct)} />
              <Stat label="CoC" value={formatPct(result.underwriting.metrics.cashOnCashPct)} />
              {result.underwriting.metrics.lenderDscr != null && (
                <Stat label="DSCR" value={result.underwriting.metrics.lenderDscr.toFixed(2)} />
              )}
              <Stat label="Cash to close" value={formatMoney(result.underwriting.cashToClose)} />
            </div>
            <button
              type="button"
              onClick={pin}
              disabled={pinned.length >= 3}
              className="rounded-full border border-violet-400/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Pin scenario
            </button>
          </div>
        </div>
      )}

      {pinned.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-xs text-white/50">
                <th className="py-2 pr-4 font-normal">Scenario</th>
                <th className="py-2 pr-4 font-normal">Cash flow</th>
                <th className="py-2 pr-4 font-normal">Cap rate</th>
                <th className="py-2 pr-4 font-normal">CoC</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {pinned.map((p) => (
                <tr key={p.id} className="text-white/80">
                  <td className="py-2 pr-4">{p.label}</td>
                  <td className="py-2 pr-4">
                    {formatSignedMonthly(p.result.underwriting.monthlyCashFlow)}
                  </td>
                  <td className="py-2 pr-4">{formatPct(p.result.underwriting.metrics.capRatePct)}</td>
                  <td className="py-2 pr-4">{formatPct(p.result.underwriting.metrics.cashOnCashPct)}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => unpin(p.id)}
                      className="text-xs text-white/40 transition hover:text-red-300"
                    >
                      Remove
                    </button>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-white/70">
      <span className="text-white/40">{label}</span> {value}
    </span>
  );
}

function SliderField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-white/50">
        <span>{label}</span>
        <span className="text-white/70">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
    </div>
  );
}

function scenarioErrorMessage(code: string | undefined): string {
  switch (code) {
    case "no_snapshot":
      return "This listing predates live modeling.";
    case "not_underwritable":
      return "This property can't be underwritten (out of niche).";
    case "no_rent":
      return "Enter a rent override — no AVM rent is on file.";
    case "forbidden":
      return "You don't have access to this property.";
    default:
      return "Those scenario inputs don't look right.";
  }
}
