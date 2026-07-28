"use client";

// Role and status controls for one row of the operator user list.
//
// Two things this component deliberately does NOT do:
//
// 1. It does not decide who may act. The buttons are rendered for every row
//    the page rendered, and the routes re-check `requireAdmin()` on every
//    request. Hiding a button is a UI courtesy, never a control.
//
// 2. It does not hide the self-action case. `isSelf` disables the buttons and
//    says why, because a control that silently vanishes reads as a bug — but
//    the actual guard is in the SQL WHERE clause, so a request forged past this
//    component still changes nothing.
//
// Suspension asks for confirmation. It revokes the target's live session on
// their next request, which is not something to do on a stray click.

import { useState } from "react";
import { useRouter } from "next/navigation";

const btn =
  "rounded-lg border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40";
const neutral = `${btn} border-white/15 bg-white/[0.06] text-white/70 hover:bg-white/[0.1]`;
const danger = `${btn} border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`;

export default function AdminUserActions({
  userId,
  role,
  status,
  isSelf,
}: {
  userId: string;
  role: string;
  status: string;
  /** True when this row is the signed-in operator's own account. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(path: string, body: Record<string, string>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError("");

    const res = await fetch(`/api/admin/users/${userId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;

    if (!res || !res.ok) {
      setError((data as { error?: string } | null)?.error ?? "That didn't work. Try again.");
      setBusy(false);
      return;
    }

    setBusy(false);
    // The page is force-dynamic, so this re-reads the row from the database
    // rather than patching local state — the table then shows what is actually
    // stored, not what we hoped we stored.
    router.refresh();
  }

  // Agent-managed clients ('managed' / 'invited') are excluded: they already
  // cannot sign in, and overwriting their status would destroy the lifecycle
  // state agent accounts uses to know what the row is. The route refuses this
  // too; the UI just does not offer it.
  const suspendable = status === "active" || status === "suspended";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {role === "agent" ? (
          <button
            className={neutral}
            disabled={busy || isSelf}
            onClick={() => act("role", { role: "investor" })}
          >
            Demote
          </button>
        ) : (
          <button
            className={neutral}
            disabled={busy || isSelf}
            onClick={() => act("role", { role: "agent" })}
          >
            Make agent
          </button>
        )}

        {suspendable &&
          (status === "suspended" ? (
            <button
              className={neutral}
              disabled={busy || isSelf}
              onClick={() => act("status", { status: "active" })}
            >
              Reactivate
            </button>
          ) : (
            <button
              className={danger}
              disabled={busy || isSelf}
              onClick={() =>
                act(
                  "status",
                  { status: "suspended" },
                  "Suspend this account? They will be signed out on their next request and cannot sign back in until reactivated.",
                )
              }
            >
              Suspend
            </button>
          ))}
      </div>

      {isSelf && <p className="text-[11px] text-white/30">Your own account</p>}
      {error && <p className="max-w-[16rem] text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}
