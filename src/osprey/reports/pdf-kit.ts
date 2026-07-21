// Shared pdf-lib primitives for Osprey's deterministic PDF renderers
// (reports/pdf.ts's AI-report renderer, reports/packet.ts's lender packet).
// No LLM, no per-report state — just brand constants and layout/pagination
// math so both renderers look identical and neither duplicates the other.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export const VIOLET = rgb(0.545, 0.361, 0.965); // #8B5CF6
export const INK = rgb(0.09, 0.07, 0.13);
export const MUTED = rgb(0.42, 0.4, 0.5);
export const EMERALD = rgb(0.204, 0.647, 0.49); // cash-flow-positive accent
export const AMBER = rgb(0.82, 0.55, 0.14); // near-miss / caution accent

export const PAGE_W = 612; // US Letter
export const PAGE_H = 792;
export const MARGIN = 56;
export const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * pdf-lib's StandardFonts use WinAnsi (Windows-1252): ASCII, the Latin-1
 * supplement (café, ñ...), and a fixed set of "smart typography" punctuation
 * (en/em dash, curly quotes, bullet, ellipsis, trademark...) — verified
 * against pdf-lib's own encoding table. Anything outside that THROWS inside
 * pdf-lib at measure/draw time, not just fails to render. Two characters
 * this codebase's own text produces already hit that in testing: U+2212
 * (the typographic minus formatSignedMonthly/formatSignedMoney use for
 * EVERY negative dollar figure — the common case, not an edge case, for
 * deals this app flags as near-misses) and U+2248 (section8.ts's "≈110% of
 * FY2026 FMR" label). Rather than chase call sites one crash at a time,
 * every text entry point below runs through this: known lookalikes get a
 * clean ASCII substitute, anything else unencodable degrades to "?" instead
 * of 500ing the whole PDF.
 */
const PDF_CHAR_FALLBACKS: Record<string, string> = {
  "−": "-", // − minus sign
  "≈": "~", // ≈ almost-equal
  "×": "x", // × multiplication sign
  "÷": "/", // ÷ division sign
  "±": "+/-", // ± plus-minus
  "→": "->", // → rightwards arrow
  "←": "<-", // ← leftwards arrow
};

// WinAnsi's non-ASCII coverage: Latin-1 supplement (0xA0-0xFF) plus this
// fixed punctuation/symbol set. Enumerated against
// @pdf-lib/standard-fonts's WinAnsi encoding table, not guessed.
const WINANSI_EXTRA_CODEPOINTS = new Set([
  0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc, 0x2013, 0x2014,
  0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039,
  0x203a, 0x20ac, 0x2122,
]);

function sanitizeForPdf(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const isAscii = cp === 0x0a || (cp >= 0x20 && cp <= 0x7e);
    const isLatin1Supplement = cp >= 0xa0 && cp <= 0xff;
    if (isAscii || isLatin1Supplement || WINANSI_EXTRA_CODEPOINTS.has(cp)) {
      out += ch;
    } else {
      out += PDF_CHAR_FALLBACKS[ch] ?? "?";
    }
  }
  return out;
}

/** Greedy word-wrap into lines that fit `maxWidth` at `size`. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of sanitizeForPdf(text).split("\n")) {
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
export function deMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

/** Mutable cursor threaded through a render: current page + y position, plus
 *  the two embedded fonts every Osprey PDF uses. */
export interface PdfCursor {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

export async function createPdfCursor(): Promise<PdfCursor> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return { doc, font, bold, page, y: PAGE_H - MARGIN };
}

export function newPage(c: PdfCursor): void {
  c.page = c.doc.addPage([PAGE_W, PAGE_H]);
  c.y = PAGE_H - MARGIN;
}

/** Draw wrapped text, paginating as needed. */
export function draw(
  c: PdfCursor,
  text: string,
  f: PDFFont,
  size: number,
  color: RGB = INK,
  leading = 1.35,
  indent = 0,
): void {
  const lineH = size * leading;
  for (const line of wrap(text, f, size, CONTENT_W - indent)) {
    if (c.y - lineH < MARGIN) newPage(c);
    c.page.drawText(line, { x: MARGIN + indent, y: c.y - size, size, font: f, color });
    c.y -= lineH;
  }
}

export function gap(c: PdfCursor, h: number): void {
  if (c.y - h < MARGIN) newPage(c);
  else c.y -= h;
}

/** Wordmark + violet rule, with a subtitle naming the document. */
export function masthead(c: PdfCursor, subtitle: string): void {
  c.page.drawText("OSPREY", { x: MARGIN, y: c.y - 16, size: 16, font: c.bold, color: VIOLET });
  c.page.drawText(sanitizeForPdf(subtitle), { x: MARGIN + 90, y: c.y - 15, size: 11, font: c.font, color: MUTED });
  c.y -= 26;
  c.page.drawRectangle({ x: MARGIN, y: c.y, width: CONTENT_W, height: 2, color: VIOLET });
  c.y -= 18;
}

/** Accent-tick section heading, the same look reportToPdf and the packet
 *  renderer both use. */
export function sectionHeading(c: PdfCursor, title: string): void {
  gap(c, 6);
  if (c.y - 20 < MARGIN) newPage(c);
  c.page.drawRectangle({ x: MARGIN, y: c.y - 12, width: 4, height: 13, color: VIOLET });
  draw(c, title, c.bold, 12.5, INK, 1.3, 12);
  gap(c, 3);
}

export function footerOnEveryPage(c: PdfCursor, text: string): void {
  const safe = sanitizeForPdf(text);
  for (const p of c.doc.getPages()) {
    p.drawText(safe, { x: MARGIN, y: MARGIN - 24, size: 8, font: c.font, color: MUTED });
  }
}

export interface TableColumn {
  header: string;
  /** Column width in points; widths should sum to <= CONTENT_W. */
  width: number;
  align?: "left" | "right";
}

/** Header row: bold, muted, with a rule underneath. */
export function drawTableHeader(c: PdfCursor, columns: TableColumn[], size = 8.5): void {
  const lineH = size * 1.6;
  if (c.y - lineH < MARGIN) newPage(c);
  let x = MARGIN;
  for (const col of columns) {
    const header = sanitizeForPdf(col.header);
    const w = c.bold.widthOfTextAtSize(header, size);
    const tx = col.align === "right" ? x + col.width - w : x;
    c.page.drawText(header, { x: tx, y: c.y - size, size, font: c.bold, color: MUTED });
    x += col.width;
  }
  c.y -= lineH;
  c.page.drawRectangle({ x: MARGIN, y: c.y + 4, width: CONTENT_W, height: 0.75, color: MUTED });
  c.y -= 4;
}

/** One data row for a fixed-width column layout (drawTableHeader's counterpart). */
export function drawTableRow(
  c: PdfCursor,
  columns: TableColumn[],
  values: string[],
  opts?: { size?: number; color?: RGB; bold?: boolean },
): void {
  const size = opts?.size ?? 9;
  const font = opts?.bold ? c.bold : c.font;
  const color = opts?.color ?? INK;
  const lineH = size * 1.55;
  if (c.y - lineH < MARGIN) newPage(c);
  let x = MARGIN;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const text = sanitizeForPdf(values[i] ?? "");
    const w = font.widthOfTextAtSize(text, size);
    const tx = col.align === "right" ? x + col.width - w : x;
    c.page.drawText(text, { x: tx, y: c.y - size, size, font, color });
    x += col.width;
  }
  c.y -= lineH;
}
