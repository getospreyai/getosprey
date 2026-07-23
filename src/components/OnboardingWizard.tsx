"use client";

import { useEffect, useRef, useState } from "react";
import type { FinancingProfile, PropertyType } from "@/osprey/engine/types";
import type { ScanSummary } from "@/osprey/agent/loop";

type PresetKey = "conventional" | "dscr" | "fha" | "cash";
type Phase = "form" | "scanning" | "results" | "snag" | "paused" | "error";

const PROPERTY_TYPES: PropertyType[] = ["single_family", "duplex", "triplex", "fourplex"];
const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  single_family: "Single-family",
  duplex: "Duplex",
  triplex: "Triplex",
  fourplex: "Fourplex",
};

const PRESETS: Record<PresetKey, { label: string; make: () => FinancingProfile }> = {
  conventional: {
    label: "Conventional — 25% down @ 6.75%",
    make: () => ({ kind: "conventional", downPct: 0.25, rate: 0.0675 }),
  },
  dscr: {
    label: "DSCR — 20% down @ 7.25%",
    make: () => ({ kind: "dscr", downPct: 0.2, rate: 0.0725, minDscr: 1 }),
  },
  fha: {
    label: "FHA — 3.5% down @ 6.25%",
    make: () => ({ kind: "fha", downPct: 0.035, rate: 0.0625 }),
  },
  cash: {
    label: "Cash",
    make: () => ({ kind: "cash" }),
  },
};

