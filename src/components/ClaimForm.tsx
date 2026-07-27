"use client";

// The claim form. Deliberately small: the consent disclosure it sits under is
// rendered by the page (server-side), so the text that was actually shown is
// the text the server records — a client component could not be trusted to
// report that faithfully.
//
// The consent checkbox starts UNCHECKED and the submit button is disabled
// until it is ticked. A pre-checked box is not consent, and the server refuses
// anything but an explicit `consent: true` regardless.
//
// On success this redirects to /login rather than signing the user in. An
// unauthenticated endpoint should not mint a session, and someone who has just
// chosen a password should prove they can use it.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";

export default function ClaimForm({
  token,
  suggestedEmail,
}: {
  token: string;
  suggestedEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(suggestedEmail);
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, password, consent }),
    }).catch(() => null);

    if (!res) {
      setError("Something went wrong. Please try again.");
      setBusy(false);
      return;
    }

    const data = (await res.json().catch(() => null)) as { error?: string } | null;

    if (!res.ok) {
      // Whatever the server says, verbatim. It is deliberately generic about
      // anything to do with the invite — do not try to improve it here by
      // guessing at a more specific cause.
      setError(data?.error ?? "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }

    router.push("/login?claimed=1");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="claim-email" className="block text-sm text-white/70">
          Your email
        </label>
        <input
          id="claim-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`mt-1.5 ${fieldClass}`}
        />
        <p className="mt-1.5 text-xs text-white/35">
          This becomes your Osprey sign-in.
        </p>
      </div>

      <div>
        <label htmlFor="claim-password" className="block text-sm text-white/70">
          Choose a password
        </label>
        <input
          id="claim-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`mt-1.5 ${fieldClass}`}
        />
        <p className="mt-1.5 text-xs text-white/35">At least 8 characters.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
        />
        <span className="text-xs leading-5 text-white/70">
          I understand my agent will be able to see my buy box, financing assumptions,
          and the listings Osprey underwrites for me, and that I can disconnect at any
          time in Settings.
        </span>
      </label>

      {error && (
        <p className="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !consent}
        className="glow-cta w-full rounded-xl bg-indigo-500 px-5 py-3 text-sm font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Claiming…" : "Claim my account"}
      </button>
    </form>
  );
}
