// A cover for a trip that has no photo: a gradient out of the app's palette with a few
// topographic contour lines over it, both chosen from the trip's name, so the same trip always
// looks the same and different trips usually look different. Pure, so it is testable.

export interface Cover {
  /** A CSS background for the base. */
  background: string;
  /** SVG path data, one entry per contour line, in a 400x240 box. */
  contours: string[];
}

/** Dusk and terracotta, forest and gold: the app's palette, as six gradients that all take white text. */
export const COVER_GRADIENTS = [
  'linear-gradient(135deg, #0F3D3A 0%, #1F6F63 55%, #D9962B 120%)',
  'linear-gradient(150deg, #3D1F1D 0%, #A73728 55%, #DF643F 110%)',
  'linear-gradient(135deg, #7A2E1F 0%, #C2573F 55%, #F0A53B 120%)',
  'linear-gradient(160deg, #0A2A2E 0%, #14595A 60%, #5F9C86 120%)',
  'linear-gradient(140deg, #2A1B1A 0%, #8C3B2A 50%, #E0745E 115%)',
  'linear-gradient(135deg, #10312F 0%, #3D1F1D 55%, #C2573F 115%)',
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
