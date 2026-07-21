// Deterministic PDF renderer for a structured property report (no LLM). Turns
// the cached report JSON into a branded, client-forwardable one-pager+ using
// pdf-lib. Osprey wordmark, violet accent, address header, sections, footer.
// Layout primitives live in ./pdf-kit (shared with reports/packet.ts).

import type { PropertyReport } from "./generate";
import {
  createPdfCursor,
  deMarkdown,
  draw,
  footerOnEveryPage,
  gap,
  masthead,
  sectionHeading,
  INK,
  MUTED,
} from "./pdf-kit";
import { DISCLAIMER_SHORT } from "@/lib/legal";

export interface ReportPdfMeta {
  /** Property address for the header. */
  address: string;
  /** Owner/agent name for the footer attribution. */
  preparedBy: string;
}

export async function reportToPdf(
  report: PropertyReport,
  meta: ReportPdfMeta,
): Promise<Uint8Array> {
  const c = await createPdfCursor();

  masthead(c, "Property Research Report");

  // Address + headline.
  draw(c, meta.address, c.bold, 15, INK, 1.3);
  gap(c, 4);
  draw(c, report.headline, c.font, 12, MUTED, 1.35);
  gap(c, 14);

  const section = (heading: string, s: PropertyReport["summary"]) => {
    sectionHeading(c, s.title || heading);
    if (s.body.trim()) draw(c, deMarkdown(s.body), c.font, 10.5, INK, 1.4);
    if (s.bullets?.length) {
      gap(c, 3);
      for (const b of s.bullets) draw(c, `• ${deMarkdown(b)}`, c.font, 10.5, INK, 1.35, 8);
    }
    gap(c, 12);
  };

  section("Summary", report.summary);
  section("Deal Numbers", report.dealNumbers);
  section("Rent Comparables", report.rentComps);
  section("Neighborhood", report.neighborhood);
  section("Market Trends", report.marketTrends);
  section("Risks", report.risks);
  section("Negotiation Angles", report.negotiationAngles);
  section("Bottom Line", report.bottomLine);

  footerOnEveryPage(c, [`Prepared by ${meta.preparedBy} with Osprey · getosprey.ai`, DISCLAIMER_SHORT]);

  return c.doc.save();
}
