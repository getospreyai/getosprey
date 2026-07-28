"use client";

// "Your agent" in Settings: who can see this account, and the way out.
//
// This card is the standing version of the consent screen. The claim page told
// the client what their agent can see at the moment they agreed; this tells
// them the same thing every time they look at their settings, because consent
// that is only visible once is consent you have to remember rather than
// consent you can check.
//
// The disconnect is behind a confirm step. Not because it is dangerous — it is
// the safe direction, and reversible by re-inviting — but because a client who
// clicks it by accident and silently loses their agent's help would have no
// idea what happened.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AgentAccessCard({
  agentName,
  setUpByAgent,
}: {
  agentName: string;
  setUpByAgent: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function disconnect() {
    setBusy(true);
    setError("");

    const res = await fetch("/api/account/disconnect-agent", { method: "POST" }).catch(
      () => null,
    );

    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      setError(
        (data as { error?: string } | null)?.error ??
          "Couldn't disconnect right now. Please try again.",
      );
      setBusy(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-base font-medium">Your agent</h2>
      <p className="mt-1.5 text-sm text-white/60">
        <span className="text-white/85">{agentName}</span> can see this account.
        {setUpByAgent && " They set up your original buy box."}
      </p>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-medium text-white/70">What they can see</p>
        <p className="mt-1.5 text-xs leading-5 text-white/50">
          Your buy box, financing assumptions, minimum cash-flow target, every listing
          Osprey underwrites for you, and any property reports on your account.
        </p>
        <p className="mt-3 text-xs font-medium text-white/70">What they cannot do</p>
        <p className="mt-1.5 text-xs leading-5 text-white/50">
          Change your email or password, delete your account, see your login history, or
          see anything about any other Osprey user.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 text-sm text-white/50 underline decoration-white/20 underline-offset-4 transition hover:text-white/80"
        >
          Disconnect from {agentName}
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-4">
          <p className="text-sm text-amber-100">
            Disconnect from {agentName}?
          </p>
          <p className="mt-1.5 text-xs leading-5 text-amber-100/70">
            They lose access to your buy box and feed immediately. Your account, buy box,
            and history stay exactly as they are — nothing of yours is deleted.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="rounded-lg bg-rose-500/90 px-4 py-2 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-40"
            >
              {busy ? "Disconnecting…" : "Yes, disconnect"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg border border-white/15 px-4 py-2 text-xs text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
            >
              Keep my agent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
