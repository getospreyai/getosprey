# Privacy Policy + ToS — agent relationships (WORKING DRAFT, 2026-07-27)

**This is not final copy and must not ship as-is.** It is a working draft for a
lawyer to review, revise, and sign off. I am not a lawyer and this is not legal
advice.

It exists because ship gate #5 (`docs/AGENT-ACCOUNTS-PLAN.md` §9a) blocks Phase 2
on "the reviewed privacy/ToS update and a recorded consent step," and the
reviewer needs something accurate to react to rather than a blank page.

**Everything below was written by reading the implementation on the
`phase2-invites` branch, not by describing what the feature is supposed to do.**
Where the code does something the plan did not anticipate, that is called out in
§A rather than smoothed over. Current effective date on both documents:
**July 21, 2026** (`src/lib/legal.ts` `EFFECTIVE_DATE`). Neither document
currently contains the word "agent."

## Status — ready for review as of 2026-07-27

Every bracket that made an earlier version of this document unreviewable is now
resolved. Concretely, since the first draft:

- **A1, A2, A4 and A6 were fixed in code, not disclosed** (`ea7affd`). §A keeps
  each finding, marked FIXED, because a reviewer needs to know the obligation
  was considered and how it was discharged — and because a future change that
  reintroduces one needs to find the reasoning.
- **Decision #3 answered** (Dylan, 2026-07-27): the agent's reports survive a
  disconnect; the client's share links are revoked. Implemented in
  `PgStore.disconnectAgent`. The copy in §B3 and §B4 reflects it.
- **A5 and A7 remain open** and are genuinely questions for counsel rather than
  engineering — see §D.

## How to use this

1. §A is the findings register: what the code actually does, including four
   things that were never part of the plan. Read it before the copy, so the copy
   reads as claims you can check.
2. §B and §C are the draft copy, written against the code as it stands today.
3. §D is what still needs a lawyer's answer. §E is the code work that lands with
   the reviewed copy.

---

## §A. Findings from the code that we have not discussed

Ordered by how much they change the picture. Each names the file that creates
the obligation.

### A1. An agent can read notes derived from the client's private Telegram messages — **FIXED**

**`src/lib/scoped-store.ts:56` — `loadProfile()` returns the whole
`InvestorProfile`, which includes `tasteNotes`.**

`tasteNotes` are written by `src/osprey/agent/messenger/actions.ts:59-62` from
what the client types to the bot:

```ts
tasteNotes: [
  ...(profile.tasteNotes ?? []),
  deal ? `Passed on ${deal.address}: ${intent.reason}` : `Pass note: ${intent.reason}`,
]
```

`intent.reason` is the client's own words. So an agent with a live roster row can
read text derived verbatim from a private chat between the client and Osprey.

This is the most significant finding here, for three reasons: the client
reasonably believes the bot conversation is between them and Osprey; Privacy
Policy §2 currently describes message content as processed "in order to respond
to them," which does not cover onward disclosure to an agent; and it is not
mentioned in the consent disclosure I drafted (`src/lib/legal.ts`
`AGENT_ACCESS_DISCLOSURE`) or shown anywhere in the agent UI.

Note the asymmetry: the client detail page
(`src/app/clients/[clientId]/page.tsx`) does **not** render `tasteNotes`. The
*authorization layer* permits it, the *UI* does not use it. Privacy obligations
attach to what is permitted, because the UI is one commit away from changing.

**Fixed in `ea7affd`.** `ScopedStore.loadProfile()` strips `tasteNotes` and
`telegramChatId` when `relation === "agent_of_client"`, and the agent's
write-back path restores `tasteNotes` from storage first — otherwise the
redaction would silently blank a field the agent was never shown. Four tests in
`tests/scope.test.ts`. No disclosure is needed, and B2 came back out.

### A2. An agent can read the client's Telegram chat identifier — **FIXED**

Same call, same object: `InvestorProfile.telegramChatId`
(`src/osprey/agent/model.ts:34`). A durable personal identifier for a
third-party messaging account. Not shown in the UI either.

**Fixed in `ea7affd`, alongside A1.** Same redaction, same tests.

### A3. An agent can enumerate the client's share-link tokens, and that read survives claiming

`ScopedStore.listShareLinks()` (`src/lib/scoped-store.ts:129`) has no
`assertWritable()` guard, so it stays readable after the client claims and the
agent drops to read-only. `PgStore.listShareLinks` (`src/osprey/pg-store.ts:1026`)
selects `token`.

Share tokens are unauthenticated public URLs (`/r/[token]`). An agent can
therefore copy a claimed client's live tokens, and anything copied keeps working
after the relationship ends, because `resolveScope` cannot reach into a URL
someone already has.

