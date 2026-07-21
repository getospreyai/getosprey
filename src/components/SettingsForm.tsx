"use client";

import { useState, FormEvent } from "react";
import type { InvestorProfile } from "@/osprey/agent/model";
import type { FinancingProfile, PropertyType } from "@/osprey/engine/types";

type Status = "idle" | "submitting" | "success" | "error";
type PresetKey = "conventional" | "dscr" | "fha" | "cash";

const PROPERTY_TYPES: PropertyType[] = ["single_family", "duplex", "triplex", "fourplex"];
const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  single_family: "Single-family",
  duplex: "Duplex",
  triplex: "Triplex",
  fourplex: "Fourplex",
};

const KIND_LABELS: Record<FinancingProfile["kind"], string> = {
  conventional: "Conventional",
  fha: "FHA",
  dscr: "DSCR",
  cash: "Cash",
};

const PRESETS: Record<PresetKey, { label: string; make: () => FinancingProfile }> = {
  conventional: {
    label: "Conventional — 25% down, 6.75%",
    make: () => ({ kind: "conventional", downPct: 0.25, rate: 0.0675 }),
  },
  dscr: {
    label: "DSCR — 20% down, 7.25%, min DSCR 1",
    make: () => ({ kind: "dscr", downPct: 0.2, rate: 0.0725, minDscr: 1 }),
  },
  fha: {
    label: "FHA — 6.25%",
    make: () => ({ kind: "fha", rate: 0.0625 }),
  },
  cash: {
    label: "Cash",
    make: () => ({ kind: "cash" }),
  },
};

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

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";
const cardClass = "rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md";
const labelClass = "text-sm font-medium text-white";
const helpClass = "mt-1 text-xs text-white/50";

