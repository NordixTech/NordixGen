# Themes

Each frontend supports Light, Dark and System modes. Configure semantic colors rather than styling each generated feature separately.

Place `theme` on a frontend:

```yaml
theme:
  default: system
  light:
    primary: "#155eef"
    secondary: "#475467"
    background: "#f8fafc"
    surface: "#ffffff"
    foreground: "#101828"
    muted: "#667085"
    border: "#e4e7ec"
  dark:
    success: "#75e0a7"
```

## Palette rules

For each mode independently, provide all seven main colors or omit them all: `primary`, `secondary`, `background`, `surface`, `foreground`, `muted`, `border`.

Omitted main palettes use Nordix defaults. Status tokens `error`, `success`, `warning` and `info` are optional individually and use their mode's defaults when absent. The example customizes the light palette and only the dark success color.

Colors accept literal hex, RGB/RGBA and HSL/HSLA values. Quote hex strings in YAML. Named colors, CSS variables and arbitrary expressions are not accepted configuration values.

## Runtime behavior

The topbar exposes Light/Dark/System controls. The selection is stored as `nordix-theme`; a saved preference overrides the configured default. System mode follows OS changes, including live changes. Missing or unavailable storage falls back to the configured default.

Theme is UI state, independent of sessions. CSS variables and Tailwind tokens drive business, authentication and administration screens. After generation, edit `src/styles/theme.css` and components for further customization.

Check contrast in both modes, especially with transparent colors. Custom palettes do not receive a guarantee of accessible contrast. Arbitrary runtime palette editing is not generated.