This is not a bug — an agent forwarding a client's property analysis is the
product working — but it is precisely the input to **decision #3**, and it made
"do share links survive a disconnect" a sharper question than it first looked:
any token the agent copied survives regardless of what we do to the roster,
unless we revoke the tokens themselves.

**That is why decision #3 revokes them.** `disconnectAgent()` now sets
`revoked = true` on every one of the client's share links, which is the only
action that reaches a URL somebody already holds. Note the scope: *all* the
client's links, including ones they created themselves, because `share_links`
does not record who minted a token. §B3 says so plainly rather than implying a
narrower revocation than we actually perform.

### A4. The share page names the CLIENT, not the agent — **FIXED**

`src/app/r/[token]/page.tsx:100`:

```ts
const ownerName = owner?.name ?? "an Osprey investor";
```

`owner` is the profile owner — the client. `AGENT-ACCOUNTS-PLAN.md` §8 says the
preparer shown on `/r/[token]` "should be the **agent**, since they are the one
forwarding it." That was never implemented.

So an agent forwarding a client's share link discloses **the client's name** to
whoever receives it. The client is not told this at any point.

**Fixed in `ea7affd`.** The byline now reads
`agent?.agentName ?? owner?.name ?? "an Osprey investor"`. A solo investor is
both the owner and the preparer, so their share pages are unchanged — the
earlier worry that this altered existing users' links was wrong; the fallback
covers them exactly as before. Disclosed in §B4 as well, since the client should
know their agent is named rather than them.

### A5. We collect personal data about people who are not users and have not consented

`agent_clients.client_email` (`db/schema.sql:190`) and `client_invites.email`
hold a real person's email address, supplied by their agent, before that person
has any relationship with Osprey. A managed client also has a `users` row with
their real **name** (`PgStore.createManagedClient`), plus financing assumptions
and a buy box describing their financial position.

Privacy Policy §2 describes categories we collect **from you**. There is no
category for "information an agent gives us about their client." Under NRS
603A.340(1)(a) the notice has to state the categories of covered information
collected about consumers — not only about account holders.

The plan's §3b argument is that this is defensible without consent, because the
agent already held the information and is entering it about their own client. I
think that holds. But "defensible to collect" and "not required to disclose" are
different questions, and the second one needs its own answer.

There is also a related product gap worth naming: **a managed client who never
claims is never told Osprey holds their data.** No notice is ever sent — by
design, since Osprey contacts nobody (§9). Whether that is acceptable is a
question for counsel, not for me.

### A6. Deleting a user destroys the consent record — **FIXED**

`client_consents.user_id ... ON DELETE CASCADE` (`db/schema.sql`). Deleting an
account erases the evidence that consent was ever obtained.

That is arguably correct on erasure grounds and wrong on evidentiary grounds —
the table exists to answer "what did they agree to, and when," and after a
deletion it cannot. Both positions are defensible; the point is that it is
currently decided by a foreign key rather than by anyone.

**Fixed in `ea7affd`:** `ON DELETE SET NULL` on **both** `user_id` and
`agent_user_id` — an agent deleting their account would otherwise destroy their
clients' consent records too, which is the same failure from the other side.
`policy_version`, `disclosure`, and `created_at` survive as an anonymous record
that *a* consent occurred. `scripts/verify-schema.mjs` now checks the delete rule
itself, not just nullability: a nullable column with a CASCADE fk still deletes
the row, so the weaker check would have passed while the property was gone.

The retention justification is drafted in §B5. **This is the one §A fix that a
reviewer might want reversed** — it trades a small retention of anonymized data
against the ability to answer "did they consent?" after deletion. Flagged in §D3.

### A7. Invite rows are retained indefinitely

`client_invites` rows are never deleted — accepted, revoked, and expired rows all
persist, each holding an email address. `PHASE-2-INVITES-PLAN.md` §4.3
deliberately declined to add a cleanup job. Retention copy has to cover this, or
we need the job.

### A8. The client's chosen sign-in email is not visible to the agent

Not a gap — recorded because it is a claim the copy makes and it is worth knowing
it is true. At claim time `users.email` becomes whatever the client chose
(`PgStore.claimInvite`), while `agent_clients.client_email` keeps the original
address the agent supplied. The agent roster reads the latter
(`listAgentClients`). So if the client claims with a different address, the agent
does not see it.

---

## §B. Privacy Policy — draft changes

### B1. §2 "Information we collect" — new category, insert after "Account information"

