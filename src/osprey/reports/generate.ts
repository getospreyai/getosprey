// AI research reports are paused pending re-enable — no backend generation
// lives here anymore. Kept: ReportSchema/PropertyReport, since the property
// and share pages still render a previously-generated report if one exists.
// Full generation implementation (Anthropic + web_search + structured
// output) is preserved in git history.

import { z } from "zod";

const ReportSection = z.object({
  title: z.string(),
  body: z.string(),
  bullets: z.array(z.string()).optional(),
});

export const ReportSchema = z.object({
  headline: z.string(),
  summary: ReportSection,
  dealNumbers: ReportSection,
  rentComps: ReportSection,
  neighborhood: ReportSection,
  marketTrends: ReportSection,
  risks: ReportSection,
  negotiationAngles: ReportSection,
  bottomLine: ReportSection,
});

export type PropertyReport = z.infer<typeof ReportSchema>;
