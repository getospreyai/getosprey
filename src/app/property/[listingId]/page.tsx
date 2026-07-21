import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import UnderwritingBreakdown from "@/components/UnderwritingBreakdown";
import RentConfidence from "@/components/RentConfidence";
import ProjectionTable from "@/components/ProjectionTable";
import ScenarioStudio from "@/components/ScenarioStudio";
import ReportPanel from "@/components/ReportPanel";
import ShareCard from "@/components/ShareCard";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { bestUnderwriting } from "@/lib/best-underwriting";
import { PROPERTY_TYPE_LABELS } from "@/lib/property-labels";
import { formatMoney, formatSignedMonthly } from "@/lib/format";
import { listingIdFromParam } from "@/lib/listing-param";
import { project, toIncomeInput, toPropertyInput, STANDARD_ASSUMPTIONS } from "@/osprey/engine";
import { ReportSchema, type PropertyReport } from "@/osprey/reports/generate";

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md";

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const listingId = listingIdFromParam((await params).listingId);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;
  const userName = session.user.name ?? "there";
  const dbReady = hasDb();

  if (!dbReady) {
    return (
      <Shell userName={userName}>
        <div className={cardClass}>
          <p className="text-sm font-medium text-white">Property pages not configured</p>
          <p className="mt-2 text-sm text-white/60">
            The database isn&apos;t connected in this environment.
          </p>
        </div>
      </Shell>
    );
  }

  const store = new PgStore();
  const [profile, verdict] = await Promise.all([
    store.loadProfile(userId),
    store.loadVerdictForListing(userId, listingId),
  ]);

  if (profile && profile.onboarded === false) {
    redirect("/onboarding");
  }

  if (!profile) {
    return (
      <Shell userName={userName}>
        <div className={cardClass}>
          <p className="text-sm font-medium text-white">No profile found</p>
          <p className="mt-2 text-sm text-white/60">
            We couldn&apos;t find your investor profile. Try signing in again.
          </p>
        </div>
      </Shell>
    );
  }

  if (!verdict) {
    return (
      <Shell userName={userName}>
        <div className={cardClass}>
          <p className="text-sm font-medium text-white">Property not found</p>
          <p className="mt-2 text-sm text-white/60">
            This listing isn&apos;t in your verdict feed, or belongs to someone else.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
          >
            Back to dashboard
          </Link>
        </div>
      </Shell>
    );
  }

  const [snapshot, reportRow, shareLinks] = await Promise.all([
    store.loadSnapshot(listingId),
    store.getReport(userId, listingId),
    store.listShareLinks(userId),
  ]);

  const existingShare = shareLinks.find((s) => s.listingId === listingId && !s.revoked);
  const clearsBar = verdict.monthlyCashFlow >= profile.minMonthlyCashFlow;

  const property = snapshot ? toPropertyInput(snapshot.listing) : null;
  const income = snapshot?.rent ? toIncomeInput(snapshot.rent) : null;
  const underwriting = property && income ? bestUnderwriting(property, income, profile) : null;
  const projection = underwriting ? project(underwriting, 30) : null;

  const address = snapshot?.listing.formattedAddress ?? snapshot?.listing.addressLine1 ?? verdict.address;
  const price = snapshot?.listing.price ?? verdict.price;
  const propertyTypeLabel = underwriting ? PROPERTY_TYPE_LABELS[underwriting.property.propertyType] : null;

  let reportStatus: "idle" | "generating" | "ready" | "failed" = "idle";
  let parsedReport: PropertyReport | null = null;
  if (reportRow) {
    if (reportRow.status === "ready") {
      const parsed = ReportSchema.safeParse(reportRow.report);
      if (parsed.success) {
        reportStatus = "ready";
        parsedReport = parsed.data;
      }
    } else if (reportRow.status === "generating") {
      reportStatus = "generating";
    } else if (reportRow.status === "failed") {
      reportStatus = "failed";
    }
  }

  return (
    <Shell userName={userName}>
      <div>
        <Link href="/dashboard" className="text-xs text-white/50 transition hover:text-white">
          ← Dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{address}</h1>
            <p className="mt-1 text-sm text-white/60">
              {formatMoney(price)}
              {propertyTypeLabel && ` · ${propertyTypeLabel}`}
              {snapshot?.listing.bedrooms != null && ` · ${snapshot.listing.bedrooms} bd`}
              {snapshot?.listing.bathrooms != null && ` / ${snapshot.listing.bathrooms} ba`}
              {snapshot?.listing.squareFootage != null &&
                ` · ${snapshot.listing.squareFootage.toLocaleString()} sqft`}
              {snapshot?.listing.yearBuilt != null && ` · built ${snapshot.listing.yearBuilt}`}
              {snapshot?.listing.daysOnMarket != null && ` · ${snapshot.listing.daysOnMarket}d on market`}
            </p>
          </div>
          <span
            className={
              clearsBar
                ? "rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-2 text-sm font-medium text-emerald-400"
                : "rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/60"
            }
          >
            {formatSignedMonthly(verdict.monthlyCashFlow)} at {verdict.financingLabel}
          </span>
        </div>
      </div>

      {!snapshot || !property ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
          <p className="text-sm text-white/60">
            This verdict predates live modeling — no raw listing data was captured at scan time.
            Underwriting, projections, and the Scenario Studio start with new verdicts.
          </p>
          {verdict.analysis && (
            <details className="mt-4 text-xs text-white/60">
              <summary className="cursor-pointer select-none text-violet-300 hover:text-violet-200">
                Full analysis
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-[family-name:var(--font-geist-mono)] text-[11px] leading-relaxed text-white/60">
                {verdict.analysis}
              </pre>
            </details>
          )}
        </div>
      ) : (
        <>
          {income && underwriting && projection ? (
            <>
              <RentConfidence rent={income.rent} />
              <UnderwritingBreakdown uw={underwriting} />
              <ProjectionTable projection={projection} />
            </>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
              <p className="text-sm text-white/60">
                No rent estimate is on file for this property. Use the Scenario Studio below with a
                manual rent override to model it.
              </p>
            </div>
          )}

          <ScenarioStudio
            listingId={listingId}
            initialFinancing={profile.financingProfiles[0]}
            initialAssumptions={{
              vacancyPct: profile.assumptions?.vacancyPct ?? STANDARD_ASSUMPTIONS.vacancyPct,
              maintenancePct: profile.assumptions?.maintenancePct ?? STANDARD_ASSUMPTIONS.maintenancePct,
              managementPct: profile.assumptions?.managementPct ?? STANDARD_ASSUMPTIONS.managementPct,
            }}
            initialRent={snapshot.rent?.rent ?? null}
          />

          <ReportPanel
            listingId={listingId}
            initialStatus={reportStatus}
            initialReport={parsedReport}
            initialModel={reportRow?.model ?? null}
          />
        </>
      )}

      <ShareCard listingId={listingId} initialUrl={existingShare ? `/r/${existingShare.token}` : null} />
    </Shell>
  );
}

function Shell({ userName, children }: { userName: string; children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <AppNav userName={userName} active="dashboard" />
      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-16 sm:px-10">
        {children}
      </section>
    </main>
  );
}
