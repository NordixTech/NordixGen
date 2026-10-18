import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";

function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

function zustandUiStore(): string {
  return source([
    '"use client";',
    "",
    'import { create } from "zustand";',
    "",
    "export interface UiToast {",
    "  id: string;",
    "  message: string;",
    '  tone: "status" | "alert";',
    "}",
    "",
    "export interface UiStore {",
    "  toasts: readonly UiToast[];",
    "  modal: string | null;",
    '  notify: (message: string, tone?: UiToast["tone"]) => void;',
    "  dismissToast: (id: string) => void;",
    "  openModal: (id: string) => void;",
    "  closeModal: () => void;",
    "}",
    "",
    "export const useUIStore = create<UiStore>((set) => ({",
    "  toasts: [],",
    "  modal: null,",
    '  notify: (message, tone = "status") =>',
    "    set((state) => ({",
    "      toasts: [...state.toasts, { id: crypto.randomUUID(), message, tone }],",
    "    })),",
    "  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),",
    "  openModal: (id) => set({ modal: id }),",
    "  closeModal: () => set({ modal: null }),",
    "}));",
  ]);
}

function zustandToaster(): string {
  return source([
    '"use client";',
    "",
    'import { useUIStore } from "@/stores/ui-store";',
    "",
    "export function Toaster() {",
    "  const toasts = useUIStore((state) => state.toasts);",
    "  const dismissToast = useUIStore((state) => state.dismissToast);",
    "  return (",
    '    <div aria-live="polite" className="ng-toaster">',
    "      {toasts.map((toast) => (",
    '        <p className={"ng-notice ng-notice--" + toast.tone} key={toast.id} role={toast.tone === "alert" ? "alert" : "status"}>',
    "          <span>{toast.message}</span>",
    '          <button aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)} type="button">×</button>',
    "        </p>",
    "      ))}",
    "    </div>",
    "  );",
    "}",
  ]);
}

export function generateClientStateFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const files = [
    { path: `${root}/stores/ui-store.ts`, content: zustandUiStore() },
    { path: `${root}/components/ui/toaster.tsx`, content: zustandToaster() },
  ];
  return files;
}
