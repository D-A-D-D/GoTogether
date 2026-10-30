// A cover for a trip that has no photo: a gradient out of the app's palette with a few
// topographic contour lines over it, both chosen from the trip's name, so the same trip always
// looks the same and different trips usually look different. Pure, so it is testable.

export interface Cover {
  /** A CSS background for the base. */
  background: string;
  /** SVG path data, one entry per contour line, in a 400x240 box. */
  contours: string[];
}

/** Sunset, ember, ocean and forest: the app's palette at full strength, as six gradients that take white text (over the scrim). */
export const COVER_GRADIENTS = [
  'linear-gradient(135deg, #0B4B45 0%, #0F9D8A 55%, #FFB41F 125%)',
  'linear-gradient(150deg, #5B1030 0%, #C2185B 50%, #FF7A45 115%)',
  'linear-gradient(135deg, #8A2406 0%, #E0481F 55%, #FFB41F 120%)',
  'linear-gradient(160deg, #0A3A5C 0%, #0E7490 55%, #3DD6C1 125%)',
  'linear-gradient(140deg, #3A1208 0%, #B83A1B 50%, #FF8A5C 115%)',
  'linear-gradient(135deg, #064E3B 0%, #15803D 55%, #E9B824 120%)',
] as const;

/** FNV-1a: a small, stable string hash. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded random number generator, 0 <= n < 1. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** One closed, gently wobbling loop around (cx, cy) - a contour line - as SVG path data. */
function contour(cx: number, cy: number, radius: number, wobble: number[], phase: number): string {
  const points = 36;
  let d = '';
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const bump = wobble.reduce((sum, amp, k) => sum + amp * Math.sin(angle * (k + 2) + phase * (k + 1)), 0);
    const r = radius * (1 + bump);
    const x = cx + Math.cos(angle) * r * 1.5; // wider than tall, to suit a landscape card
    const y = cy + Math.sin(angle) * r;
    d += `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)} `;
  }
  return `${d}Z`;
}

export function coverFor(seedText: string): Cover {
  const hash = hashString(seedText.trim().toLowerCase() || 'trip');
  const random = seeded(hash);
  const background = COVER_GRADIENTS[hash % COVER_GRADIENTS.length];

  // Contours share a centre and a wobble, growing outward like the rings of a hill.
  const cx = 80 + random() * 240;
  const cy = 40 + random() * 160;
  const wobble = [0.05 + random() * 0.05, 0.03 + random() * 0.04, 0.015 + random() * 0.02];
  const phase = random() * Math.PI * 2;
  const contours = [];
  for (let ring = 0; ring < 7; ring++) {
    contours.push(contour(cx, cy, 18 + ring * 22, wobble, phase + ring * 0.12));
  }
  return { background, contours };
}