export default function SettingsForm({ profile }: { profile: InvestorProfile }) {
  const [citiesText, setCitiesText] = useState((profile.buyBox.cities ?? []).join(", "));
  const [minPrice, setMinPrice] = useState(
    profile.buyBox.minPrice != null ? String(profile.buyBox.minPrice) : ""
  );
  const [maxPrice, setMaxPrice] = useState(
    profile.buyBox.maxPrice != null ? String(profile.buyBox.maxPrice) : ""
  );
  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>(
    profile.buyBox.propertyTypes ?? []
  );
  const [maxDaysOnMarket, setMaxDaysOnMarket] = useState(
    profile.buyBox.maxDaysOnMarket != null ? String(profile.buyBox.maxDaysOnMarket) : ""
  );
  const [minMonthlyCashFlow, setMinMonthlyCashFlow] = useState(
    String(profile.minMonthlyCashFlow ?? 0)
  );
  const [alertsPaused, setAlertsPaused] = useState(Boolean(profile.alertsPaused));
  const [financingProfiles, setFinancingProfiles] = useState<FinancingProfile[]>(
    profile.financingProfiles ?? []
  );
  const [presetKey, setPresetKey] = useState<PresetKey>("conventional");

  const [tasteNotes, setTasteNotes] = useState<string[]>(profile.tasteNotes ?? []);
  const [newNote, setNewNote] = useState("");
  const [maxHoaMonthly, setMaxHoaMonthly] = useState(
    profile.dealbreakers?.maxHoaMonthly != null ? String(profile.dealbreakers.maxHoaMonthly) : ""
  );
  const [excludeZipsText, setExcludeZipsText] = useState(
    (profile.dealbreakers?.excludeZips ?? []).join(", ")
  );
  const [minYearBuilt, setMinYearBuilt] = useState(
    profile.dealbreakers?.minYearBuilt != null ? String(profile.dealbreakers.minYearBuilt) : ""
  );

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function toggleType(t: PropertyType) {
    setPropertyTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  function patchFinancing(
    index: number,
    patch: { label?: string; downPct?: number; rate?: number }
  ) {
    setFinancingProfiles((prev) =>
      prev.map((p, i) => (i === index ? ({ ...p, ...patch } as unknown as FinancingProfile) : p))
    );
  }

  function removeFinancing(index: number) {
    setFinancingProfiles((prev) => prev.filter((_, i) => i !== index));
  }

  function addFinancing() {
    setFinancingProfiles((prev) => [...prev, PRESETS[presetKey].make()]);
  }

  function addNote() {
    const note = newNote.trim();
    if (!note) return;
    setTasteNotes((prev) => [...prev, note]);
    setNewNote("");
  }

  function removeNote(index: number) {
    setTasteNotes((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");

    if (propertyTypes.length === 0) {
      setStatus("error");
      setErrorMsg("Choose at least one property type.");
      return;
    }
    if (financingProfiles.length === 0) {
      setStatus("error");
      setErrorMsg("Keep at least one financing profile.");
      return;
    }

    const payload = {
      buyBox: {
        cities: citiesText
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        minPrice: minPrice.trim() === "" ? null : Number(minPrice),
        maxPrice: maxPrice.trim() === "" ? null : Number(maxPrice),
        propertyTypes,
        maxDaysOnMarket: maxDaysOnMarket.trim() === "" ? null : Number(maxDaysOnMarket),
      },
      minMonthlyCashFlow: minMonthlyCashFlow.trim() === "" ? 0 : Number(minMonthlyCashFlow),
      alertsPaused,
      financingProfiles,
      dealbreakers: {
        maxHoaMonthly: maxHoaMonthly.trim() === "" ? null : Number(maxHoaMonthly),
        excludeZips: excludeZipsText
          .split(",")
          .map((z) => z.trim())
          .filter(Boolean),
        minYearBuilt: minYearBuilt.trim() === "" ? null : Number(minYearBuilt),
      },
      tasteNotes,
    };

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data?.error ?? "Something went wrong. Try again.");
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Buy box */}
      <div className={cardClass}>
        <h2 className={labelClass}>Buy box</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">Cities</label>
            <input
              type="text"
              value={citiesText}
              onChange={(e) => setCitiesText(e.target.value)}
              placeholder="Las Vegas, Henderson, Reno"
              className={fieldClass}
            />
            <p className={helpClass}>Comma-separated. Leave blank to match the whole state.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">Min price</label>
              <input
                type="number"
                min={0}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="150000"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Max price</label>
              <input
                type="number"
                min={0}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="600000"
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/50">Property types</label>
            <div className="flex flex-wrap gap-3">
              {PROPERTY_TYPES.map((t) => (
                <label
                  key={t}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80"
                >
                  <input
                    type="checkbox"
                    checked={propertyTypes.includes(t)}
                    onChange={() => toggleType(t)}
                    className="h-4 w-4 rounded border-white/20 bg-white/10 accent-violet-500"
                  />
                  {PROPERTY_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/50">Max days on market</label>
            <input
              type="number"
              min={0}
              value={maxDaysOnMarket}
              onChange={(e) => setMaxDaysOnMarket(e.target.value)}
              placeholder="7"
              className={fieldClass}
            />
            <p className={helpClass}>Ignore listings older than this many days.</p>
          </div>
        </div>
      </div>

      {/* Alert bar */}
      <div className={cardClass}>
        <h2 className={labelClass}>Alert bar</h2>
        <div className="mt-4">
          <label className="mb-1 block text-xs text-white/50">Minimum monthly cash flow</label>
          <input
            type="number"
            value={minMonthlyCashFlow}
            onChange={(e) => setMinMonthlyCashFlow(e.target.value)}
            placeholder="200"
            className={fieldClass}
          />
          <p className={helpClass}>
            Osprey only messages you when a deal clears this monthly cash flow.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-white/80">Pause alerts</p>
            <p className={helpClass}>
              Osprey keeps scanning and logging verdicts, but never texts.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={alertsPaused}
            onClick={() => setAlertsPaused((v) => !v)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${
              alertsPaused ? "bg-amber-500" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                alertsPaused ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Financing profiles */}
      <div className={cardClass}>
        <h2 className={labelClass}>Financing profiles</h2>
        <p className={helpClass}>
          Every matching listing is underwritten at each of these.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {financingProfiles.map((p, i) => {
            const downPct = (p as { downPct?: number }).downPct;
            const rate = (p as { rate?: number }).rate;
            const label = (p as { label?: string }).label;
            const showDownPct = p.kind === "conventional" || p.kind === "dscr" || (p.kind === "fha" && downPct != null);
            const showRate = p.kind !== "cash";

            return (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-violet-200">
                    {KIND_LABELS[p.kind]}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFinancing(i)}
                    disabled={financingProfiles.length <= 1}
                    className="text-xs text-white/50 transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {showDownPct && (
                    <div>
                      <label className="mb-1 block text-xs text-white/50">Down %</label>
                      <input
                        type="number"
                        step="0.01"
                        value={pctToDisplay(downPct)}
                        onChange={(e) =>
                          patchFinancing(i, { downPct: displayToPct(e.target.value) })
                        }
                        className={fieldClass}
                      />
                    </div>
                  )}
                  {showRate && (
                    <div>
                      <label className="mb-1 block text-xs text-white/50">Rate %</label>
                      <input
                        type="number"
                        step="0.01"
                        value={pctToDisplay(rate)}
                        onChange={(e) =>
                          patchFinancing(i, { rate: displayToPct(e.target.value) })
                        }
                        className={fieldClass}
                      />
                    </div>
                  )}
                  <div className={showDownPct && showRate ? "col-span-2 sm:col-span-1" : "col-span-2"}>
                    <label className="mb-1 block text-xs text-white/50">Label (optional)</label>
                    <input
                      type="text"
                      value={label ?? ""}
                      onChange={(e) => patchFinancing(i, { label: e.target.value })}
                      placeholder="My 25% down"
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <select
            value={presetKey}
            onChange={(e) => setPresetKey(e.target.value as PresetKey)}
            className={`${fieldClass} flex-1`}
          >
            {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
              <option key={k} value={k} className="bg-[#170f36]">
                {PRESETS[k].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addFinancing}
            className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.1]"
          >
            Add
          </button>
        </div>
      </div>

      {/* Taste & dealbreakers */}
      <div id="taste" className={cardClass}>
        <h2 className={labelClass}>Taste & dealbreakers</h2>
        <p className={helpClass}>
          Dealbreakers reject a listing before it&apos;s underwritten — a match on paper that fails
          one of these never reaches your feed. Taste notes are learned from your Telegram passes;
          edit or clear them here.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">Taste notes</label>
            {tasteNotes.length > 0 && (
              <ul className="mb-2 flex flex-col gap-2">
                {tasteNotes.map((note, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80"
                  >
                    <span>{note}</span>
                    <button
                      type="button"
                      onClick={() => removeNote(i)}
                      className="flex-shrink-0 text-xs text-white/50 transition hover:text-red-300"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNote();
                  }
                }}
                placeholder="e.g. Skip busy-road listings"
                className={fieldClass}
              />
              <button
                type="button"
                onClick={addNote}
                className="whitespace-nowrap rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.1]"
              >
                Add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">Max HOA ($/mo)</label>
              <input
                type="number"
                min={0}
                value={maxHoaMonthly}
                onChange={(e) => setMaxHoaMonthly(e.target.value)}
                placeholder="No limit"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Min year built</label>
              <input
                type="number"
                min={1700}
                max={2100}
                value={minYearBuilt}
                onChange={(e) => setMinYearBuilt(e.target.value)}
                placeholder="No limit"
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/50">Excluded zips</label>
            <input
              type="text"
              value={excludeZipsText}
              onChange={(e) => setExcludeZipsText(e.target.value)}
              placeholder="89101, 89104"
              className={fieldClass}
            />
            <p className={helpClass}>Comma-separated. Listings in these zips are never underwritten.</p>
          </div>
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full rounded-xl bg-indigo-500 px-5 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60 sm:w-auto"
        >
          {status === "submitting" ? "Saving..." : "Save settings"}
        </button>

        {status === "success" && (
          <p className="mt-3 text-sm text-emerald-400">Saved.</p>
        )}
        {status === "error" && <p className="mt-3 text-sm text-red-400">{errorMsg}</p>}
      </div>
    </form>
  );
}
