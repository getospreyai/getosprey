import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import TelegramConnectCard from "@/components/TelegramConnectCard";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import type { InvestorProfile, BuyBox } from "@/osprey/agent/model";
import type { VerdictRecord } from "@/osprey/agent/loop";
import type { PropertyType } from "@/osprey/engine/types";
import { formatMoney, formatSignedMonthly, relativeTime } from "@/lib/format";

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  single_family: "Single-family",
  duplex: "Duplex",
  triplex: "Triplex",
  fourplex: "Fourplex",
};

function summarizeTypes(types: PropertyType[]): string {
  if (types.length === 0) return "Any property type";
  return types.map((t) => PROPERTY_TYPE_LABELS[t]).join(", ");
}

function summarizeLocation(buyBox: BuyBox): string {
  if (buyBox.cities && buyBox.cities.length > 0) return buyBox.cities.join(", ");
  if (buyBox.states && buyBox.states.length > 0) return buyBox.states.join(", ");
  return "Anywhere";
}

function summarizePrice(buyBox: BuyBox): string {
  const { minPrice, maxPrice } = buyBox;
  if (minPrice == null && maxPrice == null) return "Any price";
  if (minPrice != null && maxPrice != null) {
    return `${formatMoney(minPrice)}–${formatMoney(maxPrice)}`;
  }
  if (minPrice != null) return `${formatMoney(minPrice)}+`;
  return `Up to ${formatMoney(maxPrice as number)}`;
}

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;
  const userName = session.user.name ?? "there";
  const dbReady = hasDb();

  let profile: InvestorProfile | null = null;
  let verdicts: VerdictRecord[] = [];

  if (dbReady) {
    const store = new PgStore();
    [profile, verdicts] = await Promise.all([
      store.loadProfile(userId),
      store.loadRecentVerdicts<VerdictRecord>(userId, 50),
    ]);
  }

  if (profile && profile.onboarded === false) {
    redirect("/onboarding");
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <AppNav userName={userName} active="dashboard" />

      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-16 sm:px-10">
        {!dbReady ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
            <p className="text-sm font-medium text-white">Dashboard not configured</p>
            <p className="mt-2 text-sm text-white/60">
              The database isn&apos;t connected in this environment, so verdicts and buy-box
              details can&apos;t load right now.
            </p>
          </div>
        ) : !profile ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
            <p className="text-sm font-medium text-white">No profile found</p>
            <p className="mt-2 text-sm text-white/60">
              We couldn&apos;t find your investor profile. Try signing in again.
            </p>
          </div>
        ) : (
          <>
            {/* Status strip */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80">
                <span>{summarizeTypes(profile.buyBox.propertyTypes)}</span>
                <span className="text-white/30">·</span>
                <span>{summarizeLocation(profile.buyBox)}</span>
                <span className="text-white/30">·</span>
                <span>{summarizePrice(profile.buyBox)}</span>
                <span className="text-white/30">·</span>
                <span>
                  Bar{" "}
                  <span className="text-violet-200">
                    {formatMoney(profile.minMonthlyCashFlow)}/mo
                  </span>
                </span>
              </div>
              {profile.alertsPaused && (
                <span className="mt-3 inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/[0.08] px-3 py-1 text-xs text-amber-200">
                  Alerts paused
                </span>
              )}
            </div>

            <TelegramConnectCard userId={userId} telegramChatId={profile.telegramChatId ?? null} />

            {profile.tasteNotes && profile.tasteNotes.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
                <h2 className="text-sm font-medium text-white">What Osprey has learned</h2>
                <ul className="mt-3 space-y-2 text-sm text-white/60">
                  {profile.tasteNotes.map((note, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span aria-hidden className="text-violet-300">
                        —
                      </span>
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Verdict feed */}
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-medium text-white">Verdicts</h2>

              {verdicts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
                  <p className="text-sm font-medium text-white">No verdicts yet.</p>
                  <p className="mt-2 text-sm text-white/60">
                    Osprey scans daily; connect Telegram so verdicts reach you.
                  </p>
                  <a
                    href={`https://t.me/OspreyAlphaBot?start=${userId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
                  >
                    Open this in Telegram
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {verdicts.map((v) => {
                    const clearsBar = v.monthlyCashFlow >= profile.minMonthlyCashFlow;
                    return (
                      <div
                        key={`${v.listingId}-${v.at}`}
                        className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-md"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-white">{v.address}</p>
                            <p className="mt-0.5 text-xs text-white/50">
                              {formatMoney(v.price)} · {v.financingLabel}
                            </p>
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
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
