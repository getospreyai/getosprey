// Deterministic PDF renderer for a structured property report (no LLM). Turns
// the cached report JSON into a branded, client-forwardable one-pager+ using
// pdf-lib. Osprey wordmark, violet accent, address header, sections, footer.

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { PropertyReport } from "./generate";

export interface ReportPdfMeta {
  /** Property address for the header. */
  address: string;
  /** Owner/agent name for the footer attribution. */
  preparedBy: string;
}

const VIOLET = rgb(0.545, 0.361, 0.965); // #8B5CF6
const INK = rgb(0.09, 0.07, 0.13);
const MUTED = rgb(0.42, 0.4, 0.5);

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Greedy word-wrap into lines that fit `maxWidth` at `size`. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        // A single word longer than the column: hard-break it by character.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
              if (chunk) out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Strip the most common inline markdown so plain-text rendering reads cleanly. */
function deMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

export async function reportToPdf(
  report: PropertyReport,
  meta: ReportPdfMeta,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  /** Draw wrapped text, paginating as needed. */
  const draw = (
    text: string,
    f: PDFFont,
    size: number,
    color = INK,
    leading = 1.35,
    indent = 0,
  ) => {
    const lineH = size * leading;
    for (const line of wrap(text, f, size, CONTENT_W - indent)) {
      if (y - lineH < MARGIN) newPage();
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font: f, color });
      y -= lineH;
    }
  };

  const gap = (h: number) => {
    if (y - h < MARGIN) newPage();
    else y -= h;
  };

  // Masthead: wordmark + violet rule.
  page.drawText("OSPREY", { x: MARGIN, y: y - 16, size: 16, font: bold, color: VIOLET });
  page.drawText("Property Research Report", {
    x: MARGIN + 90,
    y: y - 15,
    size: 11,
    font,
    color: MUTED,
  });
  y -= 26;
  page.drawRectangle({ x: MARGIN, y: y, width: CONTENT_W, height: 2, color: VIOLET });
  y -= 18;

  // Address + headline.
  draw(meta.address, bold, 15, INK, 1.3);
  gap(4);
  draw(report.headline, font, 12, MUTED, 1.35);
  gap(14);

  const section = (heading: string, s: PropertyReport["summary"]) => {
    gap(6);
    if (y - 20 < MARGIN) newPage();
    // Accent tick before the section title.
    page.drawRectangle({ x: MARGIN, y: y - 12, width: 4, height: 13, color: VIOLET });
    draw(s.title || heading, bold, 12.5, INK, 1.3, 12);
    gap(3);
    if (s.body.trim()) draw(deMarkdown(s.body), font, 10.5, INK, 1.4);
    if (s.bullets?.length) {
      gap(3);
      for (const b of s.bullets) draw(`• ${deMarkdown(b)}`, font, 10.5, INK, 1.35, 8);
    }
    gap(12);
  };

  section("Summary", report.summary);
  section("Deal Numbers", report.dealNumbers);
  section("Rent Comparables", report.rentComps);
  section("Neighborhood", report.neighborhood);
  section("Market Trends", report.marketTrends);
  section("Risks", report.risks);
  section("Negotiation Angles", report.negotiationAngles);
  section("Bottom Line", report.bottomLine);

  // Footer on every page.
  const footer = `Prepared by ${meta.preparedBy} with Osprey · getosprey.ai`;
  for (const p of doc.getPages()) {
    p.drawText(footer, { x: MARGIN, y: MARGIN - 24, size: 8, font, color: MUTED });
  }

  return doc.save();
}
