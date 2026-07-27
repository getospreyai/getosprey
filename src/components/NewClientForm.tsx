"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PropertyType } from "@/osprey/engine/types";
import type { WatchTarget } from "@/osprey/agent/watcher";

const TYPES: { value: PropertyType; label: string }[] = [
  { value: "single_family", label: "Single-family" },
  { value: "duplex", label: "Duplex" },
  { value: "triplex", label: "Triplex" },
  { value: "fourplex", label: "Fourplex" },
];

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";

/**
 * Create a managed client. The market select is populated from the agent's
 * farm markets rather than free text — the server enforces the same rule
 * (withinFarm), but offering only valid choices means the agent never has to
 * discover the constraint by hitting an error.
 */
export default function NewClientForm({ farm }: { farm: WatchTarget[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [marketIdx, setMarketIdx] = useState(0);
  const [types, setTypes] = useState<PropertyType[]>(["single_family"]);
  const [bar, setBar] = useState("250");
  const [down, setDown] = useState("20");
  const [rate, setRate] = useState("6.75");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleType(t: PropertyType) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const market = farm[marketIdx];
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        settings: {
          buyBox: {
            states: [market.state],
            cities: market.city ? [market.city] : [],
            propertyTypes: types,
            // Required keys on PatchProfileSchema; null means "no bound".
            minPrice: null,
            maxPrice: null,
            maxDaysOnMarket: null,
          },
          // The engine takes rates as DECIMALS (0.0675), not percents.
          financingProfiles: [
            {
              kind: "conventional",
              rate: Number(rate) / 100,
              downPct: Number(down) / 100,
              termYears: 30,
            },
          ],
          minMonthlyCashFlow: Number(bar),
          alertsPaused: false,
        },
      }),
    }).catch(() => null);

    if (!res) {
      setBusy(false);
      setError("Network error. Please try again.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? "Couldn't add that client.");
      return;
    }

    router.push(`/clients/${data.clientUserId}`);
    router.refresh();
  }

  if (farm.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] p-6">
        <p className="text-sm font-medium text-amber-100">Set your farm markets first</p>
        <p className="mt-2 text-sm text-amber-200/80">
          Osprey scans each market you cover every day, so your farm defines where clients
          can be added. Set it in Settings, then come back.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label className="mb-1.5 block text-sm text-white/70">Client name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Reyes"
          className={fieldClass}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm text-white/70">
          Their email <span className="text-white/40">(optional)</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jordan@example.com"
          className={fieldClass}
        />
        <p className="mt-1.5 text-xs text-white/40">
          Stored for when you invite them to claim the account. No email is sent now.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm text-white/70">Market</label>
        <select
          value={marketIdx}
          onChange={(e) => setMarketIdx(Number(e.target.value))}
          className={fieldClass}
        >
          {farm.map((m, i) => (
            <option key={`${m.city ?? ""}|${m.state}`} value={i} className="bg-[#151030]">
              {m.city ? `${m.city}, ${m.state}` : m.state}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-1.5 block text-sm text-white/70">Property types</span>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => toggleType(t.value)}
              className={
                types.includes(t.value)
                  ? "rounded-full border border-violet-400/50 bg-violet-500/20 px-3.5 py-1.5 text-sm text-violet-100"
                  : "rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-sm text-white/60 transition hover:bg-white/[0.08]"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm text-white/70">Cash-flow bar ($/mo)</label>
          <input
            required
            inputMode="numeric"
            value={bar}
            onChange={(e) => setBar(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-white/70">Down payment %</label>
          <input
            required
            inputMode="decimal"
            value={down}
            onChange={(e) => setDown(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-white/70">Rate %</label>
          <input
            required
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-400/25 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || types.length === 0}
        className="glow-cta mt-1 rounded-xl bg-indigo-500 px-6 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60"
      >
        {busy ? "Adding…" : "Add client"}
      </button>

      <p className="text-center text-xs text-white/40">
        You&apos;ll maintain this buy box until they claim the account.
      </p>
    </form>
  );
}
