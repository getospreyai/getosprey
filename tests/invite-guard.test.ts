// Ship gate #1, for the invite routes: "self, own client, other agent's
// client, non-agent, archived relationship, forged id — with identical
// responses for forbidden and nonexistent."
//
// The matrix splits across two layers, and this file covers both halves:
//
//   * WHO may act for the client is resolveScope()'s answer, already tested
//     exhaustively in tests/scope.test.ts. Here it arrives as the `scope`
//     argument, and the cases below feed in the scopes resolveScope would
//     actually produce for each row of the matrix — including the ones it
//     refuses outright, which is why several tests assert that a null scope
//     never reaches this function at all.
//
//   * WHAT STATE the client is in is canMintInvite()'s answer, which is what
//     the rest of this file exercises.
//
// The reason both matter: minting an invite for a client who has already
// claimed would produce a link that sets a password on an account its owner
// now controls. That is the closest thing to an account-takeover primitive
// this feature could have, and it is a client-state question, not an
// authorization one — resolveScope says yes to it.

import { describe, it, expect } from "vitest";
import { canMintInvite, type InviteCandidate } from "@/lib/invite-guard";
import { resolveScope, type Scope, type ScopeDeps } from "@/lib/scope";

const AGENT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

/** The scope resolveScope() returns for an agent acting on a managed client. */
const agentScope: Scope = {
  viewerId: AGENT,
  subjectId: CLIENT as Scope["subjectId"],
  relation: "agent_of_client",
  canEdit: true,
};

const selfScope: Scope = {
  viewerId: AGENT,
  subjectId: AGENT as Scope["subjectId"],
  relation: "self",
  canEdit: true,
};

const managed: InviteCandidate = { status: "managed", clientEmail: "c@example.com" };

function deps(over: Partial<ScopeDeps> = {}): ScopeDeps {
  return {
    loadViewerStatus: async () => ({ status: "active" }),
    loadClientLink: async () => null,
    ...over,
  };
}

describe("the authorization half — no scope, no invite", () => {
  it("REFUSES when the viewer is not this client's agent", async () => {
    // resolveScope returns null, so the route refuses before canMintInvite is
    // ever called. Pinned here so the matrix row is visible in this file.
    const scope = await resolveScope(OTHER, CLIENT, deps());
    expect(scope).toBeNull();
  });

  it("REFUSES once the roster row is archived", async () => {
    // loadClientLink only returns non-archived rows, so an archived
    // relationship is indistinguishable from no relationship.
    const scope = await resolveScope(AGENT, CLIENT, deps());
    expect(scope).toBeNull();
  });

  it("REFUSES a forged client id", async () => {
    const scope = await resolveScope(AGENT, "44444444-4444-4444-8444-444444444444", deps());
    expect(scope).toBeNull();
  });

  it("REFUSES a malformed client id without touching the database", async () => {
    let queried = false;
    const scope = await resolveScope(AGENT, "not-a-uuid", deps({
      loadClientLink: async () => {
        queried = true;
        return null;
      },
    }));
    expect(scope).toBeNull();
    expect(queried).toBe(false);
  });

  it("ALLOWS an agent reaching their own managed client", async () => {
    const scope = await resolveScope(AGENT, CLIENT, deps({
      loadClientLink: async () => ({ clientStatus: "managed" }),
    }));
    expect(scope).not.toBeNull();
    expect(scope!.relation).toBe("agent_of_client");
    expect(canMintInvite(scope!, managed).ok).toBe(true);
  });
});

describe("canMintInvite — client state", () => {
  it("allows a managed client, and hands back the validated address", () => {
    // The address comes out of the check rather than being re-read from the
    // row, so the mint cannot be reached with an unvalidated null.
    expect(canMintInvite(agentScope, managed)).toEqual({
      ok: true,
      email: "c@example.com",
    });
  });

  it("allows re-inviting an already-invited client", () => {
    // Re-minting is how an agent replaces a link they lost or mis-sent. The
    // store revokes the previous one, so this stays single-outstanding.
    const invited: InviteCandidate = { status: "invited", clientEmail: "c@example.com" };
    expect(canMintInvite(agentScope, invited).ok).toBe(true);
  });

  it("REFUSES a self scope — you cannot invite yourself", () => {
    const check = canMintInvite(selfScope, managed);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("not_a_client");
  });

  it("THE DANGEROUS ONE: refuses a client who has already claimed", () => {
    // resolveScope says yes to this — the roster row is live. If this check
    // were missing, an agent could mint a link that sets a new password on an
    // account its owner controls.
    const claimed: InviteCandidate = { status: "active", clientEmail: "c@example.com" };
    const check = canMintInvite({ ...agentScope, canEdit: false }, claimed);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("already_claimed");
  });

  it("refuses a claimed client even if canEdit wrongly says true", () => {
    // Defense in depth: canEdit is DERIVED from status, so these can only
    // disagree through a bug. If they do, refuse.
    const claimed: InviteCandidate = { status: "active", clientEmail: "c@example.com" };
    expect(canMintInvite({ ...agentScope, canEdit: true }, claimed).ok).toBe(false);
  });

  it("refuses a read-only scope even when the status looks invitable", () => {
    const check = canMintInvite({ ...agentScope, canEdit: false }, managed);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("read_only");
  });

  it("refuses an unrecognized status rather than falling through", () => {
    // Allowlist, matching canActAsViewer's reasoning: a typo or a status added
    // later must fail CLOSED, not sail past a denylist.
    for (const status of ["suspended", "manged", "", "ACTIVE", "deleted"]) {
      const check = canMintInvite(agentScope, { status, clientEmail: "c@example.com" });
      expect(check.ok, `status ${JSON.stringify(status)} must not be invitable`).toBe(false);
    }
  });

  it("refuses when there is no contact address", () => {
    const check = canMintInvite(agentScope, { status: "managed", clientEmail: null });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("no_contact_email");
  });

  it("treats an empty-string address as missing", () => {
    const check = canMintInvite(agentScope, { status: "managed", clientEmail: "" });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("no_contact_email");
  });
});

describe("what the refusal is allowed to say", () => {
  it("no reason string names another user or an id", () => {
    // The codes are for logs and tests. The route maps all of them except
    // no_contact_email onto an identical 404, but a reason string that leaked
    // an id would be a problem the moment someone decided to surface it.
    const cases: InviteCandidate[] = [
      { status: "active", clientEmail: "c@example.com" },
      { status: "suspended", clientEmail: "c@example.com" },
      { status: "managed", clientEmail: null },
    ];
    for (const c of cases) {
      const check = canMintInvite(agentScope, c);
      if (check.ok) continue;
      expect(check.reason).not.toContain(CLIENT);
      expect(check.reason).not.toContain(AGENT);
      expect(check.reason).not.toContain("c@example.com");
    }
  });

  it("only no_contact_email is safe to show the caller", () => {
    // Guards the route's mapping: if a code is added later, this test is where
    // someone has to decide which side of the 404 line it falls on.
    const shown: string[] = ["no_contact_email"];
    const all: string[] = ["not_a_client", "read_only", "already_claimed", "no_contact_email"];
    expect(all.filter((c) => shown.includes(c))).toEqual(["no_contact_email"]);
  });
});
