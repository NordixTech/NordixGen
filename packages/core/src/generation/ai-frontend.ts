import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import { chatUiSource, chatUiStyles } from "./ai-chat-ui.js";
import { portalUiSource, portalUiStyles } from "./ai-portal-ui.js";

export function frontendAiFiles(context: FrontendRenderContext): GeneratedFile[] {
  const ai = context.frontend.ai;
  if (!ai) return [];
  const root = context.framework.codeRoot;
  const base = `/api/backend/${ai.backend}`;
  return [
    ...(ai.chat.enabled || ai.connectPortal.enabled
      ? [
          {
            path: `${root}/components/ai/ai.css`,
            content: aiStyles + chatUiStyles + portalUiStyles,
          },
        ]
      : []),
    ...(ai.chat.enabled
      ? [
          {
            path: `${root}/app/api/chat/route.ts`,
            content: `import {proxyBackend} from "@/lib/backend/transport";
export const dynamic="force-dynamic";
export async function POST(request:Request){return proxyBackend(${JSON.stringify(ai.backend)},request,"/api/chat");}
`,
          },
          {
            path: `${root}/components/ai/assistant-chat.tsx`,
            content: chatUiSource.replaceAll("__AI_BASE__", base),
          },
          ...(ai.chat.placement === "page"
            ? [
                {
                  path: `${root}/app/chat/page.tsx`,
                  content:
                    'import {AssistantChat} from "@/components/ai/assistant-chat";\nexport default function ChatPage(){return <main className="ng-ai-page"><p className="ng-ai-eyebrow">YOUR WORKSPACE ASSISTANT</p><h1>How can I help?</h1><p className="ng-ai-lede">Explore your records and take action with your current permissions.</p><AssistantChat/></main>;}\n',
                },
              ]
            : []),
        ]
      : []),
    ...(ai.connectPortal.enabled
      ? [
          {
            path: `${root}/components/ai/connect-portal.tsx`,
            content: portalUiSource.replaceAll("__AI_BASE__", base),
          },
          {
            path: `${root}/app/connect-ai/page.tsx`,
            content:
              'import {ConnectPortal} from "@/components/ai/connect-portal";\nexport default function ConnectAiPage(){return <main className="ng-ai-page"><p className="ng-ai-eyebrow">CONNECTED TO YOUR WORKSPACE</p><h1>Connect your AI</h1><p className="ng-ai-lede">Bring your preferred assistant. You stay in control of what it can access.</p><ConnectPortal/></main>;}\n',
          },
        ]
      : []),
  ];
}
const aiStyles = `.ng-ai-page{width:min(960px,calc(100% - 40px));margin:48px auto 72px;color:var(--color-foreground)}
.ng-ai-eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--color-primary);margin:0 0 12px}.ng-ai-page>h1{font-size:32px;font-weight:700;letter-spacing:-.035em;line-height:1.2;margin:0 0 12px}.ng-ai-lede{color:var(--color-muted);line-height:1.7;margin:0 0 30px;max-width:680px}
.ng-ai-chat,.ng-ai-portal{border:1px solid var(--color-border);border-radius:18px;background:var(--color-surface);padding:28px;box-shadow:0 6px 24px color-mix(in srgb,var(--color-foreground) 3%,transparent);font-size:14px;line-height:1.65}
.ng-ai-portal{display:grid;gap:20px}.ng-ai-portal h2,.ng-ai-empty h2{font-size:19px;font-weight:650;margin:0 0 8px;letter-spacing:-.02em}.ng-ai-portal h3{font-size:14px;font-weight:650;margin:24px 0 10px}.ng-ai-portal p,.ng-ai-empty p{color:var(--color-muted);margin:0 0 20px}.ng-ai-portal label,.ng-ai-chat form label{display:block;font-size:12px;font-weight:600;margin:0 0 8px}
.ng-ai-portal input:not([type=checkbox]),.ng-ai-chat textarea{display:block;width:100%;border:1px solid var(--color-border);border-radius:9px;background:var(--color-background);color:var(--color-foreground);padding:11px 13px;font:inherit;margin-top:7px}.ng-ai-portal input[readonly]{font-family:ui-monospace,monospace;font-size:12px}.ng-ai-chat textarea{resize:vertical;min-height:88px;margin-bottom:12px}
.ng-ai-chat button,.ng-ai-portal button,.ng-ai-floating>button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 15px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-background);color:var(--color-foreground);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s;margin-right:8px}.ng-ai-chat button:hover,.ng-ai-portal button:hover{background:color-mix(in srgb,var(--color-primary) 8%,var(--color-surface))}.ng-ai-chat button:disabled,.ng-ai-portal button:disabled{opacity:.5;cursor:not-allowed}.ng-ai-chat button:focus-visible,.ng-ai-portal button:focus-visible,.ng-ai-chat textarea:focus-visible,.ng-ai-portal input:focus-visible{outline:3px solid var(--color-focus);outline-offset:3px}
.ng-ai-chat form>button,.ng-ai-portal form>button,.ng-ai-floating>button{background:var(--color-primary);color:var(--color-primary-foreground);border-color:var(--color-primary)}.ng-ai-chat form>button:hover,.ng-ai-portal form>button:hover{background:var(--color-primary-hover)}.ng-ai-tabs{display:flex;gap:6px;padding-bottom:20px;border-bottom:1px solid var(--color-border);flex-wrap:wrap}.ng-ai-tabs button[aria-pressed=true]{background:color-mix(in srgb,var(--color-primary) 9%,var(--color-surface));color:var(--color-primary);border-color:color-mix(in srgb,var(--color-primary) 25%,var(--color-border))}
.ng-ai-portal form{display:grid;gap:12px;margin:22px 0}.ng-ai-portal fieldset{border:1px solid var(--color-border);padding:12px 16px;border-radius:9px}.ng-ai-portal legend{font-size:11px;font-weight:650;color:var(--color-muted);padding:0 6px}.ng-ai-portal input[type=checkbox]{accent-color:var(--color-primary);margin-right:9px}.ng-ai-portal ul{padding-left:20px;color:var(--color-muted)}.ng-ai-portal li{margin-bottom:10px}.ng-ai-portal pre,.ng-ai-chat pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.7;padding:18px;border-radius:10px;background:var(--color-background);border:1px solid var(--color-border);margin:16px 0}
.ng-ai-log{max-height:56vh;overflow-y:auto;display:grid;gap:16px;margin-bottom:22px}.ng-ai-log:empty{display:none}.ng-ai-message{padding:16px 18px;border:1px solid var(--color-border);border-radius:12px;overflow-wrap:anywhere}.ng-ai-message[data-role=user]{background:color-mix(in srgb,var(--color-primary) 5%,var(--color-surface))}.ng-ai-message>strong{display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px}.ng-ai-message p{margin:0}.ng-ai-empty{padding:36px 24px 44px;text-align:center}.ng-ai-empty>span{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:14px;color:var(--color-primary);background:color-mix(in srgb,var(--color-primary) 9%,var(--color-surface));font-size:25px;margin-bottom:16px}.ng-ai-empty p{max-width:370px;margin:auto}.ng-ai-error{border:1px solid color-mix(in srgb,var(--color-error) 25%,var(--color-border));background:color-mix(in srgb,var(--color-error) 5%,var(--color-surface));color:var(--color-error);padding:14px 16px;border-radius:10px;margin:16px 0;overflow-wrap:anywhere}.ng-ai-approval{padding:16px;border:1px solid var(--color-border);border-radius:10px;margin-top:12px}.ng-ai-floating{position:fixed;bottom:20px;right:20px;z-index:40;max-width:min(440px,calc(100vw - 32px))}.ng-ai-floating>button{margin:0;box-shadow:0 4px 18px color-mix(in srgb,var(--color-foreground) 15%,transparent)}.ng-ai-floating .ng-ai-chat{margin-top:10px;max-height:75vh;overflow:auto;padding:20px}.ng-ai-floating .ng-ai-empty{padding:20px 8px}
@media(max-width:600px){.ng-ai-page{margin-top:28px;width:calc(100% - 24px)}.ng-ai-page>h1{font-size:27px}.ng-ai-chat,.ng-ai-portal{padding:18px;border-radius:12px}.ng-ai-tabs{gap:4px}.ng-ai-tabs button{margin-right:0}.ng-ai-portal pre{padding:12px}.ng-ai-log{max-height:45vh}}
`;
