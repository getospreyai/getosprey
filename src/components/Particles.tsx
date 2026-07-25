"use client";

import { useEffect, useRef } from "react";

/**
 * Interactive dot grid. A regular, evenly-spaced grid of faint dots that reacts
 * to the cursor: dots within a radius brighten, grow, and push gently away from
 * the pointer, then spring back to their grid position. Rendered on a single
 * viewport-fixed canvas.
 *
 * Performance:
 *  - Fixed to the viewport (not the full page), so the canvas bitmap stays
 *    small regardless of page length; DPR capped at 2.
 *  - The rAF loop only runs while there's motion to render (cursor engaged or
 *    dots still springing back); it stops once everything has settled and the
 *    canvas simply holds the last frame. Restarts on the next mouse move.
 *  - Pauses when the tab is hidden.
 *
 * Accessible: under prefers-reduced-motion it paints a single static grid and
 * never reacts or animates.
 */
export default function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const context = canvasEl.getContext("2d");
    if (!context) return;
    // Re-bind to consts whose *declared* type is non-null so the nested render
    // functions type-check without re-narrowing across the closure boundary.
    const canvas = canvasEl;
    const ctx = context;

    const RGB = "167, 139, 250"; // violet-400
    const SPACING = 46; // px between grid dots
    const RADIUS = 150; // cursor influence radius
    const PUSH = 20; // max displacement (px) near the cursor
    const BASE_ALPHA = 0.17;
    const OFFSCREEN = -9999;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    const mouse = { x: OFFSCREEN, y: OFFSCREEN };
    let dots: { bx: number; by: number; x: number; y: number }[] = [];

    function build() {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.ceil(width / SPACING) + 1;
      const rows = Math.ceil(height / SPACING) + 1;
      const offX = (width - (cols - 1) * SPACING) / 2;
      const offY = (height - (rows - 1) * SPACING) / 2;
      dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = offX + c * SPACING;
          const by = offY + r * SPACING;
          dots.push({ bx, by, x: bx, y: by });
        }
      }
    }

    function drawStatic() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = `rgba(${RGB},${BASE_ALPHA})`;
      for (const d of dots) {
        ctx.beginPath();
        ctx.arc(d.bx, d.by, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Advance one frame; returns true once everything has settled.
    function frame(): boolean {
      ctx.clearRect(0, 0, width, height);
      const r2 = RADIUS * RADIUS;
      let maxDelta = 0;

      for (const d of dots) {
        const dx = d.bx - mouse.x;
        const dy = d.by - mouse.y;
        const dist2 = dx * dx + dy * dy;

        let tx = d.bx;
        let ty = d.by;
        let glow = 0;
        if (dist2 < r2) {
          const dist = Math.sqrt(dist2) || 1;
          const f = 1 - dist / RADIUS; // 0..1, strongest at cursor
          const push = f * f * PUSH;
          // add the (cursor → dot) vector to push dots away from the cursor
          tx = d.bx + (dx / dist) * push;
          ty = d.by + (dy / dist) * push;
          glow = f;
        }

        d.x += (tx - d.x) * 0.15;
        d.y += (ty - d.y) * 0.15;
        maxDelta = Math.max(maxDelta, Math.abs(tx - d.x), Math.abs(ty - d.y));

        const alpha = BASE_ALPHA + glow * 0.6;
        const radius = 1 + glow * 1.8;
        ctx.beginPath();
        ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${RGB},${alpha})`;
        ctx.fill();
      }

      const cursorGone = mouse.x === OFFSCREEN;
      return cursorGone && maxDelta < 0.1;
    }

    function loop() {
      const settled = frame();
      if (settled) {
        running = false;
        return; // canvas retains the last (resting) frame
      }
      raf = requestAnimationFrame(loop);
    }

    function ensureRunning() {
      if (!running && !prefersReduced) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      ensureRunning();
    }

    function onMouseLeave() {
      mouse.x = OFFSCREEN;
      mouse.y = OFFSCREEN;
      ensureRunning(); // let the dots spring home, then stop
    }

    function onResize() {
      build();
      if (prefersReduced) drawStatic();
      else {
        // reset positions to base to avoid springing from stale coords
        for (const d of dots) {
          d.x = d.bx;
          d.y = d.by;
        }
        drawStatic();
        ensureRunning();
      }
    }

    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        running = false;
      }
    }

    build();
    drawStatic();
    if (!prefersReduced) {
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      document.addEventListener("mouseleave", onMouseLeave);
      document.addEventListener("visibilitychange", onVisibility);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full"
    />
  );
}
