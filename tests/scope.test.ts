// Ship gate #1 — the authorization matrix.
//
// resolveScope() is the single decision point for every cross-user access in
// the product. The lookup is injected here so the DECISION logic is tested
// exhaustively without Postgres; the query itself is a three-condition WHERE
// exercised against the Neon branch.
//
// The cases that matter are the refusals. A passing "agent reaches own client"
// test proves the feature works; the rest prove it cannot be abused.

import { describe, it, expect, vi } from "vitest";
import { resolveScope, systemSubject, type ScopeDeps } from "@/lib/scope";
import { ScopedStore, ScopeWriteError } from "@/lib/scoped-store";

const AGENT_A = "11111111-1111-1111-1111-111111111111";
const AGENT_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_OF_A = "33333333-3333-3333-3333-333333333333";
const SOLO = "44444444-4444-4444-4444-444444444444";
const GHOST = "99999999-9999-9999-9999-999999999999";

/** Every viewer here is a normal active account unless a test says otherwise. */
const activeViewer = async () => ({ status: "active" });

/** Only AGENT_A -> CLIENT_OF_A is an active roster row. The client is still
 *  agent-managed (has not claimed their account). */
const roster: ScopeDeps = {
  loadViewerStatus: activeViewer,
  loadClientLink: async (agentId, clientId) =>
    agentId === AGENT_A && clientId === CLIENT_OF_A ? { clientStatus: "managed" } : null,
};

/** Nobody is linked — stands in for an archived/disconnected relationship. */
const noRoster: ScopeDeps = {
  loadViewerStatus: activeViewer,
  loadClientLink: async () => null,
};

/** The client has CLAIMED their account: they own their data now. */
const claimedClient: ScopeDeps = {
  loadViewerStatus: activeViewer,
  loadClientLink: async (agentId, clientId) =>
    agentId === AGENT_A && clientId === CLIENT_OF_A ? { clientStatus: "active" } : null,
};

describe("resolveScope — self", () => {
  it("grants self scope when no subject is requested", async () => {
    const scope = await resolveScope(SOLO, undefined, noRoster);
    expect(scope).toMatchObject({ viewerId: SOLO, relation: "self", canEdit: true });
    expect(scope?.subjectId).toBe(SOLO);
  });

  it("treats an explicit own id as self, without a roster lookup", async () => {
    const loadClientLink = vi.fn(noRoster.loadClientLink);
    const scope = await resolveScope(SOLO, SOLO, { ...noRoster, loadClientLink });
    expect(scope?.relation).toBe("self");
    expect(loadClientLink).not.toHaveBeenCalled();
  });

  it("refuses an empty viewer id", async () => {
    expect(await resolveScope("", undefined, roster)).toBeNull();
    expect(await resolveScope("", CLIENT_OF_A, roster)).toBeNull();
  });

  it("does not infer a subject from a null or empty string", async () => {
    for (const bad of [null, "", undefined]) {
      const scope = await resolveScope(SOLO, bad, noRoster);
      expect(scope?.relation).toBe("self");
      expect(scope?.subjectId).toBe(SOLO);
    }
  });
});

describe("resolveScope — the authorization matrix", () => {
  it("ALLOWS an agent reaching their own client", async () => {
    const scope = await resolveScope(AGENT_A, CLIENT_OF_A, roster);
    expect(scope).toMatchObject({
      viewerId: AGENT_A,
      relation: "agent_of_client",
      canEdit: true,
    });
    expect(scope?.subjectId).toBe(CLIENT_OF_A);
  });

  it("REFUSES an agent reaching another agent's client", async () => {
    expect(await resolveScope(AGENT_B, CLIENT_OF_A, roster)).toBeNull();
  });

  it("REFUSES a plain investor reaching anyone else", async () => {
    expect(await resolveScope(SOLO, CLIENT_OF_A, roster)).toBeNull();
    expect(await resolveScope(SOLO, AGENT_A, roster)).toBeNull();
  });

  it("REFUSES a client reaching their own agent (not symmetric)", async () => {
    expect(await resolveScope(CLIENT_OF_A, AGENT_A, roster)).toBeNull();
  });

  it("REFUSES once the relationship is archived", async () => {
    // noRoster models archived_at IS NOT NULL — the row exists but no longer
    // matches, so access stops immediately on disconnect.
    expect(await resolveScope(AGENT_A, CLIENT_OF_A, noRoster)).toBeNull();
  });

  it("REFUSES a forged / nonexistent subject id", async () => {
    expect(await resolveScope(AGENT_A, GHOST, roster)).toBeNull();
  });

  // Threat T4: a nonexistent id and a real-but-unauthorized id must be
  // indistinguishable, or the endpoint becomes a user-enumeration oracle.
  it("is indistinguishable between 'no such user' and 'not your client'", async () => {
    const ghost = await resolveScope(AGENT_B, GHOST, roster);
    const real = await resolveScope(AGENT_B, CLIENT_OF_A, roster);
    expect(ghost).toBeNull();
    expect(real).toBeNull();
    expect(ghost).toEqual(real);
  });

  // Found in end-to-end testing: a non-UUID id reached Postgres, which raised
  // on the cast and produced a 500 — making "malformed" distinguishable from
  // "not permitted", the exact split T4 forbids.
  it("REFUSES a malformed subject id without querying", async () => {
    const loadClientLink = vi.fn(roster.loadClientLink);
    for (const bad of ["not-a-uuid", "1; DROP TABLE users", "../../etc/passwd", "  "]) {
      expect(await resolveScope(AGENT_A, bad, { ...roster, loadClientLink })).toBeNull();
    }
    expect(loadClientLink).not.toHaveBeenCalled();
  });

  it("REFUSES a malformed viewer id", async () => {
    expect(await resolveScope("not-a-uuid", undefined, roster)).toBeNull();
  });

  it("never consults a role claim — only the roster decides", async () => {
    // An "agent" who is not on the roster for this client gets nothing, no
    // matter what a (stale, sign-in-snapshot) session role would say.
    expect(await resolveScope(AGENT_B, CLIENT_OF_A, noRoster)).toBeNull();
  });
});

