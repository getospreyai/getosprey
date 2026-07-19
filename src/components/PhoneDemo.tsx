// A rendered Telegram thread showing an Osprey verdict, mirroring the real
// bot: verdict message with one-tap Analyze / Pass / Save buttons, typed
// replies work too. The financials are genuine output from the underwriting
// engine for these inputs ($415k fourplex, $3,850/mo est. rent, 25% down
// conventional @ 6.75%), but the property is illustrative — the address is
// fictional on purpose. Never put a real address on this page: pairing a
// specific property with hypothetical financials reads as a representation
// about that property.

function OspreyBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-white/[0.08] px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-white/90 backdrop-blur-sm">
      {children}
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[70%] self-end rounded-2xl rounded-br-md bg-indigo-500 px-3.5 py-2 text-left text-[13px] leading-relaxed text-white">
      {children}
    </div>
  );
}

/** Telegram-style inline keyboard attached under a bot message. */
function VerdictButtons() {
  return (
    <div
      aria-hidden
      className="flex max-w-[85%] gap-1 self-start"
    >
      {["🔍 Analyze", "👎 Pass", "⭐ Save"].map((label) => (
        <span
          key={label}
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-center text-[11px] text-violet-100/90"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export default function PhoneDemo() {
  return (
    <div
      aria-label="Example Osprey Telegram conversation: Osprey sends a cash-flow verdict on a fourplex with Analyze, Pass, and Save buttons; the investor taps Analyze for the full breakdown, then passes and Osprey learns the preference."
      className="mx-auto w-full max-w-[340px] rounded-[2.5rem] border border-white/15 bg-[#0d0a1f]/90 p-3 shadow-[0_25px_80px_rgba(99,88,238,0.25)] backdrop-blur-md"
    >
      <div className="rounded-[2rem] bg-[#07051a] px-4 pb-5 pt-4">
        {/* thread header */}
        <div className="mb-4 flex flex-col items-center gap-1 border-b border-white/10 pb-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/30 text-base">
            🦅
          </span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-white/80">
            Osprey
            <span className="rounded bg-white/[0.08] px-1 py-px text-[9px] uppercase tracking-wide text-white/50">
              bot
            </span>
          </span>
          <span className="mt-1 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            Sample deal
          </span>
        </div>

        {/* thread */}
        <div className="flex flex-col gap-2.5">
          <OspreyBubble>
            🦅 New match: Fourplex · 1400 Kestrel Hollow Ct, Las Vegas —
            $415,000
            <br />
            At your 25% down conventional:{" "}
            <span className="font-semibold text-emerald-300">+$633/mo</span>{" "}
            (est. rent $3,850/mo)
            <br />
            <span className="text-white/60">
              Cap 7.7% · CoC 6.5% · DSCR 1.64
            </span>
            <br />
            Tap a button — or just type. A for the breakdown, P to pass.
          </OspreyBubble>
          <VerdictButtons />

          <UserBubble>A</UserBubble>

          <OspreyBubble>
            Down $103,750 · P&amp;I $2,019/mo · NOI $2,651/mo →{" "}
            <span className="font-semibold text-emerald-300">+$633/mo</span> at
            your numbers. Break-even occupancy 79%. Want the 10-year hold
            projection?
          </OspreyBubble>

          <UserBubble>P — too far east for me</UserBubble>

          <OspreyBubble>
            Passed. I&apos;ll factor that into what I send you next.
          </OspreyBubble>
        </div>
      </div>
    </div>
  );
}
