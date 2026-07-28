// Mint and revoke a client's invite link.
//
// This is the first route in the product that takes a clientId AND writes, so
// it is worth being explicit about what is doing the authorization here:
// nothing in this file. `resolveRequestScope(clientId)` re-reads agent_clients
// on every request and returns `forbidden` for "not your client", "no such
// user", and "your own account was revoked" alike. There is no `isMyClient()`
// helper, no role check, and no branch on session.user.role — scattering those
// across routes is how IDOR holes happen (docs/AGENT-ACCOUNTS-PLAN.md §4).
//
// Every refusal below is a 404 with the same body. A 403-vs-404 split would
// turn this route into a way to enumerate which user ids exist (threat T4).
//
// The response contains the only copy of the token that will ever exist. The
// database stores sha256(token), so a lost link is re-minted, not recovered.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { mintInviteToken } from "@/lib/invite-token";
import { canMintInvite } from "@/lib/invite-guard";
import { PgStore } from "@/osprey/pg-store";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

/** One body for every refusal, so nothing about the reason leaks. */
function refuse() {
  return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  if (!agentAccountsEnabled()) return refuse();

  const { clientId } = await params;
  const scoped = await resolveRequestScope(clientId);

  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Invites are temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    // 'unauthenticated' and 'forbidden' answer identically. A signed-out
    // caller learns nothing a signed-in stranger would not.
    return refuse();
  }

  const store = new PgStore();
  const clients = await store.listAgentClients(scoped.userId);
  const client = clients.find((c) => c.clientUserId === clientId);

  // resolveScope already proved the relationship; this is for the row's own
  // fields, which the scope does not carry.
  if (!client) return refuse();

  const check = canMintInvite(scoped.scope, client);
  if (!check.ok) {
    // Every refusal is a flat 404. The code is logged, never returned: a caller
    // that can tell "already claimed" from "not your client" can enumerate both.
    console.warn("Invite refused:", {
      code: check.code,
      agentUserId: scoped.userId,
      clientId,
    });
    return refuse();
  }

  const minted = mintInviteToken();

  try {
    // No recipient. This is a referral link, and Osprey never learns who the
    // agent hands it to — that is what lets us say we store nothing about a
    // person until they create their own account.
    await store.mintInvite({
      agentUserId: scoped.userId,
      clientUserId: clientId,
      tokenHash: minted.tokenHash,
      expiresAt: minted.expiresAt,
    });
  } catch (err) {
    console.error("Mint invite failed:", err);
    return NextResponse.json(
      { error: "Couldn't create that invite. Please try again." },
      { status: 500, ...NO_STORE },
    );
  }

  // Absolute, because the agent pastes this into a text message — unlike the
  // share-link route, which returns a relative path for a link rendered in
  // place. Built from the request origin rather than an env var so preview
  // deployments produce links that actually work.
  return NextResponse.json(
    {
      url: `${req.nextUrl.origin}/claim/${minted.token}`,
      expiresAt: minted.expiresAt.toISOString(),
    },
    NO_STORE,
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  if (!agentAccountsEnabled()) return refuse();

  const { clientId } = await params;
  const scoped = await resolveRequestScope(clientId);

  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Invites are temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return refuse();
  }

  if (scoped.scope.relation !== "agent_of_client") return refuse();

  // Deliberately NOT gated on canEdit. Revoking is the safe direction: an
  // agent who realises they sent a link to the wrong number must be able to
  // kill it even in states where they may no longer edit the client. The store
  // method only ever revokes outstanding invites and only reverts a status
  // that is still 'invited', so this cannot disturb a claimed account.
  try {
    await new PgStore().revokeInvite(clientId);
  } catch (err) {
    console.error("Revoke invite failed:", err);
    return NextResponse.json(
      { error: "Couldn't revoke that invite. Please try again." },
      { status: 500, ...NO_STORE },
    );
  }

  return NextResponse.json({ ok: true }, NO_STORE);
}
