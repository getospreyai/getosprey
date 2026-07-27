// Ship gate #5, as a test.
//
// docs/AGENT-ACCOUNTS-PLAN.md §9a: "Phase 2 does not ship without the reviewed
// privacy/ToS update and a recorded consent step."
//
// A gate written only in a planning document is a gate that gets forgotten at
// 6pm on a Friday by whoever is flipping env vars. This file is the version
// that cannot be forgotten: the moment OSPREY_AGENT_ACCOUNTS is set to "true"
// anywhere the suite runs, these tests start failing and keep failing until
// the reviewed legal copy actually exists.
//
// While the flag is off (today, and for the whole of this branch) they pass,
// so the gate does not block development — only the ship.

import { describe, it, expect } from "vitest";
import {
  AGENT_ACCESS_DISCLOSURE,
  EFFECTIVE_DATE,
  POLICY_VERSION,
  policyVersionIsReviewed,
} from "@/lib/legal";
import { agentAccountsEnabled } from "@/lib/features";

describe("ship gate #5 — the flag cannot be on without reviewed legal copy", () => {
  it("refuses to have agent accounts enabled while POLICY_VERSION is provisional", () => {
    if (agentAccountsEnabled()) {
      expect(
        policyVersionIsReviewed(),
        [
          "OSPREY_AGENT_ACCOUNTS is 'true' but POLICY_VERSION is still PROVISIONAL.",
          "",
          "Ship gate #5 (docs/AGENT-ACCOUNTS-PLAN.md §9a) is not met: the Privacy",
          "Policy and ToS have no agent-relationship section, so a consent record",
          "written now would point at text that does not describe what was",
          "consented to.",
          "",
          "Land the reviewed copy, set POLICY_VERSION and EFFECTIVE_DATE to the new",
          "effective date in src/lib/legal.ts, then enable the flag.",
        ].join("\n"),
      ).toBe(true);
    } else {
      // The flag is off, which is the state this branch ships in.
      expect(agentAccountsEnabled()).toBe(false);
    }
  });

  it("POLICY_VERSION and EFFECTIVE_DATE agree once the copy has landed", () => {
    // Before review they are deliberately different (PROVISIONAL vs the old
    // July 21 date). After review they must be the same string, or a consent
    // row records a version no page displays.
    if (policyVersionIsReviewed()) {
      expect(POLICY_VERSION).toBe(EFFECTIVE_DATE);
    } else {
      expect(POLICY_VERSION).toBe("PROVISIONAL");
    }
  });
});

describe("the disclosure recorded at claim time", () => {
  it("names every category of data the agent gains access to", () => {
    // Kept in step with ScopedStore's read surface. If a method is added there
    // that exposes something new, this list is the thing that has to change
    // too — and a reviewer seeing this test fail is the point.
    for (const phrase of [
      "buy box",
      "financing",
      "cash-flow",
      "underwrites",
      "reports",
    ]) {
      expect(AGENT_ACCESS_DISCLOSURE.toLowerCase()).toContain(phrase);
    }
  });

  it("states the limits, not just the grants", () => {
    const lower = AGENT_ACCESS_DISCLOSURE.toLowerCase();
    expect(lower).toContain("cannot change your email or password");
    expect(lower).toContain("cannot delete your account");
    expect(lower).toContain("other osprey user");
  });

  it("tells the client how to get out", () => {
    // §3b lists self-serve disconnect as a right we honor. A consent screen
    // that grants access without naming the exit is not informed consent.
    expect(AGENT_ACCESS_DISCLOSURE.toLowerCase()).toContain("disconnect");
    expect(AGENT_ACCESS_DISCLOSURE.toLowerCase()).toContain("settings");
  });

  it("is substantial enough to be a real disclosure", () => {
    // Guards against someone reducing this to "your agent can see your data"
    // while the consent plumbing keeps happily recording it.
    expect(AGENT_ACCESS_DISCLOSURE.length).toBeGreaterThan(400);
  });
});
