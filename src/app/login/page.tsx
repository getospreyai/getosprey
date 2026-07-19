"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import Backdrop from "@/components/Backdrop";

type Status = "idle" | "submitting" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (!res || res.error) {
      setStatus("error");
      setErrorMsg("Incorrect email or password.");
      return;
    }

    router.push("/dashboard");
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
            Welcome{" "}
            <span className="font-[family-name:var(--font-instrument-serif)] font-normal italic text-violet-200">
              back.
            </span>
          </h1>
          <p className="mt-3 text-center text-sm text-white/60">
            Log in to see your buy box and verdicts.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md"
          >
            <div className="flex flex-col gap-3">
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={fieldClass}
              />

              <button
                type="submit"
                disabled={status === "submitting"}
                className="mt-1 w-full rounded-xl bg-indigo-500 px-5 py-3 font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60"
              >
                {status === "submitting" ? "Logging in..." : "Log in"}
              </button>
            </div>

            {status === "error" && (
              <p className="mt-3 text-sm text-red-400">{errorMsg}</p>
            )}
          </form>

          <p className="mt-6 text-center text-sm text-white/50">
            New to Osprey?{" "}
            <a href="/signup" className="text-white underline hover:text-white/80">
              Create an account
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
