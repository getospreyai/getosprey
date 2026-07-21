import type { ListingEventRow } from "@/osprey/pg-store";
import { formatMoney } from "@/lib/format";

/** Price-change timeline from listing_events. Renders nothing when empty —
 *  the price-cut re-underwrite path is dormant until RENTCAST_ENABLED, so
 *  most listings have no rows here yet. Pure display, server-safe. */
export default function PriceHistory({ events }: { events: ListingEventRow[] }) {
  const changes = events
    .filter(
      (e): e is ListingEventRow & { oldPrice: number; newPrice: number } =>
        e.kind === "price_change" && e.oldPrice != null && e.newPrice != null,
    )
    .slice()
    .reverse(); // loadEventsForListing is newest-first; walk chronologically

  if (changes.length === 0) return null;

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-sm font-medium text-white">Price history</h2>
      <p className="mt-3 text-sm leading-relaxed text-white/70">
        Listed {formatMoney(changes[0].oldPrice)}
        {changes.map((e) => {
          const pct = e.oldPrice > 0 ? ((e.newPrice - e.oldPrice) / e.oldPrice) * 100 : 0;
          return (
            <span key={e.id}>
              {" "}
              → {formatMoney(e.newPrice)} on {dateFmt(e.createdAt)} ({pct >= 0 ? "+" : ""}
              {pct.toFixed(1)}%)
            </span>
          );
        })}
      </p>
    </div>
  );
}
