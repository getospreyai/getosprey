import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveRequestScope } from "@/lib/request-scope";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import TelegramConnectCard from "@/components/TelegramConnectCard";
import VerdictList from "@/components/VerdictList";
import type { InvestorProfile, BuyBox } from "@/osprey/agent/model";
import type { VerdictRecord } from "@/osprey/agent/loop";
import type { PropertyType } from "@/osprey/engine/types";
import { formatMoney } from "@/lib/format";

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
  const scoped = await resolveRequestScope();
  // Unauthenticated, or an account revoked after its JWT was issued — both go
  // back to login. Only a missing database falls through to the shell below.
  if (!scoped.ok && scoped.reason !== "no_db") {
    redirect("/login");
  }

  const userName = scoped.userName;
  const dbReady = scoped.ok;
  const showClients = scoped.ok && scoped.role !== "investor";
  // Telegram deep links bind a chat to the profile being viewed, so they
  // carry the SUBJECT's id, not the viewer's.
  const subjectId = scoped.ok ? scoped.scope.subjectId : "";

  let profile: InvestorProfile | null = null;
  let verdicts: VerdictRecord[] = [];

  if (scoped.ok) {
    [profile, verdicts] = await Promise.all([
      scoped.store.loadProfile(),
      scoped.store.loadRecentVerdicts(50),
    ]);
  }

  if (profile && profile.onboarded === false) {
    redirect("/onboarding");
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <AppNav userName={userName} active="dashboard" showClients={showClients} />

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

            <TelegramConnectCard userId={subjectId} telegramChatId={profile.telegramChatId ?? null} />

            {profile.tasteNotes && profile.tasteNotes.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-white">What Osprey has learned</h2>
                  <Link
                    href="/settings#taste"
                    className="text-xs text-violet-300 transition hover:text-violet-200"
                  >
                    Edit taste & dealbreakers →
                  </Link>
                </div>
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
                    href={`https://t.me/OspreyAlphaBot?start=${subjectId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
                  >
                    Open this in Telegram
                  </a>
                </div>
              ) : (
                <VerdictList verdicts={verdicts} minMonthlyCashFlow={profile.minMonthlyCashFlow} />
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