const KIND_LABELS: Record<FinancingProfile["kind"], string> = {
  conventional: "Conventional",
  fha: "FHA",
  dscr: "DSCR",
  cash: "Cash",
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
const helpClass = "mt-1 text-xs text-white/50";
const primaryButtonClass =
  "rounded-xl bg-indigo-500 px-5 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-medium text-white transition hover:bg-white/[0.1]";
const presetButtonClass =
  "rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2 text-sm text-white/80 transition hover:border-violet-400/50 hover:bg-white/[0.08] hover:text-white";

interface OnboardingPayload {
  buyBox: {
    cities: string[];
    states: string[];
    minPrice: number | null;
    maxPrice: number | null;
    propertyTypes: PropertyType[];
    maxDaysOnMarket: number | null;
  };
  minMonthlyCashFlow: number;
  alertsPaused: boolean;
  financingProfiles: FinancingProfile[];
}

/** Wizard progress previously saved server-side (via the step-3 PATCH),
 *  passed down so a page reload can resume instead of restarting. */
export interface SavedProgress {
  city: string;
  state: string;
  propertyTypes: PropertyType[];
  minPrice: number | null;
  maxPrice: number | null;
  maxDaysOnMarket: number | null;
  financingProfiles: FinancingProfile[];
  minMonthlyCashFlow: number;
}

const STORAGE_KEY = "osprey-onboarding-v1";

interface StoredState {
  step: 1 | 2 | 3;
  city: string;
  state: string;
  propertyTypes: PropertyType[];
  minPrice: string;
  maxPrice: string;
  maxDaysOnMarket: string;
  financingProfiles: FinancingProfile[];
  minMonthlyCashFlow: string;
}

export default function OnboardingWizard({
  userId,
  initialConnected = false,
  saved = null,
}: {
  userId: string;
  initialConnected?: boolean;
  saved?: SavedProgress | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phase, setPhase] = useState<Phase>("form");
  const [errorMsg, setErrorMsg] = useState("");

  // Step 1 — buy box
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [maxDaysOnMarket, setMaxDaysOnMarket] = useState("");
  const [step1Error, setStep1Error] = useState("");

  // Step 2 — financing + alert bar
  const [financingProfiles, setFinancingProfiles] = useState<FinancingProfile[]>([]);
  const [minMonthlyCashFlow, setMinMonthlyCashFlow] = useState("0");
  const [step2Error, setStep2Error] = useState("");

  // Step 3 — Telegram
  const [savingStep3, setSavingStep3] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(initialConnected);
  const [finishing, setFinishing] = useState(false);

  // Resume after a reload: sessionStorage first (exact in-progress state),
  // else server-saved progress (survives new tabs / cleared storage). Runs
  // once on mount, after hydration, so SSR markup stays deterministic.
  const hydrated = useRef(false);
  // One-shot post-mount restore. Reading sessionStorage in a lazy useState
  // initializer would desync SSR and client HTML (hydration mismatch), so
  // the setState-after-mount pattern is deliberate here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as StoredState;
        setStep(s.step);
        setCity(s.city ?? "");
        setStateCode(s.state ?? "");
        setPropertyTypes(s.propertyTypes ?? []);
        setMinPrice(s.minPrice ?? "");
        setMaxPrice(s.maxPrice ?? "");
        setMaxDaysOnMarket(s.maxDaysOnMarket ?? "");
        setFinancingProfiles(s.financingProfiles ?? []);
        setMinMonthlyCashFlow(s.minMonthlyCashFlow ?? "0");
        return;
      }
    } catch {
      // corrupted storage — fall through to server-saved progress
    }

    if (saved && saved.propertyTypes.length > 0 && saved.financingProfiles.length > 0) {
      // They made it to step 3 before (the step-3 PATCH saved this) — resume there.
      setCity(saved.city);
      setStateCode(saved.state);
      setPropertyTypes(saved.propertyTypes);
      setMinPrice(saved.minPrice == null ? "" : String(saved.minPrice));
      setMaxPrice(saved.maxPrice == null ? "" : String(saved.maxPrice));
      setMaxDaysOnMarket(saved.maxDaysOnMarket == null ? "" : String(saved.maxDaysOnMarket));
      setFinancingProfiles(saved.financingProfiles);
      setMinMonthlyCashFlow(String(saved.minMonthlyCashFlow));
      setStep(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist progress so a reload never restarts the wizard.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      const s: StoredState = {
        step,
        city,
        state: stateCode,
        propertyTypes,
        minPrice,
        maxPrice,
        maxDaysOnMarket,
        financingProfiles,
        minMonthlyCashFlow,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // storage unavailable (private mode etc.) — server-saved progress still covers reloads
    }
  }, [step, city, stateCode, propertyTypes, minPrice, maxPrice, maxDaysOnMarket, financingProfiles, minMonthlyCashFlow]);

  // Results
  const [scan, setScan] = useState<ScanSummary | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buildPayload(): OnboardingPayload {
    return {
      buyBox: {
        cities: city.trim() === "" ? [] : [city.trim()],
        states: stateCode.trim() === "" ? [] : [stateCode.trim()],
        minPrice: minPrice.trim() === "" ? null : Number(minPrice),
        maxPrice: maxPrice.trim() === "" ? null : Number(maxPrice),
        propertyTypes,
        maxDaysOnMarket: maxDaysOnMarket.trim() === "" ? null : Number(maxDaysOnMarket),
      },
      minMonthlyCashFlow: minMonthlyCashFlow.trim() === "" ? 0 : Number(minMonthlyCashFlow),
      alertsPaused: false,
      financingProfiles,
    };
  }

  function toggleType(t: PropertyType) {
    setPropertyTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function addFinancing(key: PresetKey) {
    setFinancingProfiles((prev) => [...prev, PRESETS[key].make()]);
  }

  function patchFinancing(index: number, patch: { downPct?: number; rate?: number }) {
    setFinancingProfiles((prev) =>
      prev.map((p, i) => (i === index ? ({ ...p, ...patch } as FinancingProfile) : p))
    );
  }

  function removeFinancing(index: number) {
    setFinancingProfiles((prev) => prev.filter((_, i) => i !== index));
  }

  function goToStep2() {
    if (stateCode.trim() === "") {
      setStep1Error("Enter your state — city is optional.");
      return;
    }
    if (propertyTypes.length === 0) {
      setStep1Error("Choose at least one property type.");
      return;
    }
    setStep1Error("");
    setStep(2);
  }

  async function goToStep3() {
    if (financingProfiles.length === 0) {
      setStep2Error("Add at least one financing option.");
      return;
    }
    setStep2Error("");
    setStep(3);

    // Save the buy box now, before Telegram — so it's persisted even if the
    // user bails on this step.
    setSavingStep3(true);
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
    } catch {
      // Non-fatal: Finish re-saves everything via /api/onboarding/complete.
    } finally {
      setSavingStep3(false);
    }
  }

  // Poll for the Telegram connection while step 3 is mounted and unconnected.
  useEffect(() => {
    if (step !== 3 || phase !== "form" || telegramConnected) return;

    const poll = async () => {
      try {
        // Cache-busting query param + no-store: this response must always be
        // fresh or the "Connected ✓" flip never happens.
        const res = await fetch(`/api/profile?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.telegramChatId != null) setTelegramConnected(true);
      } catch {
        // ignore — try again on the next tick
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, phase, telegramConnected]);

  async function finish() {
    setFinishing(true);
    setPhase("scanning");
    setErrorMsg("");

    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) {
          window.location.href = "/dashboard";
          return;
        }
        setPhase("error");
        setErrorMsg(data?.error ?? "Something went wrong. Try again.");
        return;
      }

      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // non-fatal
      }

      if (data?.scan) {
        setScan(data.scan as ScanSummary);
        setPhase("results");
      } else if (data?.reason === "scans_paused") {
        setPhase("paused");
      } else {
        setPhase("snag");
      }
    } catch {
      setPhase("error");
      setErrorMsg("Something went wrong. Try again.");
    } finally {
      setFinishing(false);
    }
  }

  if (phase === "scanning") {
    return (
      <div className={`${cardClass} flex flex-col items-center gap-4 py-14 text-center`}>
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-violet-400" />
        </span>
        <p className="text-base font-medium text-white">
          Osprey is underwriting your market at your numbers…
        </p>
        <p className="text-sm text-white/50">This usually takes under a minute.</p>
      </div>
    );
  }

  if (phase === "snag") {
    return (
      <div className={`${cardClass} flex flex-col items-center gap-4 py-14 text-center`}>
        <p className="text-base font-medium text-white">
          Your first scan hit a snag — the daily scan will cover you tomorrow.
        </p>
        <a href="/dashboard" className={primaryButtonClass}>
          Open my dashboard
        </a>
      </div>
    );
  }

  if (phase === "paused") {
    return (
      <div className={`${cardClass} flex flex-col items-center gap-4 py-14 text-center`}>
        <p className="text-base font-medium text-white">You&apos;re all set.</p>
        <p className="max-w-md text-sm text-white/60">
          Live market scans are paused right now — your buy box is saved and verdicts will start
          arriving as soon as scans resume.
        </p>
        <a href="/dashboard" className={primaryButtonClass}>
          Open my dashboard
        </a>
      </div>
    );
  }

  if (phase === "results" && scan) {
    const sentToTelegram = telegramConnected && scan.texts > 0;
    return (
      <div className={`${cardClass} flex flex-col items-center gap-4 py-14 text-center`}>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Scanned{" "}
          <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
            {scan.scanned}
          </span>{" "}
          listings · {scan.matched} matched your buy box · {scan.texts} cleared your bar
        </h2>
        {sentToTelegram && (
          <p className="text-sm text-emerald-300">Sent to your Telegram.</p>
        )}
        <p className="max-w-md text-sm text-white/60">
          Everything Osprey found — including the quiet ones that didn&apos;t clear your bar —
          is on your dashboard.
        </p>
        <a href="/dashboard" className={`${primaryButtonClass} mt-2`}>
          Open my dashboard
        </a>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={`${cardClass} flex flex-col items-center gap-4 py-14 text-center`}>
        <p className="text-base font-medium text-white">{errorMsg}</p>
        <button type="button" className={primaryButtonClass} onClick={finish}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>Step {step} of 3</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-violet-400 transition-all"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </div>

      <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        {step === 1 && (
          <>
            Set your{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              buy box.
            </span>
          </>
        )}
        {step === 2 && (
          <>
            How are you{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              financing?
            </span>
          </>
        )}
        {step === 3 && (
          <>
            Get verdicts on{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              Telegram.
            </span>
          </>
        )}
      </h1>

      {step === 1 && (
        <div className={cardClass}>
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs text-white/50">Market</label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City (optional)"
                  className={fieldClass}
                />
                <input
                  type="text"
                  value={stateCode}
                  onChange={(e) =>
                    setStateCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))
                  }
                  maxLength={2}
                  placeholder="State"
                  className={fieldClass}
                />
              </div>
              <p className={helpClass}>
                City optional — leave it blank and Osprey scans the whole state.
              </p>
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
              <label className="mb-1 block text-xs text-white/50">Max days on market</label>
              <input
                type="number"
                min={0}
                value={maxDaysOnMarket}
                onChange={(e) => setMaxDaysOnMarket(e.target.value)}
                placeholder="7"
                className={fieldClass}
              />
              <p className={helpClass}>Optional — ignore listings older than this many days.</p>
            </div>

            {step1Error && <p className="text-sm text-red-400">{step1Error}</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-6">
          <div className={cardClass}>
            <h2 className="text-sm font-medium text-white">Financing</h2>
            <p className={helpClass}>Every matching listing is underwritten at each of these.</p>

            <div className="mt-4 flex flex-col gap-3">
              {financingProfiles.map((p, i) => {
                const downPct = (p as { downPct?: number }).downPct;
                const rate = (p as { rate?: number }).rate;
                const showDownPct = p.kind !== "cash" && (p.kind !== "fha" || downPct != null);
                const showRate = p.kind !== "cash";

                return (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-violet-200">{KIND_LABELS[p.kind]}</span>
                      <button
                        type="button"
                        onClick={() => removeFinancing(i)}
                        className="text-xs text-white/50 transition hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                    {(showDownPct || showRate) && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {showDownPct && (
                          <div>
                            <label className="mb-1 block text-xs text-white/50">Down %</label>
                            <input
                              type="number"
                              step="0.01"
                              value={pctToDisplay(downPct)}
                              onChange={(e) => patchFinancing(i, { downPct: displayToPct(e.target.value) })}
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
                              onChange={(e) => patchFinancing(i, { rate: displayToPct(e.target.value) })}
                              className={fieldClass}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => addFinancing(k)}
                  className={presetButtonClass}
                >
                  + {PRESETS[k].label}
                </button>
              ))}
            </div>

            {step2Error && <p className="mt-3 text-sm text-red-400">{step2Error}</p>}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-medium text-white">Alert bar</h2>
            <div className="mt-4">
              <label className="mb-1 block text-xs text-white/50">Minimum monthly cash flow</label>
              <input
                type="number"
                value={minMonthlyCashFlow}
                onChange={(e) => setMinMonthlyCashFlow(e.target.value)}
                className={fieldClass}
              />
              <p className={helpClass}>
                Osprey only messages you when a deal clears this monthly cash flow at your
                financing. At today&apos;s rates a lot of listings run negative at 25% down —
                a bar near $0 means only standout deals; a negative bar shows you the best of
                the market.
              </p>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={cardClass}>
          <div className="flex flex-col items-center gap-4 text-center">
            {telegramConnected ? (
              <p className="text-sm font-medium text-emerald-300">Connected ✓</p>
            ) : (
              <>
                <p className="text-sm text-white/70">
                  Link your Telegram account and Osprey will message you the moment a deal
                  clears your bar.
                </p>
                <a
                  href={`https://t.me/OspreyAlphaBot?start=${userId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
                >
                  Open this in Telegram
                </a>
                <p className="text-xs text-white/40">
                  {savingStep3 ? "Saving your buy box…" : "Waiting for connection…"}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => (s - 1) as 1 | 2)} className={secondaryButtonClass}>
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          {step === 3 && !telegramConnected && (
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className="text-sm text-white/50 underline decoration-white/20 underline-offset-4 transition hover:text-white/80"
            >
              Skip for now
            </button>
          )}
          {step === 1 && (
            <button type="button" onClick={goToStep2} className={primaryButtonClass}>
              Continue
            </button>
          )}
          {step === 2 && (
            <button type="button" onClick={goToStep3} className={primaryButtonClass}>
              Continue
            </button>
          )}
          {step === 3 && (
            <button type="button" onClick={finish} disabled={finishing} className={primaryButtonClass}>
              Finish — run my first scan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
