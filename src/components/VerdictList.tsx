"use client";

// Dashboard verdict feed: each card links to its property page; checkboxes
// (max 4) drive a floating "Compare" button that navigates to
// /compare?ids=a,b,c. Selection is client-only, not persisted.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { VerdictRecord } from "@/osprey/agent/loop";
import { formatMoney, formatSignedMonthly, relativeTime } from "@/lib/format";

const MAX_COMPARE = 4;

export default function VerdictList({
  verdicts,
  minMonthlyCashFlow,
}: {
  verdicts: VerdictRecord[];
  minMonthlyCashFlow: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(listingId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(listingId)) {
        next.delete(listingId);
      } else if (next.size < MAX_COMPARE) {
        next.add(listingId);
      }
      return next;
    });
  }

  function goCompare() {
    router.push(`/compare?ids=${Array.from(selected).join(",")}`);
  }

  return (
    <>
      <div className="flex flex-col gap-3 pb-16">
        {verdicts.map((v) => {
          const clearsBar = v.monthlyCashFlow >= minMonthlyCashFlow;
          const checked = selected.has(v.listingId);
          return (
            <div
              key={`${v.listingId}-${v.at}`}
              className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(v.listingId)}
                    disabled={!checked && selected.size >= MAX_COMPARE}
                    aria-label={`Select ${v.address} to compare`}
                    className="mt-1 h-4 w-4 flex-shrink-0 rounded border-white/20 bg-white/10 accent-violet-500 disabled:cursor-not-allowed disabled:opacity-30"
                  />
                  <div>
                    <Link
                      href={`/property/${v.listingId}`}
                      className="text-sm font-medium text-white hover:text-violet-200"
                    >
                      {v.address}
                    </Link>
                    <p className="mt-0.5 text-xs text-white/50">
                      {formatMoney(v.price)} · {v.financingLabel}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={
                      clearsBar
                        ? "text-sm font-medium text-emerald-400"
                        : "text-sm font-medium text-white/60"
                    }
                  >
                    {formatSignedMonthly(v.monthlyCashFlow)}
                  </span>
                  <span className="text-xs text-white/40">
                    {v.wouldText ? "📨 Sent" : "· Quiet"}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-white/40">
                <span>{relativeTime(v.at)}</span>
              </div>

              {v.analysis && (
                <details className="mt-3 text-xs text-white/60">
                  <summary className="cursor-pointer select-none text-violet-300 hover:text-violet-200">
                    Full analysis
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-[family-name:var(--font-geist-mono)] text-[11px] leading-relaxed text-white/60">
                    {v.analysis}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {selected.size >= 2 && (
        <div className="fixed inset-x-0 bottom-6 z-20 flex justify-center px-6">
          <button
            type="button"
            onClick={goCompare}
            className="rounded-full bg-violet-500 px-6 py-3 text-sm font-medium text-white shadow-[0_10px_30px_rgba(139,92,246,0.5)] transition hover:bg-violet-400"
          >
            Compare ({selected.size})
          </button>
        </div>
      )}
    </>
  );
}
