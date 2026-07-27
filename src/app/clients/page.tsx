import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { parseFarmMarkets } from "@/lib/farm-markets";
import { PgStore, type AgentClientRow } from "@/osprey/pg-store";
import { isScannable } from "@/osprey/agent/scannable";
import { marketLabel } from "@/osprey/agent/watcher";
import { formatMoney, formatSignedMonthly } from "@/lib/format";
import type { VerdictRecord } from "@/osprey/agent/loop";

export const metadata = { title: "Clients — Osprey" };

const cardClass =
  "glow-card rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md";

function StatusBadge({ status }: { status: string }) {
  // 'managed' is the normal Phase 1 state and deliberately reads as neutral,
  // not as a warning — it means "you maintain this buy box".
  const label =
    status === "active" ? "Claimed" : status === "invited" ? "Invited" : "Managed by you";
  const tone =
    status === "active"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : status === "invited"
        ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
        : "border-white/15 bg-white/[0.06] text-white/60";
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${tone}`}>{label}</span>
  );
}

function ClientCard({
  client,
  latestVerdict,
}: {
  client: AgentClientRow;
  latestVerdict?: VerdictRecord;
}) {
  const profile = client.profile;
  // The whole point of surfacing this: a client the scan will skip looks
  // identical to one that scans and finds nothing. Say which it is.
  const scan = profile ? isScannable(profile) : null;
  const markets = profile
    ? [
        ...(profile.buyBox.cities?.length
          ? profile.buyBox.cities
          : (profile.buyBox.states ?? [])),
      ].join(", ")
    : "—";

  return (
    <Link href={`/clients/${client.clientUserId}`} className={`${cardClass} block`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">{client.name}</h2>
          {client.label && <p className="mt-0.5 text-xs text-white/45">{client.label}</p>}
        </div>
        <StatusBadge status={client.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-white/40">Market</dt>
          <dd className="mt-0.5 text-white/80">{markets || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/40">Cash-flow bar</dt>
          <dd className="mt-0.5 text-white/80">
            {profile ? `${formatMoney(profile.minMonthlyCashFlow)}/mo` : "—"}
          </dd>
        </div>
      </dl>

      {scan && !scan.ok ? (
        <p className="mt-4 rounded-lg border border-amber-400/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200">
          Not scanning — {scan.reason}
        </p>
      ) : latestVerdict ? (
        <p className="mt-4 text-xs text-white/50">
          Last match:{" "}
          <span className="text-white/80">{latestVerdict.address}</span> ·{" "}
          <span className="text-emerald-300">
            {formatSignedMonthly(latestVerdict.monthlyCashFlow)}
          </span>
        </p>
      ) : (
        <p className="mt-4 text-xs text-white/40">
          Scanning — nothing has cleared their bar yet.
        </p>
      )}
    </Link>
  );
}

export default async function ClientsPage() {
  // The flag gates VISIBILITY only; resolveScope still governs access.
  if (!agentAccountsEnabled()) notFound();

  const scoped = await resolveRequestScope();
  if (!scoped.ok && scoped.reason !== "no_db") {
    redirect("/login");
  }

  const userName = scoped.userName;

  if (!scoped.ok) {
    return (
      <Shell userName={userName}>
        <div className={cardClass}>
          <p className="text-sm font-medium text-white">Clients not configured</p>
          <p className="mt-2 text-sm text-white/60">
            The database isn&apos;t connected in this environment.
          </p>
        </div>
      </Shell>
    );
  }

  const store = new PgStore();
  const [clients, rawFarm] = await Promise.all([
    store.listAgentClients(scoped.userId),
    store.loadFarmMarkets(scoped.userId),
  ]);
  const farm = parseFarmMarkets(rawFarm);
  const latest = await store.loadLatestVerdictPerUser(clients.map((c) => c.clientUserId));

  return (
    <Shell userName={userName}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your clients</h1>
          <p className="mt-1.5 text-sm text-white/55">
            {farm.length > 0 ? (
              <>Farming {farm.map(marketLabel).join(" · ")}</>
            ) : (
              <>No farm markets set yet — add them before your first client.</>
            )}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="glow-cta rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] hover:bg-indigo-400"
        >
          Add a client
        </Link>
      </div>

      {clients.length === 0 ? (
        <div className={`${cardClass} mt-8 text-center`}>
          <p className="text-sm font-medium text-white">No clients yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
            Add a client and Osprey underwrites every new listing in your farm at their
            financing — you get the verdicts, they get a buy box you control.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <ClientCard
              key={c.clientUserId}
              client={c}
              latestVerdict={latest.get(c.clientUserId)}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({ userName, children }: { userName: string; children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <AppNav userName={userName} active="clients" showClients />
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20 pt-4 sm:px-10">
        {children}
      </section>
    </main>
  );
}