// Sessions are JWTs and cannot be revoked server-side, so the viewer's account
// must be re-checked per request or a deleted/suspended user keeps full access
// until their token expires.
describe("resolveScope — viewer revocation", () => {
  const withViewer = (status: string | null, exists = true): ScopeDeps => ({
    loadViewerStatus: async () => (exists ? { status } : null),
    loadClientLink: roster.loadClientLink,
  });

  it("REFUSES a viewer whose account no longer exists", async () => {
    expect(await resolveScope(SOLO, undefined, withViewer(null, false))).toBeNull();
    expect(await resolveScope(AGENT_A, CLIENT_OF_A, withViewer(null, false))).toBeNull();
  });

  it("REFUSES a viewer converted to an agent-managed account", async () => {
    expect(await resolveScope(SOLO, undefined, withViewer("managed"))).toBeNull();
  });

  it("REFUSES any status outside the allowlist, including future ones", async () => {
    for (const status of ["invited", "suspended", "disabled", "manged"]) {
      expect(await resolveScope(SOLO, undefined, withViewer(status))).toBeNull();
    }
  });

  it("allows an active viewer, and a legacy row with no status", async () => {
    expect(await resolveScope(SOLO, undefined, withViewer("active"))).not.toBeNull();
    expect(await resolveScope(SOLO, undefined, withViewer(null))).not.toBeNull();
  });
});

// The commitment made on the claim-time consent screen: once a client claims
// their account they own their data, and the agent keeps READ access only.
describe("resolveScope — canEdit follows the client's claim status", () => {
  it("an agent may edit a still-managed client", async () => {
    const scope = await resolveScope(AGENT_A, CLIENT_OF_A, roster);
    expect(scope?.canEdit).toBe(true);
  });

  it("an agent drops to READ-ONLY once the client has claimed", async () => {
    const scope = await resolveScope(AGENT_A, CLIENT_OF_A, claimedClient);
    expect(scope).toMatchObject({ relation: "agent_of_client", canEdit: false });
  });

  it("self scope is always writable", async () => {
    const scope = await resolveScope(SOLO, undefined, claimedClient);
    expect(scope?.canEdit).toBe(true);
  });
});

describe("systemSubject", () => {
  it("passes the id through for trusted contexts", () => {
    expect(systemSubject(SOLO)).toBe(SOLO);
  });
});

