export default function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* deep indigo → violet radial wash, brightest toward the lower center */}
      <div className="absolute inset-0 bg-[radial-gradient(130%_115%_at_50%_118%,#7d6df6_0%,#4c39b6_25%,#271c66_48%,#100a34_70%,#080614_100%)]" />

      {/* soft aurora glow near the top-center */}
      <div className="absolute left-1/2 top-[14%] h-[360px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(223,223,255,0.26),transparent_60%)] blur-3xl" />

      {/* subtle top darkening for nav legibility */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#080614]/70 to-transparent" />
    </div>
  );
}
