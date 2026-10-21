import type { z } from "zod";
import type { FrontendThemeSchema } from "../configuration/theme.js";

export const DEFAULT_THEME_PALETTES = {
  light: {
    primary: "#155eef",
    secondary: "#475467",
    background: "#f8fafc",
    surface: "#ffffff",
    foreground: "#101828",
    muted: "#667085",
    border: "#e4e7ec",
    error: "#b42318",
    success: "#067647",
    warning: "#93370d",
    info: "#175cd3",
  },
  dark: {
    primary: "#84adff",
    secondary: "#98a2b3",
    background: "#0b0f19",
    surface: "#111827",
    foreground: "#f9fafb",
    muted: "#9ca3af",
    border: "#344054",
    error: "#fda29b",
    success: "#75e0a7",
    warning: "#fec84b",
    info: "#84caff",
  },
} as const;
export type ThemePalette = Readonly<Record<keyof typeof DEFAULT_THEME_PALETTES.light, string>>;
export interface ResolvedTheme {
  readonly default: "light" | "dark" | "system";
  readonly light: ThemePalette;
  readonly dark: ThemePalette;
}
export function resolveTheme(
  theme: z.infer<typeof FrontendThemeSchema> | undefined,
): ResolvedTheme {
  const overrides = (mode: "light" | "dark") =>
    Object.fromEntries(
      Object.entries(theme?.[mode] ?? {}).filter(([, color]) => color !== undefined),
    );
  return {
    default: theme?.default ?? "system",
    light: { ...DEFAULT_THEME_PALETTES.light, ...overrides("light") },
    dark: { ...DEFAULT_THEME_PALETTES.dark, ...overrides("dark") },
  };
}