> **Information your real-estate agent provides about you.** If a real-estate
> agent or brokerage uses Osprey to manage client relationships, they may create
> an account on your behalf and enter information about you, including your
> name, an email address at which they can reach you, and the investment
> criteria they understand you to have — target markets, property types, price
> range, financing assumptions, and a minimum cash-flow target. We receive this
> information from the agent, not from you. We do not contact you about it; if
> your agent wants you to have access to the account, they send you an invitation
> link themselves.

*Basis: `PgStore.createManagedClient`, `agent_clients.client_email`,
`src/app/api/clients/route.ts`. See §A5.*

### B2. §2 "Messaging information" — **no change needed**

This section originally carried an amendment disclosing that notes derived from
a client's Telegram conversation were visible to their agent. **A1/A2 were fixed
instead** (`ea7affd`), so the existing sentence — "we process the content of the
messages you send to the bot in order to respond to them" — is accurate as
written and stands unamended. Nothing is disclosed here because nothing is
disclosed to the agent.

### B3. New §16 "If your account is connected to a real-estate agent"

Placed after §15 (Contact) and renumbered, or inserted before §13 and everything
after renumbered — reviewer's preference.

> **16. If your account is connected to a real-estate agent**
>
> Osprey can be used by real-estate agents to manage investment criteria for
> their clients. This section explains what that means for your information. It
> applies only if an agent set up your account or you accepted an invitation from
> one.
>
> **How the connection is made.** An agent can create an account for you and
> configure it on your behalf. An account in that state has no password and
> cannot be signed into. If your agent wants you to take control of it, they send
> you an invitation link directly — we never send it for them. When you use that
> link, you choose your own email address and password, you are shown exactly
> what your agent will be able to see, and you must affirmatively agree before
> the account becomes yours. We record that agreement, including the date and the
> exact text you were shown.
>
> **What your agent can see.** While you are connected to an agent, they can see
> your investment criteria, your financing assumptions, your minimum cash-flow
> target, every property Osprey underwrites for you and the figures it
> calculates, and any property reports or share links associated with your
> account. They cannot see the messages you exchange with our Telegram bot or
> any notes we record from them.
>
> **What your agent cannot do.** Your agent cannot change your email address or
> password, cannot delete your account, cannot see your sign-in history, and
> cannot see anything about any other Osprey user. If you set up Telegram
> alerts, those go to you.
>
> **Ending the connection.** You can disconnect from your agent at any time in
> Settings. Your agent's access ends immediately. Your account, criteria, and
> history are unaffected.
>
> Your connection may also end automatically: agents cover defined geographic
> markets, and if you change your criteria to target a market outside your
> agent's coverage area, we disconnect them and tell you we have done so.
>
> **What happens to reports and share links.** Any property reports your agent
> generated while connected remain available to them. A report is an analysis of
> a property rather than a record about you, and your agent may have relied on it
> in their own work. Any share links on your account, however, are deactivated
> when the connection ends — including ones you created yourself. A share link is
> a public web address that works for anyone who has it, so deactivating every
> link is the only way to be sure none of them keeps working. You can create new
> ones at any time.
>
> **If you never claim your account.** If your agent set up an account for you
> and you never accept an invitation, the account stays under your agent's
> management and cannot be signed into. You may contact us at privacy@getosprey.ai
> to ask what information we hold about you or to have it deleted.

*Basis: `src/lib/scope.ts` `resolveScope`, `src/lib/scoped-store.ts`,
`src/app/api/claim/route.ts`, `src/app/api/account/disconnect-agent/route.ts`,
`src/lib/farm-enforcement.ts`, `src/lib/auth-guard.ts`.*

### B4. §10 "Share links you create" — amend

> If your account is connected to an agent, share links created on your account
> are visible to your agent, and your agent can create share links on your
> account while they manage it. All of them are deactivated if the connection
> ends — see §16.
>
> Where an agent is connected to your account, a share link page names **your
> agent** as the person who prepared the analysis, not you.

### B5. §13 "Data retention" — amend

> Where an agent created an account for you, we retain the contact address they
> supplied and a record of the invitation for as long as the agent relationship
> exists, and afterwards as needed to show how the account was created. If you
> delete your account, we keep an anonymized record that a consent was given —
> the date, and the text you were shown — with your identifying information
> removed. We keep it because it is the only record of what you agreed to, and
> we cannot answer a question about that agreement without it.

*Basis: `client_consents` is `ON DELETE SET NULL` on both user references as of
`ea7affd`, and `scripts/verify-schema.mjs` asserts that. **Reviewer: this is the
A6 decision made in code — say so if you would rather it cascaded.** A7 also
lands here: `client_invites` rows are never deleted, so accepted, revoked, and
expired invitations all persist indefinitely, each holding the email address the
agent supplied. The first sentence above is what covers that; if the retention
period needs to be finite, we need a cleanup job, which does not exist.*

