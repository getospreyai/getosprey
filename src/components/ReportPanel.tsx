// AI research report section — paused for the MVP relaunch. Static teaser
// only: no generation, no polling, no fetch calls. Props kept compatible
// with the property page's call site; only listingId is actually used. Full
// interactive panel (generate/poll/regenerate/PDF link) is preserved in git
// history.

import type { PropertyReport } from "@/osprey/reports/generate";

export default function ReportPanel({
  listingId,
}: {
  listingId: string;
  initialStatus: "idle" | "generating" | "ready" | "failed";
  initialReport: PropertyReport | null;
  initialModel: string | null;
}) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md"
      data-listing-id={listingId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-white">AI research report</h2>
        <span
          aria-disabled="true"
          className="cursor-default select-none rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/50"
        >
          Coming soon
        </span>
      </div>
      <p className="mt-4 text-sm text-white/60">
        Comps, neighborhood trends, risks and negotiation angles — coming soon.
      </p>
    </div>
  );
}
