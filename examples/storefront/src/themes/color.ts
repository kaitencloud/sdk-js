// The little colour arithmetic a theme needs: contrast, a hover shade, a tint. Hex only on purpose:
// the exported themes are hex, the arithmetic is exact there, and a colour in another notation
// (`oklch(...)`, `var(...)`) is passed through untouched by the callers instead of being guessed at.

type Rgb = readonly [number, number, number];

const BLACK = "#000000";
const WHITE = "#ffffff";

/** `#abc` or `#aabbcc` as channels, anything else as `undefined`. */
export function parseHex(color: string): Rgb | undefined {
  const value = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short)
    return [1, 2, 3].map((i) => Number.parseInt(short[i]! + short[i]!, 16)) as unknown as Rgb;
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (long) return [1, 2, 3].map((i) => Number.parseInt(long[i]!, 16)) as unknown as Rgb;
  return undefined;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.1 relative luminance of a hex colour. */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) throw new TypeError(`Not a hex colour: ${color}`);
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * `color` moved `amount` (0 to 1) of the way to `toward`, channel by channel in sRGB: what
 * `color-mix(in srgb, ...)` computes. Toward black it keeps the hue and the saturation and lowers
 * the value, which is what "a darker shade of this fill" means here.
 */
export function mix(color: string, toward: string, amount: number): string {
  const from = parseHex(color);
  const to = parseHex(toward);
  if (!from || !to) throw new TypeError(`Not a hex colour: ${color} or ${toward}`);
  return toHex(
    from.map((channel, i) => Math.round(channel + (to[i]! - channel) * amount)) as unknown as Rgb,
  );
}

const STEP = 0.005;

/**
 * The least change of `color`, toward `pole` (black to darken, white to lighten), that reads at
 * `minimum`:1 or better against every colour in `against`. The colour itself when it already does;
 * the pole when nothing short of it does. The amount goes up in steps of 0.5%, so the answer is the
 * first step that passes and one step less would not.
 */
export function legible(
  color: string,
  against: readonly string[],
  { minimum = 4.5, pole = BLACK }: { minimum?: number; pole?: string } = {},
): string {
  for (let amount = 0; amount <= 1 + 1e-9; amount += STEP) {
    const candidate = amount === 0 ? color : mix(color, pole, amount);
    if (against.every((surface) => contrastRatio(candidate, surface) >= minimum)) return candidate;
  }
  return pole;
}

/**
 * The hover shade of a fill that carries `label`: moved away from the label, so that the pair never
 * reads worse when the pointer arrives. A fill that cannot move that way (a white one under dark
 * text) moves the other, which costs the label a little and leaves it well above the minimum.
 * `undefined` for anything that is not hex.
 */
export function hoverShade(fill: string, label: string, amount = 0.1): string | undefined {
  if (!parseHex(fill) || !parseHex(label)) return undefined;
  const away = relativeLuminance(fill) < relativeLuminance(label) ? BLACK : WHITE;
  // Already at that end of the scale: a fill a tenth from white cannot get a tenth lighter.
  const room = away === WHITE ? 1 - relativeLuminance(fill) : relativeLuminance(fill);
  return mix(fill, room < 0.1 ? (away === WHITE ? BLACK : WHITE) : away, amount);
}

/**
 * The hover fill of `fill` under `label`: `hoverShade` when both are hex, otherwise a `color-mix`
 * that works on any CSS colour (a tenth of black in it).
 */
export function hoverFor(fill: string, label: string): string {
  return hoverShade(fill, label) ?? `color-mix(in srgb, ${fill} 90%, black)`;
}
