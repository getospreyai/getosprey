// A client's buy box and verdict feed — today's dashboard, scoped to someone
// else. This is the first page in the product that reads another user's data,
// so the ONLY thing standing between an agent and an arbitrary client is
// resolveRequestScope(clientId): it re-reads agent_clients on every request and
// returns null for both "not your client" and "no such user".
//
// A refusal must render exactly like a nonexistent page (notFound), never a
// distinct "not allowed" — otherwise this route becomes a way to test which
// user ids exist. See docs/AGENT-ACCOUNTS-PLAN.md §3a, T4.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import VerdictList from "@/components/VerdictList";
import InviteClientCard from "@/components/InviteClientCard";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { PgStore } from "@/osprey/pg-store";
import { isScannable } from "@/osprey/agent/scannable";
import { formatMoney } from "@/lib/format";
import { PROPERTY_TYPE_LABELS } from "@/lib/property-labels";

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  if (!agentAccountsEnabled()) notFound();

  const { clientId } = await params;

  const scoped = await resolveRequestScope(clientId);
  if (!scoped.ok) {
    if (scoped.reason === "unauthenticated") redirect("/login");
    // `forbidden` covers "not your client", "no such user", and "your own
    // account was revoked" — all render identically on purpose.
    notFound();
  }

  const { store, scope, userName } = scoped;

  // A self scope here means the agent passed their own id; there is no client
  // page for yourself.
  if (scope.relation !== "agent_of_client") notFound();

  const [profile, verdicts, roster] = await Promise.all([
    store.loadProfile(),
    store.loadRecentVerdicts(50),
    // The roster row carries status and contact address, which the scope does
    // not. Read through listAgentClients so it goes through the same
    // agent-scoped query as everything else rather than a bespoke lookup.
    new PgStore().listAgentClients(scoped.userId),
  ]);

  if (!profile) notFound();

  const client = roster.find((c) => c.clientUserId === clientId);

  const scan = isScannable(profile);
  const location =
    profile.buyBox.cities?.length
      ? profile.buyBox.cities.join(", ")
      : (profile.buyBox.states ?? []).join(", ") || "Anywhere";

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <AppNav userName={userName} active="clients" showClients />

      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20 pt-4 sm:px-10">
        <Link
          href="/clients"
          className="text-sm text-white/50 underline decoration-white/20 underline-offset-4 transition hover:text-white/80"
        >
          &larr; All clients
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {profile.name}
            </h1>
            <p className="mt-1.5 text-sm text-white/55">
              {scope.canEdit
                ? "You maintain this buy box."
                : "This client has claimed their account — you have read access."}
            </p>
          </div>
        </div>

        {!scan.ok && (
          <p className="mt-6 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200">
            <span className="font-medium">Not scanning.</span> {scan.reason}
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className={cardClass}>
            <p className="text-xs text-white/40">Market</p>
            <p className="mt-1 text-sm text-white/85">{location}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-white/40">Cash-flow bar</p>
            <p className="mt-1 text-sm text-white/85">
              {formatMoney(profile.minMonthlyCashFlow)}/mo
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs text-white/40">Property types</p>
            <p className="mt-1 text-sm text-white/85">
              {profile.buyBox.propertyTypes.length > 0
                ? profile.buyBox.propertyTypes
                    .map((t) => PROPERTY_TYPE_LABELS[t])
                    .join(", ")
                : "None selected"}
            </p>
          </div>
        </div>

        {client && (
          <div className="mt-6">
            <InviteClientCard
              clientId={clientId}
              clientLabel={client.label ?? profile.name}
              status={client.status}
            />
          </div>
        )}

        <h2 className="mt-10 text-lg font-medium">Their feed</h2>
        <p className="mt-1 text-sm text-white/50">
          Every listing Osprey underwrote at this client&apos;s financing.
        </p>
        <div className="mt-4">
          <VerdictList verdicts={verdicts} minMonthlyCashFlow={profile.minMonthlyCashFlow} />
        </div>
      </section>
    </main>
  );
}
