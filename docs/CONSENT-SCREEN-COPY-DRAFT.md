# Consent screen copy — WORKING DRAFT (2026-07-27)

**Not final copy. For legal review.** I am not a lawyer and this is not legal
advice.

This is the "recorded consent step" half of ship gate #5
(`docs/AGENT-ACCOUNTS-PLAN.md` §9a), and §3b's requirement that it be "a screen
naming exactly what the agent can see, not buried in ToS."

## Why the wording matters more than usual here

The text on this screen is not just shown — it is **stored verbatim**, per
claim, in `client_consents.disclosure` (`src/osprey/pg-store.ts` `claimInvite`).
It is the permanent record of what the person agreed to. So:

- It has to be **true on the day it is shown**, and it has to keep being true, or
  the stored records become false statements we made at scale.
- It cannot be materially longer than someone will read, or it becomes the thing
  it was written to avoid.
- Every claim in it is checked by `tests/policy-version.test.ts`, which asserts
  the disclosure names each data category, states the limits, and names the exit.
  Rewording without updating those assertions fails the build, deliberately.

Current implementation: `src/lib/legal.ts` `AGENT_ACCESS_DISCLOSURE`, rendered by
`src/app/claim/[token]/page.tsx`, with a separate shorter checkbox label in
`src/components/ClaimForm.tsx`.

## The accuracy problem to resolve before review

The draft below is written against the code **as it stands**, which means the
bracketed `[A1/A2]` line is currently *true*: an agent can read notes derived
from the client's Telegram conversation and the client's Telegram chat id
(`ScopedStore.loadProfile()` returns the whole profile). See
`PRIVACY-TOS-AGENT-DRAFT.md` §A1-A2.

I recommend fixing that rather than disclosing it. If it is fixed, delete the
bracketed line. **Do not send this to a reviewer with the line still bracketed** —
it changes what they are approving.

---

## Draft 1 — the disclosure block

Rendered above the form on `/claim/[token]`, in full, not collapsed and not
behind a link.

> ### Before you claim this account
>
> **{Agent name} set this account up for you.** Claiming it means they keep
> access to it. Here is exactly what that means.
>
> **They will be able to see**
> - The markets, property types, and price range you're searching
> - Your financing assumptions — down payment, interest rate, loan terms
> - Your minimum monthly cash-flow target
> - Every listing Osprey underwrites for you, and the numbers it calculates
> - Any property reports or share links on your account
> `[A1/A2 — include ONLY if not fixed: - Notes about deals you've passed on,`
> `including reasons you gave our Telegram bot]`
>
> **They will not be able to**
> - Change your email address or your password
> - Delete your account
> - See when or how you sign in
> - See anything about any other Osprey user
>
> **You stay in control**
> - After you claim it, you own this account. Your agent's access becomes
>   read-only.
> - You can disconnect them at any time in Settings. Their access ends
>   immediately and nothing of yours is deleted.
> - If you change your search to a market your agent doesn't cover, we'll
>   disconnect them automatically and tell you.
>
> `[DECISION-3 — one line, replacing this:]`
> `[3a] Reports your agent already generated stay available to them after you`
> `disconnect.`
> `[3b] Reports your agent generated stop being available to them when you`
> `disconnect.`
> `[3c] Reports and share links your agent generated stop working when you`
> `disconnect.`

### Notes on choices in the draft

- **Second person throughout, agent named explicitly.** "Dana Whitfield set this
  account up for you" is harder to skim past than "your agent."
- **"They will not be able to" is not filler.** Every line in it is enforced in
  code and asserted in tests, and a consent screen that only grants without
  bounding reads as a warning rather than a disclosure. If any of those four
  lines stops being true, the copy has to change the same day.
- **Bulleted, not prose.** §3b asks for a screen naming *exactly* what is
  visible; a paragraph invites skimming, and this is the one screen where
  skimming is the failure mode.
