// CIEDE2000 colour difference (CIE 142-2001) between two CIE L*a*b* colours,
// as printers and colour books use it to say how close two colours are:
// below about 1 the difference is hard to see, below about 2 it is small.
// Implemented after Sharma, Wu and Dalal, "The CIEDE2000 Color-Difference
// Formula" (2005), with kL = kC = kH = 1.

import type { Lab } from "./nearest";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The CIEDE2000 difference of two Lab colours (same white point). */
export function ciede2000(x: Lab, y: Lab): number {
  const C1 = Math.hypot(x.a, x.b), C2 = Math.hypot(y.a, y.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * x.a, a2 = (1 + G) * y.a;
  const c1 = Math.hypot(a1, x.b), c2 = Math.hypot(a2, y.b);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1 = hue(x.b, a1), h2 = hue(y.b, a2);

  const dL = y.l - x.l;
  const dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2));

  const Lm = (x.l + y.l) / 2;
  const cm = (c1 + c2) / 2;
  let hm = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2;
    else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * cm;
  const Sh = 1 + 0.015 * cm * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}
