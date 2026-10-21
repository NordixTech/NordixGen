import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { ColorSchema, FrontendThemeSchema, THEME_MAIN_COLORS } from "../src/configuration/theme.js";
import { parseNordixYaml, validateNordixConfig } from "../src/configuration/validate.js";
import { frontendRenderContext, generateFrontend } from "../src/generation/frontend.js";
import { createNordixJsonSchema } from "../src/json-schema.js";
import { generateThemeFiles, themeInitializationScript } from "../src/plugins/frontends/theme.js";
import { contrastingText, rgba, themeTokens } from "../src/plugins/styling/theme-tokens.js";
import { DEFAULT_THEME_PALETTES, resolveTheme } from "../src/project/theme.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { frontendRuntime } from "./frontend-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

describe("frontend theme configuration", () => {
  it("defaults palettes independently and fills only omitted status colors", () => {
    expect(resolveTheme(undefined)).toEqual({ default: "system", ...DEFAULT_THEME_PALETTES });
    expect(
      resolveTheme(
        FrontendThemeSchema.parse({ light: { error: undefined }, dark: { info: undefined } }),
      ),
    ).toEqual({ default: "system", ...DEFAULT_THEME_PALETTES });
    for (const mode of ["light", "dark"] as const) {
      for (const palette of [undefined, {}, { error: "#123" }, DEFAULT_THEME_PALETTES[mode]]) {
        const parsed = FrontendThemeSchema.parse({ [mode]: palette });
        const theme = resolveTheme(parsed);
        expect(theme[mode]).toEqual({ ...DEFAULT_THEME_PALETTES[mode], ...palette });
        expect(theme[mode === "light" ? "dark" : "light"]).toEqual(
          DEFAULT_THEME_PALETTES[mode === "light" ? "dark" : "light"],
        );
      }
      for (const missing of THEME_MAIN_COLORS) {
        const partial: Record<string, string> = { ...DEFAULT_THEME_PALETTES[mode] };
        delete partial[missing];
        expect(FrontendThemeSchema.safeParse({ [mode]: partial }).success).toBe(false);
      }
      for (const only of THEME_MAIN_COLORS)
        expect(FrontendThemeSchema.safeParse({ [mode]: { [only]: "#123" } }).success).toBe(false);
    }
    expect(FrontendThemeSchema.safeParse({ default: "automatic" }).success).toBe(false);
    expect(FrontendThemeSchema.safeParse({ light: { typo: "#123" } }).success).toBe(false);
    expect(FrontendThemeSchema.safeParse({ light: null }).success).toBe(false);
  });
  it.each([
    "#123",
    "#1234",
    "#abcdef",
    "#abcdef80",
    "rgb(0, 128, 255)",
    "rgba(1,2,3,0.5)",
    "rgb(10%, 20%, 100%)",
    "rgb(1 2 3 / 50%)",
    "rgb(.5 255.0 10%)",
    "hsl(240, 100%, 50%)",
    "hsl(-30deg 20% 30% / .5)",
    "hsla(120, 50%, 50%, 25%)",
  ])("accepts literal %s", (color) => {
    expect(ColorSchema.safeParse(color).success).toBe(true);
    expect(rgba(color).every(Number.isFinite)).toBe(true);
  });
  it.each([
    "red",
    "var(--primary)",
    "#12",
    "#gggggg",
    "rgb(256, 0, 0)",
    "rgb(-1 0 0)",
    "rgb(1, 2%, 3)",
    "rgb(0 0 0 / 2)",
    "rgb(101% 0% 0%)",
    "hsl(0, 101%, 50%)",
    "hsl(0 50% -1%)",
    "hsl(0 50% 50% / 101%)",
    "#fff; color:red",
    "</script>",
  ])("rejects invalid or unsafe %s", (color) =>
    expect(ColorSchema.safeParse(color).success).toBe(false),
  );
  it("reports palette and color diagnostics at YAML paths with source locations", () => {
    const config = targetConfig();
    Object.assign(config.frontends[0], { theme: { light: { primary: "#123" } } });
    const result = parseNordixYaml(stringify(config), "theme.yaml");
    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "frontends[0].theme.light",
          message: expect.stringContaining("all seven"),
          source: expect.objectContaining({ file: "theme.yaml" }),
        }),
      ]),
    );
    Object.assign(config.frontends[0], { theme: { dark: { error: "rgb(999 0 0)" } } });
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          path: "frontends[0].theme.dark.error",
          message: expect.stringContaining("literal"),
        }),
      ]),
    });
    Object.assign(config.frontends[0], { theme: { light: null } });
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          path: "frontends[0].theme.light",
          message: expect.stringContaining("all seven"),
        }),
      ],
    });
  });
  it("publishes the all-or-none palette rule in the editor schema and resolves immutable themes", () => {
    const schema = createNordixJsonSchema() as {
      properties: {
        frontends: {
          items: {
            properties: {
              theme: {
                properties: {
                  light: { anyOf: { required?: string[]; additionalProperties: boolean }[] };
                };
              };
            };
          };
        };
      };
    };
    const branches = schema.properties.frontends.items.properties.theme.properties.light.anyOf;
    expect(branches[0].required).toEqual([...THEME_MAIN_COLORS]);
    expect(branches.every((branch) => branch.additionalProperties === false)).toBe(true);
    const config = targetConfig();
    Object.assign(config.frontends[0], { theme: { default: "dark", light: { info: "#123" } } });
    const project = resolvedFixture(config);
    expect(project.frontends.web.theme.default).toBe("dark");
    expect(project.frontends.web.theme.light.info).toBe("#123");
    expect(Object.isFrozen(project.frontends.web.theme.light)).toBe(true);
  });
});