describe("ScopedStore — the id cannot be supplied by the caller", () => {
  const scope = {
    viewerId: AGENT_A,
    subjectId: CLIENT_OF_A as never,
    relation: "agent_of_client" as const,
    canEdit: true,
  };

  it("passes the scope's subject to the underlying store, not any argument", async () => {
    const inner = {
      loadProfile: vi.fn().mockResolvedValue(null),
      loadVerdictForListing: vi.fn().mockResolvedValue(null),
    };
    const store = new ScopedStore(scope, inner as never);

    await store.loadProfile();
    await store.loadVerdictForListing("L1");

    expect(inner.loadProfile).toHaveBeenCalledWith(CLIENT_OF_A);
    expect(inner.loadVerdictForListing).toHaveBeenCalledWith(CLIENT_OF_A, "L1");
  });

  // Rate limits bound paid LLM spend, so they must follow the ACTOR. Counting
  // the subject would give an agent one budget per client.
  it("counts report usage against the viewer, not the subject", async () => {
    const inner = { countReportsSince: vi.fn().mockResolvedValue(0) };
    const store = new ScopedStore(scope, inner as never);
    const since = new Date("2026-07-01T00:00:00Z");

    await store.countReportsSince(since);

    expect(inner.countReportsSince).toHaveBeenCalledWith(AGENT_A, since);
  });

  it("forces a saved profile's id to the authorized subject", async () => {
    const inner = {
      saveProfileSettings: vi.fn().mockResolvedValue(undefined),
      // An agent-scoped write re-reads the stored profile to restore the
      // redacted fields — see the redaction suite below.
      loadProfile: vi.fn().mockResolvedValue(null),
    };
    const store = new ScopedStore(scope, inner as never);

    // A tampered payload claiming to be someone else must not redirect the write.
    await store.saveProfileSettings({ id: GHOST, name: "x" } as never);

    expect(inner.saveProfileSettings).toHaveBeenCalledWith(
      expect.objectContaining({ id: CLIENT_OF_A }),
    );
  });

  it("refuses writes on a read-only scope but still allows reads", async () => {
    const inner = {
      loadProfile: vi.fn().mockResolvedValue(null),
      createShareLink: vi.fn(),
      saveProfileSettings: vi.fn(),
      markReportFailed: vi.fn(),
    };
    const readOnly = new ScopedStore({ ...scope, canEdit: false }, inner as never);

    await expect(readOnly.loadProfile()).resolves.toBeNull();
    // Rejections, not synchronous throws — a route using .catch() must still
    // see the refusal rather than an unhandled exception.
    await expect(readOnly.createShareLink("L1")).rejects.toThrow(ScopeWriteError);
    await expect(
      readOnly.saveProfileSettings({ id: CLIENT_OF_A } as never),
    ).rejects.toThrow(ScopeWriteError);
    await expect(readOnly.markReportFailed("L1")).rejects.toThrow(ScopeWriteError);
    expect(inner.createShareLink).not.toHaveBeenCalled();
  });
});

// docs/PRIVACY-TOS-AGENT-DRAFT.md §A1-A2. The consent screen promises a
// specific list of what an agent can see. These tests are what make that list
// exhaustive rather than aspirational: the client detail page does not render
// either field today, so nothing else would catch a regression that started
// exposing them.
describe("ScopedStore — an agent cannot read the client's private notes", () => {
  const agentScope = {
    viewerId: AGENT_A,
    subjectId: CLIENT_OF_A as never,
    relation: "agent_of_client" as const,
    canEdit: true,
  };

  const selfScope = {
    viewerId: CLIENT_OF_A,
    subjectId: CLIENT_OF_A as never,
    relation: "self" as const,
    canEdit: true,
  };

  const storedProfile = {
    id: CLIENT_OF_A,
    name: "Client",
    telegramChatId: 4242,
    tasteNotes: ["Passed on 1905 Caviar Dr: too close to the freeway"],
    minMonthlyCashFlow: 200,
  };

  it("strips tasteNotes and telegramChatId from an agent's read", async () => {
    const inner = { loadProfile: vi.fn().mockResolvedValue({ ...storedProfile }) };
    const profile = await new ScopedStore(agentScope, inner as never).loadProfile();

    expect(profile).not.toHaveProperty("tasteNotes");
    expect(profile).not.toHaveProperty("telegramChatId");
    // The rest of the profile is untouched — this is a redaction, not a
    // different object.
    expect(profile).toMatchObject({ id: CLIENT_OF_A, minMonthlyCashFlow: 200 });
  });

  it("leaves the client's own read intact", async () => {
    const inner = { loadProfile: vi.fn().mockResolvedValue({ ...storedProfile }) };
    const profile = await new ScopedStore(selfScope, inner as never).loadProfile();

    expect(profile).toMatchObject({ telegramChatId: 4242, tasteNotes: storedProfile.tasteNotes });
  });

  it("returns null without touching the redaction path", async () => {
    const inner = { loadProfile: vi.fn().mockResolvedValue(null) };
    await expect(new ScopedStore(agentScope, inner as never).loadProfile()).resolves.toBeNull();
  });

  // The sharp edge the redaction itself creates: the agent's write-back carries
  // no tasteNotes, because we removed them on the way out.
  it("restores tasteNotes on an agent write instead of blanking them", async () => {
    const inner = {
      loadProfile: vi.fn().mockResolvedValue({ ...storedProfile }),
      saveProfileSettings: vi.fn().mockResolvedValue(undefined),
    };
    const store = new ScopedStore(agentScope, inner as never);

    const asTheAgentSawIt = await store.loadProfile();
    await store.saveProfileSettings({ ...asTheAgentSawIt!, minMonthlyCashFlow: 500 });

    expect(inner.saveProfileSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CLIENT_OF_A,
        minMonthlyCashFlow: 500,
        tasteNotes: storedProfile.tasteNotes,
      }),
    );
  });

  it("does not re-read storage on a self write", async () => {
    const inner = {
      loadProfile: vi.fn().mockResolvedValue({ ...storedProfile }),
      saveProfileSettings: vi.fn().mockResolvedValue(undefined),
    };
    await new ScopedStore(selfScope, inner as never).saveProfileSettings({
      ...storedProfile,
    } as never);

    expect(inner.loadProfile).not.toHaveBeenCalled();
  });
});
