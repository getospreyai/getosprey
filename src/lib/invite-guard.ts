// Whether an invite may be minted, as a pure function.
//
// Extracted from the route for the same reason isScannable(), withinFarm(),
// and canAuthenticate() were extracted from theirs: a rule buried in a request
// handler can only be tested by standing up a request, so in practice it does
// not get tested at every branch. The authorization matrix required by ship
// gate #1 has to cover "agent A cannot invite agent B's client" — and that is
// a statement about this decision, not about HTTP.
//
// This does NOT decide whether the caller may act for the client at all.
// resolveScope() already did that, and its answer arrives here as the `scope`
// argument. Everything below is about the CLIENT's own state.

import type { Scope } from "@/lib/scope";

export type InviteBlockCode =
  | "not_a_client"
  | "read_only"
  | "already_claimed"
  | "no_contact_email";

export type InviteCheck =
  /** Carries the validated address so the caller cannot reach the mint with a
   *  null it has not checked — the type is the proof, not a `!` at the call
   *  site. Same idea as the branded SubjectId in src/lib/scope.ts. */
  | { ok: true; email: string }
  | { ok: false; code: InviteBlockCode; reason: string };

/** The client-row fields the decision needs. */
export interface InviteCandidate {
  /** 'managed' | 'invited' | 'active' */
  status: string;
  /** agent_clients.client_email — null until the agent supplies one. */
  clientEmail: string | null;
}

/**
 * Whether this agent may mint an invite for this client.
 *
 * The caller maps every `ok: false` except `no_contact_email` onto an
 * identical 404. The codes exist for the SERVER's logs and for tests, never
 * for the response body — a caller that can tell "already claimed" apart from
 * "not your client" can enumerate both (threat T4).
 *
 * `no_contact_email` is the one case that gets a real message, because it is
 * the agent's own missing data about their own client. It reveals nothing they
 * did not already have.
 */
export function canMintInvite(scope: Scope, client: InviteCandidate): InviteCheck {
  // Inviting yourself is not a thing. Beyond being meaningless, a self scope
  // reaching this code would mint a password-setting link for the agent's own
  // account — worth refusing explicitly rather than relying on later checks.
  if (scope.relation !== "agent_of_client") {
    return {
      ok: false,
      code: "not_a_client",
      reason: "Invites can only be minted for a client on your roster.",
    };
  }

  // A claimed client owns their account. Minting here would produce a link
  // that sets a password on an account its owner now controls — the closest
  // thing to an account-takeover primitive this feature could have.
  if (client.status === "active") {
    return {
      ok: false,
      code: "already_claimed",
      reason: "This client has already claimed their account.",
    };
  }

  // Redundant with the status check above, since resolveScope derives canEdit
  // from exactly that status. Kept because the two could drift, and if they
  // ever do, the safe direction is to refuse.
  if (!scope.canEdit) {
    return {
      ok: false,
      code: "read_only",
      reason: "You have read-only access to this client.",
    };
  }

  if (client.status !== "managed" && client.status !== "invited") {
    return {
      ok: false,
      code: "not_a_client",
      reason: "This client is not in a state that can be invited.",
    };
  }

  // An invite is addressed to a specific person. With no contact address there
  // is nothing to bind the token to and nothing to show the claimer.
  if (!client.clientEmail) {
    return {
      ok: false,
      code: "no_contact_email",
      reason:
        "Add this client's email address before inviting them — the invite is addressed to it.",
    };
  }

  return { ok: true, email: client.clientEmail };
}
