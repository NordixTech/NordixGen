import type { ThemePalette } from "../../project/theme.js";

/** Parse schema-validated CSS literals for automatic contrasting button text. */
export function rgba(color: string): readonly number[] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length < 5 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4]
      .map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255)
      .concat(full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1);
  }
  const parts = color
    .slice(color.indexOf("(") + 1, -1)
    .trim()
    .split(/[\s,/]+/);
  const values = parts.map(Number.parseFloat);
  const alpha = parts[3] === undefined ? 1 : values[3] / (parts[3].endsWith("%") ? 100 : 1);
  if (color.startsWith("rgb"))
    return values
      .slice(0, 3)
      .map((value, index) => value / (parts[index].endsWith("%") ? 100 : 255))
      .concat(alpha);
  const hue = (((values[0] % 360) + 360) % 360) / 30;
  const saturation = values[1] / 100;
  const lightness = values[2] / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4]
    .map((offset) => {
      const k = (offset + hue) % 12;
      return lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    })
    .concat(alpha);
}
export function contrastingText(color: string, surface: string): string {
  const foreground = rgba(color);
  const background = rgba(surface);
  const channels = foreground.slice(0, 3).map((value, index) => {
    const channel = value * foreground[3] + background[index] * (1 - foreground[3]);
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}
export function themeTokens(palette: ThemePalette): Readonly<Record<string, string>> {
  const tokens: Record<string, string> = { ...palette };
  for (const brand of ["primary", "secondary"] as const)
    tokens[`${brand}-foreground`] = contrastingText(palette[brand], palette.surface);
  for (const status of ["error", "success", "warning", "info"] as const) {
    tokens[`${status}-surface`] = `color-mix(in srgb, ${palette[status]} 12%, ${palette.surface})`;
    tokens[`${status}-foreground`] = palette.foreground;
  }
  tokens["error-button-foreground"] = contrastingText(palette.error, palette.surface);
  tokens["surface-subtle"] = "color-mix(in srgb, var(--ng-foreground) 4%, var(--ng-surface))";
  tokens["primary-surface"] = "color-mix(in srgb, var(--ng-primary) 10%, var(--ng-surface))";
  tokens["primary-hover"] = "color-mix(in srgb, var(--ng-primary) 88%, var(--ng-foreground))";
  tokens.focus = "var(--ng-primary)";
  tokens.overlay = "rgb(0 0 0 / 55%)";
  tokens.shadow = "rgb(0 0 0 / 12%)";
  return tokens;
}
