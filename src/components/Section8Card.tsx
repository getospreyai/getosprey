import type { Section8Standard } from "@/osprey/engine";
import { formatMoney } from "@/lib/format";

/** SNRHA Housing Choice Voucher payment-standard card — metro-wide (Clark
 *  County NV), not zip-specific (see engine/section8.ts), so the copy here
 *  deliberately says "metro" rather than naming a zip. Pure display,
 *  server-safe. */
export default function Section8Card({
  section8,
  bedrooms,
  avmRent,
}: {
  section8: Section8Standard;
  bedrooms: number;
  avmRent: number;
}) {
  const bedroomLabel = bedrooms <= 0 ? "Studio" : `${Math.round(bedrooms)}BR`;
  const delta = Math.round(section8.standard - avmRent);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-white">Section 8 payment standard</h2>
        <span className="text-lg font-semibold text-white">{formatMoney(section8.standard)}/mo</span>
      </div>
      <p className="mt-2 text-sm text-white/70">
        {bedroomLabel} payment standard (Las Vegas metro): {formatMoney(section8.standard)}/mo — the AVM
        rent is{" "}
        {delta > 0
          ? `${formatMoney(delta)} under it`
          : delta < 0
            ? `${formatMoney(-delta)} over it`
            : "right at it"}
        .
      </p>
      <p className="mt-2 text-xs text-white/50">{section8.label}</p>
    </div>
  );
}
