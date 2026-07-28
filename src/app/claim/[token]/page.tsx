// The public claim landing page.
//
// THIS ROUTE IS UNAUTHENTICATED AND MUST STAY THAT WAY. The people it exists
// for do not have accounts yet — that is the entire point. Concretely: do NOT
// add "/claim/:path*" to the matcher in src/proxy.ts. Every path listed there
// is redirected to /login when there is no session, which would make the link
// unusable for exactly its intended audience.
//
// Two render states and no third:
//
//   valid   -> the consent disclosure plus the claim form
//   invalid -> ONE dead-link message, identical for expired, revoked, already
//              accepted, malformed, and never-existed
//
// Nothing about the client is rendered before the token is confirmed valid,
// and the invalid state names nothing at all. A page that said "this invite
// for dylan@example.com has expired" would be an oracle for both live tokens
// and the addresses behind them (docs/AGENT-ACCOUNTS-PLAN.md §3a T4).

import Link from "next/link";
import { notFound } from "next/navigation";
import Backdrop from "@/components/Backdrop";
import ClaimForm from "@/components/ClaimForm";
import { agentAccountsEnabled } from "@/lib/features";
import { hasDb } from "@/lib/db";
import { AGENT_ACCESS_DISCLOSURE, policyVersionIsReviewed } from "@/lib/legal";
import { hashInviteToken, looksLikeInviteToken } from "@/lib/invite-token";
import { PgStore } from "@/osprey/pg-store";

export const metadata = {
  title: "Claim your Osprey account",
  // An invite URL in a search index would be a live credential in a search
  // index. Belt and braces alongside the token's expiry.
  robots: { index: false, follow: false, nocache: true },
};

// The token makes every request unique and the answer depends on database
// state that changes underneath it. Never cache this.
export const dynamic = "force-dynamic";

const cardClass =
  "rounded-2xl border border-white/10 bg-white/[0.05] p-8 backdrop-blur-md";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />
      <section className="relative z-10 mx-auto w-full max-w-lg px-6 py-20">
        {children}
      </section>
    </main>
  );
}

/** The single dead-link state. Says nothing about which failure occurred, and
 *  nothing about who the invite was for. */
function DeadLink() {
  return (
    <Shell>
      <div className={cardClass}>
        <h1 className="text-xl font-semibold tracking-tight">This link isn&apos;t valid</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Invite links expire, and each one can only be used once. Ask the agent who
          sent it to you for a new link.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-white/50 underline decoration-white/20 underline-offset-4 transition hover:text-white/80"
        >
          Go to Osprey
        </Link>
      </div>
    </Shell>
  );
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!agentAccountsEnabled()) notFound();

  // Ship gate #5. The API refuses too; this keeps someone from filling in a
  // form that cannot possibly succeed.
  if (!policyVersionIsReviewed()) return <DeadLink />;
  if (!hasDb()) return <DeadLink />;

  const { token } = await params;

  // Shape check first — a malformed token never reaches the database, and
  // lands on the same page as every other failure.
  if (!looksLikeInviteToken(token)) return <DeadLink />;

  const invite = await new PgStore().loadInviteForClaim(hashInviteToken(token));
  if (!invite) return <DeadLink />;

  return (
    <Shell>
      <div className={cardClass}>
        <p className="text-xs uppercase tracking-wider text-white/40">Osprey</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {invite.agentName} set up an account for you
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Your buy box is already configured. Set a password to take it over — after
          that, you control it.
        </p>

        {/* The consent disclosure, shown in full above the form rather than
            linked or collapsed. §3b: "a screen naming exactly what the agent
            can see, not buried in ToS." The exact text rendered here is what
            gets written to client_consents.disclosure. */}
        <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-5">
          <h2 className="text-sm font-medium text-amber-100">
            Before you claim this account
          </h2>
          {AGENT_ACCESS_DISCLOSURE.split("\n\n").map((para) => (
            <p key={para.slice(0, 32)} className="mt-3 text-xs leading-5 text-amber-100/80">
              {para}
            </p>
          ))}
        </div>

        <ClaimForm token={token} />

        <p className="mt-6 text-xs leading-5 text-white/35">
          By claiming this account you agree to Osprey&apos;s{" "}
          <Link href="/terms" className="underline decoration-white/20 hover:text-white/60">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline decoration-white/20 hover:text-white/60">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </Shell>
  );
}
