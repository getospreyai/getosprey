import type { PropertyType } from "@/osprey/engine/types";

/** Shared with dashboard/page.tsx's local copy — the display label per PropertyType. */
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  single_family: "Single-family",
  duplex: "Duplex",
  triplex: "Triplex",
  fourplex: "Fourplex",
};
