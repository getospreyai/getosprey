"use client";

import { useEffect, useRef, useState } from "react";
import type { FinancingProfile, PropertyType } from "@/osprey/engine/types";
import type { ScanSummary } from "@/osprey/agent/loop";

type PresetKey = "conventional" | "dscr" | "fha" | "cash";
type Phase = "form" | "scanning" | "results" | "snag" | "error";

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
    minPrice: number | null;
    maxPrice: number | null;
    propertyTypes: PropertyType[];
    maxDaysOnMarket: number | null;
  };
  minMonthlyCashFlow: number;
  alertsPaused: boolean;
  financingProfiles: FinancingProfile[];
}

export default function OnboardingWizard({ userId }: { userId: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phase, setPhase] = useState<Phase>("form");
  const [errorMsg, setErrorMsg] = useState("");

  // Step 1 — buy box
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
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Results
  const [scan, setScan] = useState<ScanSummary | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buildPayload(): OnboardingPayload {
    return {
      buyBox: {
        cities: [],
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
        const res = await fetch("/api/profile");
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

      if (data?.scan) {
        setScan(data.scan as ScanSummary);
        setPhase("results");
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
          Osprey is underwriting the current Las Vegas market at your numbers…
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
              <span className="inline-flex items-center rounded-full border border-violet-400/30 bg-violet-500/[0.1] px-3.5 py-1.5 text-sm text-violet-200">
                Las Vegas, NV — our first market
              </span>
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
                financing. At today&apos;s rates most Las Vegas listings run negative at 25% down
                — a bar near $0 means only standout deals; a negative bar shows you the best of
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
