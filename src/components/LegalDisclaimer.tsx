import { DISCLAIMER_FULL } from "@/lib/legal";

/** Fine-print compliance card — informational-only framing for underwriting
 *  output and AI answers. Pure display, server-safe. Deliberately quiet
 *  (text-xs, low opacity) so it reads as fine print and doesn't compete with
 *  the analysis above it. */
export default function LegalDisclaimer({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-md ${className ?? ""}`}
    >
      <p className="text-xs leading-relaxed text-white/40">{DISCLAIMER_FULL}</p>
    </div>
  );
}
