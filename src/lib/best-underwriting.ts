// Shared "default view" selection for property pages: underwrite at every one
// of the investor's financing profiles and keep the best cash flow — the same
// selection src/osprey/agent/loop.ts makes during a scan, so the page a user
// lands on matches the verdict that alerted them.

import { underwrite } from "@/osprey/engine";
import type { FinancingProfile, IncomeInput, PropertyInput, Underwriting } from "@/osprey/engine";
import type { InvestorProfile } from "@/osprey/agent/model";

export function bestUnderwriting(
  property: PropertyInput,
  income: IncomeInput,
  profile: Pick<InvestorProfile, "financingProfiles" | "assumptions">,
): Underwriting | null {
  let best: Underwriting | null = null;
  for (const financing of profile.financingProfiles as FinancingProfile[]) {
    const uw = underwrite({ property, income, financing, assumptions: profile.assumptions });
    if (!best || uw.monthlyCashFlow > best.monthlyCashFlow) best = uw;
  }
  return best;
}
