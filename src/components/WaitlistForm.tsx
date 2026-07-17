"use client";

import { useState, FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

export default function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setStatus("success");
      setName("");
      setEmail("");
      setPhone("");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-6 py-6 text-center backdrop-blur-md">
        <p className="text-lg font-medium text-white">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-white/60">
          We&apos;ll reach out the moment Osprey is ready for you.
        </p>
      </div>
    );
  }

  const fieldClass =
    "w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={fieldClass}
        />
        <input
          type="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={fieldClass}
        />
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number (optional)"
          className={fieldClass}
        />

        <button
          type="submit"
          disabled={status === "submitting"}
          className="mt-1 w-full rounded-xl bg-indigo-500 px-5 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60"
        >
          {status === "submitting" ? "Joining..." : "Join now"}
        </button>
      </div>

      {status === "error" && (
        <p className="mt-2 text-sm text-red-400">{errorMsg}</p>
      )}

      <p className="mt-4 text-center text-xs text-white/40">
        By joining, you agree to our{" "}
        <a href="/privacy" className="underline hover:text-white/70">
          Privacy Policy
        </a>{" "}
        and consent to receive marketing calls, texts, and emails from Osprey.
      </p>
    </form>
  );
}
