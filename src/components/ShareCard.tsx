"use client";

// Public share-link management: create/copy/revoke via
// POST/DELETE /api/property/[listingId]/share. Idempotent create — the
// server returns the existing non-revoked token if one is already minted.

import { useState } from "react";

export default function ShareCard({
  listingId,
  initialUrl,
}: {
  listingId: string;
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [copied, setCopied] = useState(false);

  async function create() {
    setStatus("loading");
    try {
      const res = await fetch(`/api/property/${listingId}/share`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setUrl(data.url);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function revoke() {
    setStatus("loading");
    try {
      const res = await fetch(`/api/property/${listingId}/share`, { method: "DELETE" });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setUrl(null);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function copy() {
    if (!url) return;
    const full = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md">
      <h2 className="text-sm font-medium text-white">Share</h2>
      <p className="mt-1 text-xs text-white/50">
        A read-only link for a client — no login, no scenario studio.
      </p>

      {url ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/80"
            />
            <button
              type="button"
              onClick={copy}
              className="whitespace-nowrap rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.1]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={revoke}
            disabled={status === "loading"}
            className="self-start text-xs text-white/50 transition hover:text-red-300 disabled:opacity-50"
          >
            Revoke link
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={create}
          disabled={status === "loading"}
          className="mt-4 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(79,70,229,0.45)] transition hover:bg-indigo-400 disabled:opacity-60"
        >
          {status === "loading" ? "Creating…" : "Create share link"}
        </button>
      )}
      {status === "error" && <p className="mt-3 text-sm text-red-400">Something went wrong.</p>}
    </div>
  );
}
