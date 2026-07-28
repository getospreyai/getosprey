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

  it("claims the Telegram redaction that ScopedStore actually performs", () => {
    // Paired with the redaction suite in tests/scope.test.ts: that one proves
    // loadProfile() strips tasteNotes and telegramChatId for an agent scope,
    // this one proves we told the client so. Deleting either without the other
    // leaves a promise with no enforcement, or an enforcement nobody was told
    // about. See docs/PRIVACY-TOS-AGENT-DRAFT.md §A1-A2.
    expect(AGENT_ACCESS_DISCLOSURE.toLowerCase()).toContain("telegram");
  });

  it("states the referral promise: nothing was held before the claim", () => {
    // The whole point of the referral model (2026-07-27) is that Osprey holds
    // nothing about a person until they claim an account themselves. That claim
    // is only true while agent_clients.client_email and client_invites.email do
    // not exist — which scripts/verify-schema.mjs FORBIDS. This test and that
    // check are the two halves: one asserts we say it, the other asserts it is
    // true of the database.
    const lower = AGENT_ACCESS_DISCLOSURE.toLowerCase();
    expect(lower).toContain("has never held your name or your email address");
    expect(lower).toContain("was not told who your agent sent this link to");
  });

  it("says what happens to reports and share links on disconnect", () => {
    // DECISION-3. The client is told the asymmetry up front rather than
    // discovering it when a link they forwarded stops resolving.
    const lower = AGENT_ACCESS_DISCLOSURE.toLowerCase();
    expect(lower).toContain("reports your agent already generated stay");
    expect(lower).toContain("share links on your account stop working");
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
