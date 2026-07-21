import type { Metadata } from "next";
import Link from "next/link";
import Backdrop from "@/components/Backdrop";
import UnderwritingBreakdown from "@/components/UnderwritingBreakdown";
import RentConfidence from "@/components/RentConfidence";
import RentComps from "@/components/RentComps";
import Section8Card from "@/components/Section8Card";
import PriceHistory from "@/components/PriceHistory";
import MaxOfferCard from "@/components/MaxOfferCard";
import ProjectionTable from "@/components/ProjectionTable";
import LegalDisclaimer from "@/components/LegalDisclaimer";
import { ensureSchema, hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { bestUnderwriting } from "@/lib/best-underwriting";
import { computePropertyInsights } from "@/lib/property-insights";
import { PROPERTY_TYPE_LABELS } from "@/lib/property-labels";
import { formatMoney, formatSignedMonthly } from "@/lib/format";
import { project, toIncomeInput, toPropertyInput } from "@/osprey/engine";
import { ReportSchema } from "@/osprey/reports/generate";

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md";

// Unlisted, not unindexed by default — the privacy policy (§10) promises
// search engines are asked not to index share links, so every /r/[token]
// page opts out regardless of whether the token resolves.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Public, read-only property report — the brokerage-ICP demo feature. No
 *  auth, no scenario studio, no actions: a realtor forwards this link as-is. */
export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!hasDb()) {
    return (
      <Shell>
        <div className={cardClass}>
          <p className="text-sm font-medium text-white">This link isn&apos;t available</p>
        </div>
      </Shell>
    );
  }

  // Unlike every other DB entry point, this page is reachable with zero prior
  // authenticated traffic (public link, fresh deploy) — ensure tables exist.
  await ensureSchema();

  const store = new PgStore();
  const shareLink = await store.loadShareLink(token);

  if (!shareLink || shareLink.revoked) {
    return (
      <Shell>
        <div className={cardClass}>
          <p className="text-sm font-medium text-white">Link not found</p>
          <p className="mt-2 text-sm text-white/60">
            This share link has been revoked or never existed.
          </p>
        </div>
      </Shell>
    );
  }

  const [owner, verdict, snapshot, reportRow, events] = await Promise.all([
    store.loadProfile(shareLink.userId),
    store.loadVerdictForListing(shareLink.userId, shareLink.listingId),
    store.loadSnapshot(shareLink.listingId),
    store.getReport(shareLink.userId, shareLink.listingId),
    store.loadEventsForListing(shareLink.listingId),
  ]);

  const property = snapshot ? toPropertyInput(snapshot.listing) : null;
  const income = snapshot?.rent ? toIncomeInput(snapshot.rent) : null;
  const underwriting = property && income && owner ? bestUnderwriting(property, income, owner) : null;
  const projection = underwriting ? project(underwriting, 30) : null;
  // Max offer is included here too, unlike a seller-facing listing site — the
  // audience is the owner's client-investor (a realtor forwarding their own
  // analysis), not the seller on the other side of the negotiation.
  const insights =
    property && income && underwriting && owner
      ? computePropertyInsights({
          property,
          income,
          uw: underwriting,
          bar: owner.minMonthlyCashFlow,
          bedrooms: snapshot?.listing.bedrooms,
          rawComparables: snapshot?.rent?.comparables,
        })
      : null;

  const address =
    snapshot?.listing.formattedAddress ?? snapshot?.listing.addressLine1 ?? verdict?.address ?? "Property";
  const price = snapshot?.listing.price ?? verdict?.price;
  const propertyTypeLabel = underwriting ? PROPERTY_TYPE_LABELS[underwriting.property.propertyType] : null;
  const ownerName = owner?.name ?? "an Osprey investor";

  let report = null;
  if (reportRow?.status === "ready" && reportRow.report) {
    const parsed = ReportSchema.safeParse(reportRow.report);
    if (parsed.success) report = parsed.data;
  }

  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{address}</h1>
        <p className="mt-1 text-sm text-white/60">
          {price != null && formatMoney(price)}
          {propertyTypeLabel && ` · ${propertyTypeLabel}`}
          {snapshot?.listing.bedrooms != null && ` · ${snapshot.listing.bedrooms} bd`}
          {snapshot?.listing.bathrooms != null && ` / ${snapshot.listing.bathrooms} ba`}
          {snapshot?.listing.squareFootage != null &&
            ` · ${snapshot.listing.squareFootage.toLocaleString()} sqft`}
        </p>
        {underwriting && (
          <span
            className={
              underwriting.monthlyCashFlow >= 0
                ? "mt-3 inline-block rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-2 text-sm font-medium text-emerald-400"
                : "mt-3 inline-block rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/60"
            }
          >
            {formatSignedMonthly(underwriting.monthlyCashFlow)} at {underwriting.loan.label}
          </span>
        )}
        <p className="mt-3 text-xs text-white/40">
          Prepared by {ownerName} · Powered by Osprey
        </p>
      </div>

      <PriceHistory events={events} />

      {income && underwriting && projection && insights && owner ? (
        <>
          <MaxOfferCard
            maxOffer={insights.maxOffer}
            clearingRate={insights.clearingRate}
            profileRate={underwriting.loan.rate}
            bar={owner.minMonthlyCashFlow}
            daysOnMarket={snapshot?.listing.daysOnMarket}
          />
          <RentConfidence rent={income.rent} stress={insights.stress} />
          <RentComps comparables={insights.comparables} />
          {insights.section8 && snapshot && snapshot.listing.bedrooms != null && (
            <Section8Card
              section8={insights.section8}
              bedrooms={snapshot.listing.bedrooms}
              avmRent={income.rent.monthlyRent}
            />
          )}
          <UnderwritingBreakdown uw={underwriting} />
          <ProjectionTable projection={projection} />
        </>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
          <p className="text-sm text-white/60">
            {verdict?.analysis ?? "No underwriting data is available for this property yet."}
          </p>
        </div>
      )}

      {report && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
          <h2 className="text-sm font-medium text-white">AI research report</h2>
          <div className="mt-4 flex flex-col gap-5">
            <h3 className="text-base font-medium text-white">{report.headline}</h3>
            {(
              [
                report.summary,
                report.dealNumbers,
                report.rentComps,
                report.neighborhood,
                report.marketTrends,
                report.risks,
                report.negotiationAngles,
                report.bottomLine,
              ] as const
            ).map((section, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-violet-200">{section.title}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-white/70">
                  {section.body}
                </p>
                {section.bullets && section.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1.5 text-sm text-white/60">
                    {section.bullets.map((b, j) => (
                      <li key={j} className="flex gap-2.5">
                        <span aria-hidden className="text-violet-300">
                          —
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <LegalDisclaimer />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Osprey
        </Link>
      </nav>
      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-16 sm:px-10">
        {children}
      </section>
      <footer className="relative z-10 border-t border-white/10 px-6 py-6 text-center text-xs text-white/40 sm:px-10">
        Want deal verdicts like this for your own buy box?{" "}
        <Link href="/" className="text-violet-300 hover:text-violet-200">
          Get Osprey →
        </Link>
      </footer>
    </main>
  );
}
