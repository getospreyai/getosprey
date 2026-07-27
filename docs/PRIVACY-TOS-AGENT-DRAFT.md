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

## How to use this

1. Read §A first. It contains findings from the code that were **not** part of
   any prior discussion, and four of them may change what the product does
   rather than only what the policy says. Some are cheap to fix and cheaper than
   disclosing.
2. §B and §C are the draft copy, written against the code as it stands today —
   including the things in §A. If §A items get fixed instead of disclosed, the
   corresponding copy comes back out.
3. `[DECISION-3]` marks every place the unanswered reports/share-links question
   leaves a hole. Do not let this draft be reviewed with those unresolved; a
   reviewer signing off on bracketed text is signing off on nothing.

---

## §A. Findings from the code that we have not discussed

Ordered by how much they change the picture. Each names the file that creates
the obligation.

### A1. An agent can read notes derived from the client's private Telegram messages

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

**Recommendation: fix rather than disclose.** Strip `tasteNotes` (and see A2)
from the profile an agent reads, in `ScopedStore.loadProfile()`, when
`relation === "agent_of_client"`. That is a few lines and one test, and it keeps
a promise worth keeping. Disclosing it instead means telling clients their
agent can read their chat notes — which I would expect to depress claim rates
more than the feature is worth.

### A2. An agent can read the client's Telegram chat identifier

Same call, same object: `InvestorProfile.telegramChatId`
(`src/osprey/agent/model.ts:34`). A durable personal identifier for a
third-party messaging account. Not shown in the UI either.

**Recommendation: strip alongside A1.** Same fix, same test.

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
product working — but it is precisely the input to **decision #3**, and it makes
"do share links survive a disconnect" a sharper question than it first looked:
the honest answer today is that any token the agent copied survives regardless
of what we do to the database, unless we revoke the tokens themselves.

### A4. The share page names the CLIENT, not the agent

`src/app/r/[token]/page.tsx:100`:

```ts
const ownerName = owner?.name ?? "an Osprey investor";
```

`owner` is the profile owner — the client. `AGENT-ACCOUNTS-PLAN.md` §8 says the
preparer shown on `/r/[token]` "should be the **agent**, since they are the one
forwarding it." That was never implemented.

So an agent forwarding a client's share link discloses **the client's name** to
whoever receives it. The client is not told this at any point.

**Recommendation: fix, and it is also what the plan already asked for.** Not
done on this branch because it changes behavior for existing solo users' share
links too, and deserves its own decision rather than being smuggled into a
policy commit.

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

### A6. Deleting a user destroys the consent record

`client_consents.user_id ... ON DELETE CASCADE` (`db/schema.sql`). Deleting an
account erases the evidence that consent was ever obtained.

That is arguably correct on erasure grounds and wrong on evidentiary grounds —
the table exists to answer "what did they agree to, and when," and after a
deletion it cannot. Both positions are defensible; the point is that it is
currently decided by a foreign key rather than by anyone.

**Options:** leave as-is (erasure wins); or `ON DELETE SET NULL` on `user_id`
plus retaining `policy_version`, `disclosure`, and `created_at` as an anonymous
record that *a* consent occurred. The second needs a retention justification in
§13.

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

### B2. §2 — amend "Messaging information"

`[DEPENDS ON A1/A2]` — **if we fix A1 and A2, this amendment is unnecessary** and
the existing text stands. If we disclose instead, the current sentence ("we
process the content of the messages you send to the bot in order to respond to
them") is insufficient and needs:

> …in order to respond to them. Where you record a preference in conversation —
> for example a reason for passing on a property — we store that as a note on
> your investor profile, and if your account is connected to a real-estate
> agent, that note is visible to them.

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
> account. `[IF A1/A2 NOT FIXED: add — and any preferences recorded from your
> conversations with our Telegram bot.]`
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
> `[DECISION-3 — one of the following must replace this paragraph:]`
> `[3a] Any property reports or share links your agent generated while connected`
> `remain available to them afterwards. Reports are analyses of properties`
> `rather than records about you, and your agent may have relied on them in`
> `their own work.`
> `[3b] When the connection ends, any property reports your agent generated for`
> `your account are no longer accessible to them.`
> `[3c] When the connection ends, any share links created on your account are`
> `deactivated, and any reports your agent generated are no longer accessible`
> `to them.`
>
> **If you never claim your account.** If your agent set up an account for you
> and you never accept an invitation, the account stays under your agent's
> management and cannot be signed into. You may contact us at privacy@getosprey.ai
> to ask what information we hold about you or to have it deleted.

*Basis: `src/lib/scope.ts` `resolveScope`, `src/lib/scoped-store.ts`,
`src/app/api/claim/route.ts`, `src/app/api/account/disconnect-agent/route.ts`,
`src/lib/farm-enforcement.ts`, `src/lib/auth-guard.ts`.*

### B4. §10 "Share links you create" — amend

> `[DECISION-3]` If your account is connected to an agent, share links created on
> your account are visible to your agent, and your agent can create share links
> on your account while they manage it.
>
> `[A4 — required only if A4 is NOT fixed:]` A share link page names the account
> the analysis belongs to. If your agent forwards a link from your account, the
> recipient sees your name.

### B5. §13 "Data retention" — amend

> Where an agent created an account for you, we retain the contact address they
> supplied and a record of the invitation for as long as the agent relationship
> exists, and afterwards as needed to show how the account was created. Records
> of consent you gave when claiming an account are retained
> `[A6: as long as your account exists / as an anonymized record after account
> deletion — pick one]`.

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

1. **Does a managed client who never claims need to be notified** that we hold
   their name, contact address, and financial criteria? We currently never
   contact them. (§A5)
2. **Is the "agent already held this information" argument sufficient** for
   collection without consent, and does it survive us *storing* and *processing*
   it? (Plan §3b)
3. **Consent record vs. right to erasure** — should consent rows survive account
   deletion in anonymized form? (§A6)
4. **Decision #3**, which is a business decision with a policy consequence, not
   the reverse.
5. **Does anything here change the NRS 603A.340 operator notice analysis**, given
   the new category of data about non-users?
6. **A1** — if we do not fix it, is disclosure alone enough for onward transfer
   of chat-derived notes to a third party?

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
- If A1/A2 are fixed: `ScopedStore.loadProfile()` plus a test.
- If A4 is fixed: `src/app/r/[token]/page.tsx`.
- If decision #3 is 3b or 3c: one statement added to `PgStore.disconnectAgent`.
