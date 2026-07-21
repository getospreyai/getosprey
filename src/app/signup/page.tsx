"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import Backdrop from "@/components/Backdrop";

type Status = "idle" | "submitting" | "error";

function SignupForm() {
  const router = useRouter();
  // Invite links look like /signup?invite=CODE — prefill the gate field.
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(searchParams.get("invite") ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, inviteCode }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Something went wrong. Try again.");
        return;
      }

      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!signInRes || signInRes.error) {
        // Account was created but auto-login failed — send them to log in manually.
        router.push("/login");
        return;
      }

      router.push("/dashboard");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  const fieldClass =
    "w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white placeholder-white/40 outline-none backdrop-blur-sm transition focus:border-violet-400/60 focus:bg-white/[0.09]";

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Osprey
        </Link>
        <a
          href="mailto:hello@getosprey.ai"
          className="text-sm text-white/60 transition hover:text-white"
        >
          Need help?
        </a>
      </nav>

      <section className="relative z-10 flex flex-1 items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <h1 className="text-balance text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Create your{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              account.
            </span>
          </h1>
          <p className="mt-3 text-center text-sm text-white/60">
            Set your buy box once. Osprey does the underwriting.
          </p>
          <p className="mt-2 text-center text-xs text-white/40">
            Invite-only during early access —{" "}
            <Link href="/#join" className="underline hover:text-white/70">
              join the waitlist
            </Link>{" "}
            if you don&apos;t have a code.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md"
          >
            <div className="flex flex-col gap-3">
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className={fieldClass}
              />
              <input
                type="email"
                inputMode="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className={fieldClass}
              />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min. 8 characters)"
                className={fieldClass}
              />
              <input
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Invite code"
                className={fieldClass}
              />

              <button
                type="submit"
                disabled={status === "submitting"}
                className="mt-1 w-full rounded-xl bg-indigo-500 px-5 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60"
              >
                {status === "submitting" ? "Creating account..." : "Create account"}
              </button>
            </div>

            {status === "error" && (
              <p className="mt-3 text-sm text-red-400">{errorMsg}</p>
            )}

            <p className="mt-3 text-center text-xs text-white/40">
              By creating an account, you agree to our{" "}
              <Link href="/terms" className="underline hover:text-white/70">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline hover:text-white/70">
                Privacy Policy
              </Link>
              .
            </p>
          </form>

          <p className="mt-6 text-center text-sm text-white/50">
            Already have an account?{" "}
            <a href="/login" className="text-white underline hover:text-white/80">
              Log in
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}

export default function SignupPage() {
  // useSearchParams requires a Suspense boundary for static rendering.
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
