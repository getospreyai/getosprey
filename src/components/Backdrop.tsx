import Particles from "@/components/Particles";

export default function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* deep indigo → violet radial wash, brightest toward the lower center */}
      <div className="absolute inset-0 bg-[radial-gradient(130%_115%_at_50%_118%,#7d6df6_0%,#4c39b6_25%,#271c66_48%,#100a34_70%,#080614_100%)]" />

      {/* slow-rotating conic sheen — flowing colour, centered by a static
          wrapper so the animation owns transform (reduced-motion safe) */}
      <div className="absolute left-1/2 top-[38%] h-[1200px] w-[1200px] max-w-[160vw] -translate-x-1/2 -translate-y-1/2">
        <div className="osprey-aurora-rotate h-full w-full rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(125,109,246,0.14)_70deg,transparent_150deg,rgba(76,57,182,0.16)_240deg,transparent_320deg)] opacity-70 blur-3xl" />
      </div>

      {/* slow-drifting aurora blobs — pure transform/opacity animation (GPU),
          calmed to long cycles so it reads as ambient, not busy */}
      <div className="osprey-aurora-a absolute -left-[12%] top-[6%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(125,109,246,0.34),transparent_62%)] blur-3xl" />
      <div className="osprey-aurora-b absolute -right-[10%] top-[28%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(96,74,222,0.36),transparent_62%)] blur-3xl" />

      {/* soft aurora glow near the top-center — centered via auto margins so the
          animation owns transform; breathes in scale + opacity */}
      <div className="osprey-aurora-glow absolute inset-x-0 top-[14%] mx-auto h-[360px] w-[760px] max-w-full rounded-full bg-[radial-gradient(ellipse_at_center,rgba(223,223,255,0.26),transparent_60%)] blur-3xl" />

      {/* ambient particle / constellation field (viewport-fixed canvas) */}
      <Particles />

      {/* subtle top darkening for nav legibility */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#080614]/70 to-transparent" />
    </div>
  );
}