describe("generated semantic theme", () => {
  it.each(["light", "dark", "system"] as const)(
    "typechecks the generated store for default %s",
    async (mode) => {
      const config = targetConfig();
      Object.assign(config.frontends[0], { theme: { default: mode } });
      const files = generateThemeFiles(frontendRenderContext(resolvedFixture(config), "web"));
      const store = files.find((file) => file.path.endsWith("theme-store.ts"));
      expect(
        await generatedTypeErrors(
          { "theme-store.ts": store?.content ?? "" },
          {},
          {
            "zustand.d.ts": `declare module "zustand" { export function create<T>(initializer:(set:(partial:Partial<T>)=>void)=>T): { <U>(selector:(state:T)=>U):U; setState:(partial:Partial<T>)=>void; getState:()=>T; }; }`,
          },
        ),
      ).toEqual([]);
    },
    20_000,
  );
  it("derives contrast and channels for each supported literal family", () => {
    expect(rgba("#fff")).toEqual([1, 1, 1, 1]);
    expect(rgba("#0000")).toEqual([0, 0, 0, 0]);
    expect(rgba("#ff000080")[3]).toBeCloseTo(128 / 255);
    expect(rgba("rgb(100% 0% 0% / 50%)")).toEqual([1, 0, 0, 0.5]);
    expect(rgba("rgba(255,0,0,.5)")).toEqual([1, 0, 0, 0.5]);
    expect(rgba("hsl(120 100% 50%)")).toEqual([0, 1, 0, 1]);
    expect(rgba("hsl(-120deg 100% 50% / 25%)")).toEqual([0, 0, 1, 0.25]);
    expect(contrastingText("#000", "#fff")).toBe("#ffffff");
    expect(contrastingText("#fff", "#000")).toBe("#000000");
    expect(contrastingText("#0000", "#fff")).toBe("#000000");
  });
  it("emits complete tokens, early initialization and one shared shell for every page", () => {
    const project = resolvedFixture(targetConfig());
    const output = generateFrontend(project, "web").virtualFileSystem.snapshot();
    const css = output["apps/web/src/styles/theme.css"];
    for (const key of Object.keys(themeTokens(project.frontends.web.theme.light)))
      expect(css).toContain(`--color-${key}: var(--ng-${key})`);
    expect(css).toContain(':root[data-theme="system"]');
    expect(css).toContain('[data-theme="dark"]');
    expect(output["apps/web/src/app/globals.css"]).toContain("@theme inline");
    const layout = output["apps/web/src/app/layout.tsx"];
    expect(layout.indexOf("<script")).toBeLessThan(layout.indexOf("<body>"));
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain("<AppShell>");
    expect(output["apps/web/src/components/auth/auth-controls.tsx"]).toContain("<ThemeSwitcher/>");
    expect(output["apps/web/src/app/providers.tsx"]).toContain("useEffect(initializeTheme,[])");
    expect(output["apps/web/src/styles/ui.css"]).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(output["apps/web/src/styles/iam.css"]).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    for (const styles of [
      output["apps/web/src/styles/ui.css"],
      output["apps/web/src/styles/iam.css"],
    ]) {
      for (const reference of styles.matchAll(/var\(--color-([a-z-]+)\)/g))
        expect(themeTokens(project.frontends.web.theme.light)).toHaveProperty(reference[1]);
    }
  });
  it("initializes before paint from valid storage and survives unavailable or corrupted storage", () => {
    for (const saved of [null, "light", "dark", "system", "invalid", "throws"]) {
      const document = { documentElement: { dataset: {} as { theme?: string } } };
      new Function("document", "localStorage", themeInitializationScript("dark"))(document, {
        getItem() {
          if (saved === "throws") throw Error("blocked");
          return saved;
        },
      });
      expect(document.documentElement.dataset.theme).toBe(
        ["light", "dark", "system"].includes(saved ?? "") ? saved : "dark",
      );
    }
  });
  it("executes the generated store for selection, system changes, storage sync and cleanup", () => {
    const project = resolvedFixture(targetConfig());
    const files = Object.fromEntries(
      generateThemeFiles(frontendRenderContext(project, "web")).map((file) => [
        file.path,
        file.content,
      ]),
    );
    type State = { theme: string; resolvedTheme: string; setTheme: (theme: string) => void };
    const listeners: Record<string, (event?: unknown) => void> = {};
    const media = {
      matches: false,
      addEventListener: (_name: string, callback: () => void) => {
        listeners.media = callback;
      },
      removeEventListener: () => {
        Reflect.deleteProperty(listeners, "media");
      },
    };
    const dataset: Record<string, string | undefined> = { theme: "dark" };
    const saved: Record<string, string> = {};
    let blocked = false;
    const storage = {
      getItem: (key: string) => {
        if (blocked) throw Error("blocked");
        return saved[key] ?? null;
      },
      setItem: (key: string, value: string) => {
        if (blocked) throw Error("blocked");
        saved[key] = value;
      },
    };
    const load = frontendRuntime(
      files,
      "apps/web/src",
      {
        zustand: {
          create: (factory: (set: (value: Partial<State>) => void) => State) => {
            let state: State;
            const set = (value: Partial<State>) => {
              state = { ...state, ...value };
            };
            state = factory(set);
            return { getState: () => state, setState: set };
          },
        },
      },
      {
        document: { documentElement: { dataset } },
        localStorage: storage,
        window: {
          matchMedia: () => media,
          addEventListener: (key: string, callback: () => void) => {
            listeners[key] = callback;
          },
          removeEventListener: (key: string) => {
            delete listeners[key];
          },
        },
      },
    );
    const runtime = load("apps/web/src/stores/theme-store.ts") as {
      useTheme: { getState: () => State };
      initializeTheme: () => () => void;
    };
    const stop = runtime.initializeTheme();
    expect(dataset.themeReady).toBe("true");
    expect(runtime.useTheme.getState()).toMatchObject({ theme: "dark", resolvedTheme: "dark" });
    runtime.useTheme.getState().setTheme("system");
    expect(saved["nordix-theme"]).toBe("system");
    expect(runtime.useTheme.getState().resolvedTheme).toBe("light");
    media.matches = true;
    listeners.media();
    expect(runtime.useTheme.getState().resolvedTheme).toBe("dark");
    runtime.useTheme.getState().setTheme("light");
    listeners.media();
    expect(runtime.useTheme.getState().resolvedTheme).toBe("light");
    listeners.storage({ storageArea: storage, key: "nordix-theme", newValue: "dark" });
    expect(dataset.theme).toBe("dark");
    listeners.storage({ storageArea: storage, key: "other", newValue: "light" });
    listeners.storage({ storageArea: {}, key: "nordix-theme", newValue: "light" });
    expect(dataset.theme).toBe("dark");
    listeners.storage({ storageArea: storage, key: null, newValue: null });
    expect(dataset.theme).toBe("system");
    blocked = true;
    runtime.useTheme.getState().setTheme("dark");
    expect(dataset.theme).toBe("dark");
    stop();
    expect(listeners).toEqual({});
    expect(dataset.themeReady).toBeUndefined();
    dataset.theme = "invalid";
    runtime.initializeTheme()();
    expect(dataset.theme).toBe("system");
    blocked = false;
    saved["nordix-theme"] = "dark";
    runtime.initializeTheme()();
    expect(dataset.theme).toBe("dark");
  });
});
