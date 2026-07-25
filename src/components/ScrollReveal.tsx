"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Global scroll-reveal. Watches every element carrying the `reveal` class and
 * adds `is-visible` when it scrolls into view (the actual fade/rise lives in
 * globals.css). Mounted once in the root layout.
 *
 * Re-runs on route change because marketing nav uses client-side <Link>
 * navigation — the layout (and this effect) would otherwise never re-observe
 * the new page's freshly-mounted `.reveal` elements.
 *
 * Honors prefers-reduced-motion by revealing everything immediately. A
 * <noscript> block in the layout covers the JS-disabled case.
 */
export default function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)"),
    );
    if (els.length === 0) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
