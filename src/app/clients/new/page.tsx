import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import NewClientForm from "@/components/NewClientForm";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { parseFarmMarkets } from "@/lib/farm-markets";
import { PgStore } from "@/osprey/pg-store";

export const metadata = { title: "Add a client — Osprey" };

export default async function NewClientPage() {
  if (!agentAccountsEnabled()) notFound();

  const scoped = await resolveRequestScope();
  if (!scoped.ok) redirect("/login");

  // The form offers only the agent's farm markets. The server re-checks with
  // withinFarm regardless — this is convenience, not the control.
  const farm = parseFarmMarkets(await new PgStore().loadFarmMarkets(scoped.userId));

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <AppNav userName={scoped.userName} active="clients" showClients />

      <section className="relative z-10 mx-auto w-full max-w-xl px-6 pb-20 pt-4 sm:px-10">
        <Link
          href="/clients"
          className="text-sm text-white/50 underline decoration-white/20 underline-offset-4 transition hover:text-white/80"
        >
          &larr; All clients
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          Add a client
        </h1>
        <p className="mt-1.5 text-sm text-white/55">
          Osprey will underwrite every new listing in their market at their financing, and
          surface the ones that clear their bar.
        </p>

        <div className="mt-8">
          <NewClientForm farm={farm} />
        </div>
      </section>
    </main>
  );
}
