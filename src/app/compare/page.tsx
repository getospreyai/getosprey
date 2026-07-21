import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import LegalDisclaimer from "@/components/LegalDisclaimer";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { bestUnderwriting } from "@/lib/best-underwriting";
import { formatMoney, formatPct, formatSignedMonthly } from "@/lib/format";
import { project, toIncomeInput, toPropertyInput, type Underwriting } from "@/osprey/engine";

interface Column {
  listingId: string;
  address: string;
  price: number;
  uw: Underwriting;
  irr10: number | null;
}

const MIN_IDS = 2;
const MAX_IDS = 4;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: idsParam } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;
  const userName = session.user.name ?? "there";
  const dbReady = hasDb();

  const ids = Array.from(new Set((idsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean)));

  if (!dbReady) {
    return (
      <Shell userName={userName}>
        <Message title="Compare not configured">
          The database isn&apos;t connected in this environment.
        </Message>
      </Shell>
    );
  }

  if (ids.length < MIN_IDS || ids.length > MAX_IDS) {
    return (
      <Shell userName={userName}>
        <Message title="Pick 2–4 properties">
          Select between 2 and 4 verdicts from your dashboard to compare them side-by-side.
        </Message>
      </Shell>
    );
  }

  const store = new PgStore();
  const profile = await store.loadProfile(userId);
  if (profile && profile.onboarded === false) {
    redirect("/onboarding");
  }
  if (!profile) {
    return (
      <Shell userName={userName}>
        <Message title="No profile found">
          We couldn&apos;t find your investor profile. Try signing in again.
        </Message>
      </Shell>
    );
  }

  const columns: Column[] = [];
  const skipped: string[] = [];

  for (const listingId of ids) {
    const verdict = await store.loadVerdictForListing(userId, listingId);
    if (!verdict) {
      skipped.push(listingId);
      continue;
    }
    const snapshot = await store.loadSnapshot(listingId);
    const property = snapshot ? toPropertyInput(snapshot.listing) : null;
    const income = snapshot?.rent ? toIncomeInput(snapshot.rent) : null;
    if (!property || !income) {
      skipped.push(listingId);
      continue;
    }
    const uw = bestUnderwriting(property, income, profile);
    if (!uw) {
      skipped.push(listingId);
      continue;
    }
    const projection = project(uw, 10);
    columns.push({
      listingId,
      address: snapshot!.listing.formattedAddress ?? snapshot!.listing.addressLine1 ?? verdict.address,
      price: snapshot!.listing.price ?? verdict.price,
      uw,
      irr10: projection.irrAtExitPct,
    });
  }

  if (columns.length < MIN_IDS) {
    return (
      <Shell userName={userName}>
        <Message title="Not enough data to compare">
          None of the selected properties have enough live data (a listing snapshot with a rent
          estimate) to underwrite. Live modeling starts with new verdicts.
        </Message>
      </Shell>
    );
  }

  const cashFlows = columns.map((c) => c.uw.monthlyCashFlow);
  const capRates = columns.map((c) => c.uw.metrics.capRatePct);
  const cocs = columns.map((c) => c.uw.metrics.cashOnCashPct);
  const dscrs = columns.map((c) => c.uw.metrics.lenderDscr ?? -Infinity);
  const grms = columns.map((c) => c.uw.metrics.grossRentMultiplier);
  const cashToCloses = columns.map((c) => c.uw.cashToClose);
  const irrs = columns.map((c) => c.irr10 ?? -Infinity);

  const bestCashFlow = Math.max(...cashFlows);
  const bestCapRate = Math.max(...capRates);
  const bestCoc = Math.max(...cocs);
  const bestDscr = Math.max(...dscrs);
  const bestGrm = Math.min(...grms);
  const bestCashToClose = Math.min(...cashToCloses);
  const bestIrr = Math.max(...irrs);

  return (
    <Shell userName={userName}>
      <div>
        <Link href="/dashboard" className="text-xs text-white/50 transition hover:text-white">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Compare</h1>
        {skipped.length > 0 && (
          <p className="mt-1 text-xs text-white/40">
            Skipped {skipped.length} propert{skipped.length === 1 ? "y" : "ies"} without enough
            live data.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-md">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="w-40 py-4 pl-6 pr-4 font-normal text-white/40" />
              {columns.map((c) => (
                <th key={c.listingId} className="min-w-[180px] px-4 py-4 align-top">
                  <Link
                    href={`/property/${c.listingId}`}
                    className="text-sm font-medium text-white hover:text-violet-200"
                  >
                    {c.address}
                  </Link>
                  <p className="mt-1 text-xs text-white/50">{formatMoney(c.price)}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            <MetricRow
              label="Monthly cash flow"
              columns={columns}
              value={(c) => formatSignedMonthly(c.uw.monthlyCashFlow)}
              isBest={(c) => c.uw.monthlyCashFlow === bestCashFlow}
            />
            <MetricRow
              label="Cap rate"
              columns={columns}
              value={(c) => formatPct(c.uw.metrics.capRatePct)}
              isBest={(c) => c.uw.metrics.capRatePct === bestCapRate}
            />
            <MetricRow
              label="Cash on cash"
              columns={columns}
              value={(c) => formatPct(c.uw.metrics.cashOnCashPct)}
              isBest={(c) => c.uw.metrics.cashOnCashPct === bestCoc}
            />
            <MetricRow
              label="Lender DSCR"
              columns={columns}
              value={(c) => (c.uw.metrics.lenderDscr != null ? c.uw.metrics.lenderDscr.toFixed(2) : "n/a")}
              isBest={(c) => (c.uw.metrics.lenderDscr ?? -Infinity) === bestDscr}
            />
            <MetricRow
              label="GRM"
              columns={columns}
              value={(c) => c.uw.metrics.grossRentMultiplier.toFixed(1)}
              isBest={(c) => c.uw.metrics.grossRentMultiplier === bestGrm}
            />
            <MetricRow
              label="1% rule"
              columns={columns}
              value={(c) => (c.uw.metrics.onePercentRule ? "Passes" : "Fails")}
              isBest={(c) => c.uw.metrics.onePercentRule}
            />
            <MetricRow
              label="Cash to close"
              columns={columns}
              value={(c) => formatMoney(c.uw.cashToClose)}
              isBest={(c) => c.uw.cashToClose === bestCashToClose}
            />
            <MetricRow
              label="10-yr IRR"
              columns={columns}
              value={(c) => (c.irr10 != null ? formatPct(c.irr10) : "n/a")}
              isBest={(c) => (c.irr10 ?? -Infinity) === bestIrr}
            />
          </tbody>
        </table>
      </div>

      <LegalDisclaimer />
    </Shell>
  );
}

function MetricRow({
  label,
  columns,
  value,
  isBest,
}: {
  label: string;
  columns: Column[];
  value: (c: Column) => string;
  isBest: (c: Column) => boolean;
}) {
  return (
    <tr>
      <td className="py-3 pl-6 pr-4 text-xs text-white/50">{label}</td>
      {columns.map((c) => {
        const best = isBest(c);
        return (
          <td
            key={c.listingId}
            className={
              best
                ? "px-4 py-3 font-medium text-emerald-400"
                : "px-4 py-3 text-white/80"
            }
          >
            {value(c)}
            {best && <span className="ml-1.5 text-[10px] text-emerald-400/70">best</span>}
          </td>
        );
      })}
    </tr>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-2 text-sm text-white/60">{children}</p>
      <Link
        href="/dashboard"
        className="mt-4 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

function Shell({ userName, children }: { userName: string; children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <AppNav userName={userName} active="dashboard" />
      <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 pb-16 sm:px-10">
        {children}
      </section>
    </main>
  );
}
