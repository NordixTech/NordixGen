import { z } from "zod";

// Keep literal syntax and numeric ranges in regexes so runtime and editor validation agree.
const number = "(?:\\d{1,9}(?:\\.\\d+)?|\\.\\d+)";
const percentage = "(?:100(?:\\.0+)?|(?:[1-9]?\\d)(?:\\.\\d+)?|\\.\\d+)";
const rgb = "(?:255(?:\\.0+)?|(?:25[0-4]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.\\d+)?|\\.\\d+)";
const channel = `(?:${rgb}|${percentage}%)`;
const alpha = `(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|${percentage}%)`;
const components = [
  "#[\\da-fA-F]{3}",
  "#[\\da-fA-F]{4}",
  "#[\\da-fA-F]{6}",
  "#[\\da-fA-F]{8}",
  ...[rgb, `${percentage}%`].map(
    (unit) => `rgba?\\(\\s*${unit}\\s*,\\s*${unit}\\s*,\\s*${unit}(?:\\s*,\\s*${alpha})?\\s*\\)`,
  ),
  `rgba?\\(\\s*${channel}\\s+${channel}\\s+${channel}(?:\\s*/\\s*${alpha})?\\s*\\)`,
  ...["\\s*,\\s*", "\\s+"].map(
    (separator, index) =>
      `hsla?\\(\\s*-?${number}(?:deg)?${separator}${percentage}%${separator}${percentage}%(?:${index === 0 ? "\\s*,\\s*" : "\\s*/\\s*"}${alpha})?\\s*\\)`,
  ),
];
export const ColorSchema = z
  .string()
  .regex(
    new RegExp(`^(?:${components.join("|")})$`),
    "Use a literal hex, rgb() or hsl() color with channels in range (optional alpha is supported).",
  );

export const THEME_MAIN_COLORS = [
  "primary",
  "secondary",
  "background",
  "surface",
  "foreground",
  "muted",
  "border",
] as const;
const main = Object.fromEntries(THEME_MAIN_COLORS.map((key) => [key, ColorSchema])) as Record<
  (typeof THEME_MAIN_COLORS)[number],
  typeof ColorSchema
>;
const status = {
  error: ColorSchema.optional(),
  success: ColorSchema.optional(),
  warning: ColorSchema.optional(),
  info: ColorSchema.optional(),
};
// The union also publishes the all-or-none rule in the generated editor schema.
export const ThemePaletteSchema = z.union([
  z.object({ ...main, ...status }).strict(),
  z.object(status).strict(),
]);
export const FrontendThemeSchema = z
  .object({
    default: z.enum(["light", "dark", "system"]).default("system"),
    light: ThemePaletteSchema.optional(),
    dark: ThemePaletteSchema.optional(),
  })
  .strict();