- **The disconnect promise appears before the checkbox, not after.** Someone
  deciding whether to agree needs to know the exit exists while deciding.

---

## Draft 2 — the checkbox label

Deliberately shorter than the block above, and deliberately not a summary of it —
it names the three things that most change the person's situation.

> I understand that {Agent name} will be able to see my buy box, financing
> assumptions, and the listings Osprey underwrites for me, and that I can
> disconnect them at any time in Settings.

Current implementation hardcodes "my agent" rather than the name
(`src/components/ClaimForm.tsx`); interpolating the name is a small change and
worth making if the reviewer agrees.

The checkbox starts unchecked and the submit button is disabled until it is
ticked. The server independently requires `consent === true` — not truthy — so a
client that sent a default-checked value would still be refused
(`src/app/api/claim/route.ts`).

---

## Draft 3 — the standing version in Settings

`src/components/AgentAccessCard.tsx`. Consent shown once is consent the person
has to remember; this is the version they can go back and check.

**It must not drift from Draft 1.** If the claim screen and the settings card
disagree about what an agent can see, the stored consent records are evidence of
the wrong one. Recommend both render from the same constant in
`src/lib/legal.ts` rather than being maintained separately — currently the card
has its own hand-written copy, which is exactly how drift starts.

> ### Your agent
> **{Agent name}** can see this account. {They set up your original buy box.}
>
> **What they can see** — your buy box, financing assumptions, minimum
> cash-flow target, every listing Osprey underwrites for you, and any property
> reports on your account.
>
> **What they cannot do** — change your email or password, delete your account,
> see your sign-in history, or see anything about any other Osprey user.
>
> [Disconnect from {Agent name}]

Confirm step, on click:

> **Disconnect from {Agent name}?**
> They lose access to your buy box and feed immediately. Your account, buy box,
> and history stay exactly as they are — nothing of yours is deleted.
> `[DECISION-3: 3b/3c add — Reports they generated for you will no longer be`
> `available to them.]`
> [Yes, disconnect] [Keep my agent]

---

## Draft 4 — the automatic disconnect notice

Shown in Settings after a buy-box change moves the account outside the agent's
farm (`src/lib/farm-enforcement.ts` `disconnectNotice`, rendered by
`src/components/SettingsForm.tsx`). Not consent — a notification — but it is the
one place a client is told something happened without them asking for it, so it
belongs in the same review.

Current text:

> **Your agent was disconnected**
> That market is outside {Agent name}'s coverage area, so they've been
> disconnected from your account. Your buy box, feed, and history are unchanged —
> {Agent name} can no longer see them.

Reviewer question: does this need to say the change *can be undone* by the agent
re-inviting? It can, but saying so may read as "we can put this back" in a way
that overstates how easy it is for the client.

---

## Draft 5 — the dead-link page

`src/app/claim/[token]/page.tsx`, shown for expired, revoked, already-used,
malformed, and never-existed links alike. It says nothing about which, and names
nobody — deliberately, so the page cannot be used to test which links or accounts
exist (threat T4).

> ### This link isn't valid
> Invite links expire, and each one can only be used once. Ask the agent who sent
> it to you for a new link.

Included here so a reviewer does not "improve" it into something more helpful and
specific. The vagueness is the feature.

---

## Open questions for the reviewer

1. Is a checkbox plus a named disclosure sufficient for the financial-data
   sharing described, or is something stronger wanted (typed confirmation,
   re-entry of the agent's name)?
2. Should the consent screen state a retention period for what the agent has
   already seen? Nothing is currently promised.
3. `[A1/A2]` — fix or disclose. See `PRIVACY-TOS-AGENT-DRAFT.md` §A1.
4. Should the stored `disclosure` include the checkbox label as well as the
   block? Today only `AGENT_ACCESS_DISCLOSURE` is stored, so the record does not
   capture the exact sentence next to the checkbox they ticked.