---

## §C. Terms of Service — draft changes

### C1. §5 "Your account" — append

> If a real-estate agent created your Osprey account, it is managed by them
> until you claim it. An unclaimed account cannot be signed into. Once you claim
> it by setting your own password, the account is yours: you are responsible for
> it on the same terms as any other account, and your agent keeps read-only
> access until you disconnect them.

### C2. New §18 "Agent and brokerage accounts"

> **18. Agent and brokerage accounts**
>
> If you use Osprey as a real-estate agent to manage clients:
>
> **You are responsible for your authority to do so.** You represent that you
> have a genuine professional relationship with each person you add as a client,
> and that you are entitled to hold and enter the information you provide about
> them. Do not add someone who is not your client.
>
> **You deliver invitations yourself.** Osprey does not contact your clients. You
> are responsible for how you send an invitation link and to whom. Do not send
> one to anyone who has not asked you to manage their property search.
>
> **Client accounts belong to the client.** Once a client claims their account
> it is theirs. Your access is read-only, they can end it at any time, and you
> may not attempt to retain access by any other means.
>
> **You cover defined markets.** Adding a client requires their criteria to sit
> within the markets you declare. If a client later moves outside them, your
> access to that client ends automatically.
>
> **Nothing here makes Osprey a party to your client relationship.** Osprey is
> an analysis tool. It is not a brokerage, is not your broker, and does not
> supervise your relationship with your clients. Sections 3 and 4 apply to your
> clients' use of the analyses exactly as they apply to yours.

*Basis: `src/lib/invite-guard.ts`, `src/lib/farm-markets.ts`,
`src/lib/farm-enforcement.ts`, `src/lib/scope.ts`. The last paragraph is my
attempt to keep the NRS 645 posture that ToS §3-4 already establishes —
definitely one for the reviewer.*

---

## §D. Questions for counsel

These are the questions engineering cannot answer. Everything else in this
document is either settled or a claim about the code you can check.

1. **Does a managed client who never claims need to be notified** that we hold
   their name, contact address, and financial criteria? We currently never
   contact them, by design — Osprey has no email provider and the agent delivers
   every invitation themselves. (§A5)
2. **Is the "agent already held this information" argument sufficient** for
   collection without consent, and does it survive us *storing* and *processing*
   it? (Plan §3b)
3. **Consent record vs. right to erasure.** We chose to keep an anonymized
   record after account deletion (§A6, implemented). Confirm or reverse — the
   reversal is a one-line schema change.
4. **Does anything here change the NRS 603A.340 operator notice analysis**, given
   the new category of data about non-users?
5. **Indefinite retention of invitation records** (§A7). `client_invites` rows,
   each holding an email address the agent supplied, are never deleted. §B5's
   first sentence is drafted to cover this. If a finite retention period is
   required instead, we need a cleanup job that does not exist today.

Answered since the first draft, recorded here so they are not re-opened:
**decision #3** (business call, made 2026-07-27 — reports stay, share links are
revoked) and **A1** (fixed rather than disclosed, so the onward-transfer question
no longer arises).

---

## §E. Changes required in code when this lands

- `src/lib/legal.ts`: `EFFECTIVE_DATE` and `POLICY_VERSION` both set to the new
  effective date. `tests/policy-version.test.ts` asserts they match once
  `POLICY_VERSION` stops reading `PROVISIONAL`.
- `src/lib/legal.ts`: `AGENT_ACCESS_DISCLOSURE` reworded to match §B3 section for
  section. `tests/policy-version.test.ts` asserts it names every data category,
  states the limits, and names the exit — update those assertions with the copy.
- `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`: the new sections.
- `src/components/ClaimForm.tsx` and `src/app/claim/[token]/page.tsx`: consent
  checkbox label and disclosure block — see `CONSENT-SCREEN-COPY-DRAFT.md`.
- `src/components/AgentAccessCard.tsx`: the standing "what they can see" copy in
  Settings, which must not drift from the claim-time text.

Already done, ahead of the copy (`ea7affd`), because none of it depended on the
wording:

- ~~A1/A2: `ScopedStore.loadProfile()` plus tests.~~
- ~~A4: `src/app/r/[token]/page.tsx`.~~
- ~~A6: `client_consents` delete rules + `verify-schema.mjs`.~~
- ~~Decision #3: share-link revocation in `PgStore.disconnectAgent`.~~

So when the reviewed copy lands, the remaining work is **only** copy: two
constants, two legal pages, and three components. That was the point of doing
the fixes first.
