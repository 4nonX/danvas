// Print formats in millimetres, offered wherever a page size is picked (the
// page panel, a new design, Magic Resize). Turned into exact design px at the
// design's dpi, so an A4 page is 210 x 297 mm in every export.

import { tr } from "@/lib/i18n";

export interface PrintFormat {
  id: string;
  /** Width and height in mm, portrait. */
  mm: [number, number];
  label: () => string;
}

export const PRINT_FORMATS: PrintFormat[] = [
  { id: "a3", mm: [297, 420], label: () => "A3" },
  { id: "a4", mm: [210, 297], label: () => "A4" },
  { id: "a5", mm: [148, 210], label: () => "A5" },
  { id: "a6", mm: [105, 148], label: () => "A6" },
  { id: "dl", mm: [99, 210], label: () => tr("editor.format_din_long") },
  { id: "letter", mm: [215.9, 279.4], label: () => tr("editor.us_letter") },
  { id: "card", mm: [55, 85], label: () => tr("editor.format_business_card") },
];
