import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";

export function themeInitializationScript(defaultTheme: string): string {
  return `(()=>{let theme=${JSON.stringify(defaultTheme)};try{const saved=localStorage.getItem("nordix-theme");if(saved==="light"||saved==="dark"||saved==="system")theme=saved;}catch{}document.documentElement.dataset.theme=theme;})();`;
}

export function generateThemeFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  return [
    {
      path: `${root}/stores/theme-store.ts`,
      content: `"use client";
import {create} from "zustand";
export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
const defaultTheme:Theme=${JSON.stringify(context.frontend.theme.default)};
const valid=(value:unknown):value is Theme=>value==="light"||value==="dark"||value==="system";
const resolve=(theme:Theme):ResolvedTheme=>theme==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):theme;
interface ThemeState {theme:Theme;resolvedTheme:ResolvedTheme;setTheme:(theme:Theme)=>void}
export const useTheme=create<ThemeState>((set)=>({
  theme:defaultTheme,resolvedTheme:${JSON.stringify(context.frontend.theme.default === "dark" ? "dark" : "light")},
  setTheme(theme){
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem("nordix-theme",theme);}catch{}
    set({theme,resolvedTheme:resolve(theme)});
  },
}));
/** Called once by the shell, independently of the account-scoped query provider. */
export function initializeTheme(){
  const apply=(theme:Theme)=>{
    document.documentElement.dataset.theme=theme;
    useTheme.setState({theme,resolvedTheme:resolve(theme)});
  };
  const initial=document.documentElement.dataset.theme;
  apply(valid(initial)?initial:defaultTheme);
  const media=window.matchMedia("(prefers-color-scheme: dark)");
  const changed=()=>{if(useTheme.getState().theme==="system")apply("system");};
  const storage=(event:StorageEvent)=>{
    if(event.storageArea!==localStorage||event.key!==null&&event.key!=="nordix-theme")return;
    apply(valid(event.newValue)?event.newValue:defaultTheme);
  };
  media.addEventListener("change",changed);
  window.addEventListener("storage",storage);
  return ()=>{media.removeEventListener("change",changed);window.removeEventListener("storage",storage);};
}
`,
    },
    {
      path: `${root}/components/ui/theme-switcher.tsx`,
      content: `"use client";
import {useTheme} from "@/stores/theme-store";
const options=[{theme:"light",label:"Light",path:"M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0"},{theme:"dark",label:"Dark",path:"M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"},{theme:"system",label:"System",path:"M4 4h16v12H4zM8 20h8m-4-4v4"}] as const;
export function ThemeSwitcher(){
  const theme=useTheme(state=>state.theme);
  const setTheme=useTheme(state=>state.setTheme);
  return <div className="ng-theme-switcher bg-background text-muted border-border" role="group" aria-label="Color theme">{options.map(option=><button key={option.theme} type="button" aria-label={option.label+" theme"} title={option.label+" theme"} aria-pressed={theme===option.theme} onClick={()=>setTheme(option.theme)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={option.path}/></svg><span>{option.label}</span></button>)}</div>;
}
`,
    },
  ];
}
