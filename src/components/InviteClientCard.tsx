"use client";

// Mint an invite link and hand it to the agent to deliver themselves.
//
// Osprey sends no email, by design (AGENT-ACCOUNTS-PLAN.md §9): the agent
// forwards the link through whatever channel they already use with that
// client. That removes CAN-SPAM/TCPA surface, deliverability, an email vendor,
// and the invite-spam vector, and means we never contact someone who has never
// heard of us. So this card's job is simply to produce a link and make it easy
// to copy.
//
// The link is shown ONCE. The database stores only sha256(token), so it cannot
// be re-displayed later — re-minting is the recovery path, and it revokes the
// previous link. The UI says so rather than letting the agent discover it.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteClientCard({
  clientId,
  clientName,
  clientEmail,
  status,
}: {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  status: string;
}) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function mint() {
    setBusy(true);
    setError("");
    setCopied(false);

    const res = await fetch(`/api/clients/${clientId}/invite`, { method: "POST" }).catch(
      () => null,
    );
    const data = res ? await res.json().catch(() => null) : null;

    if (!res || !res.ok) {
      setError(
        (data as { error?: string } | null)?.error ??
          "Couldn't create that invite. Please try again.",
      );
      setBusy(false);
      return;
    }

    const payload = data as { url: string; expiresAt: string };
    setLink(payload.url);
    setExpiresAt(payload.expiresAt);
    setBusy(false);
    router.refresh();
  }

  async function revoke() {
    setBusy(true);
    setError("");

    const res = await fetch(`/api/clients/${clientId}/invite`, { method: "DELETE" }).catch(
      () => null,
    );

    if (!res || !res.ok) {
      setError("Couldn't revoke that invite. Please try again.");
      setBusy(false);
      return;
    }

    setLink("");
    setExpiresAt("");
    setBusy(false);
    router.refresh();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the link is selectable on screen, so
      // this is a convenience failing, not the feature failing.
      setError("Couldn't copy automatically — select the link and copy it.");
    }
  }

  if (status === "active") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
        <h2 className="text-base font-medium">Account claimed</h2>
        <p className="mt-1.5 text-sm text-white/55">
          {clientName} controls this account. You have read access to their buy box and
          feed, and they can disconnect at any time.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-base font-medium">Invite {clientName}</h2>
      <p className="mt-1.5 text-sm text-white/55">
        {clientEmail
          ? `Create a link and send it to ${clientEmail} yourself — by text, email, or in person. Osprey never contacts your clients directly.`
          : "Add this client's email address before inviting them — the invite is addressed to it."}
      </p>

      {status === "invited" && !link && (
        <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-xs text-amber-200">
          An invite is already outstanding. Links can only be shown once, so if you no
          longer have it, create a new one — that replaces the old link.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {link && (
        <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-4">
          <p className="text-xs font-medium text-emerald-100">
            Copy this now — it won&apos;t be shown again
          </p>
          <p className="mt-2 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-emerald-100/90">
            {link}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copy}
              className="rounded-lg bg-emerald-500/90 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-500"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            {expiresAt && (
              <span className="text-xs text-emerald-100/60">
                Expires {new Date(expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={mint}
          disabled={busy || !clientEmail}
          className="glow-cta rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working…" : status === "invited" ? "Create a new link" : "Create invite link"}
        </button>
        {status === "invited" && (
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            Revoke invite
          </button>
        )}
      </div>
    </div>
  );
}
