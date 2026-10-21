# AI playground

Runnable generated application with a notes module, Groq chat, explicit approval for chat writes, and MCP over an independent gateway. Requires Node 24+, pnpm 10.5.2 and running Docker Desktop.

From the NordixGen repository in PowerShell:

```powershell
& .\examples\ai-playground\Set-GroqKey.ps1
& .\examples\ai-playground\Start.ps1
```

The first command prompts without echoing the key and stores it in ignored `tmp/ai-playground.env`. Never paste the key in chat or commit it. The generated project is also ignored, at `tmp/ai-playground-current`. Running `Start.ps1` again applies changed credentials. The default model is `openai/gpt-oss-20b`; change it with `Set-GroqKey.ps1 -Model 'openai/gpt-oss-120b'` if available to your Groq account. Provider selection remains OpenAI, Anthropic, Gemini, then Groq; this example configures only Groq.

Open http://localhost:3100 and register an account. New accounts receive the `reader` role and can query notes. The demo also defines `editor`, with both `notes:read` and `notes:write`. With the editor account, use `/chat` and try “Crea una nota titulada Prueba MCP con contenido Hola desde Groq”; approve the requested write, then ask “Lista las notas”. Notes are shared demo records; chat histories remain private per account. Data persists in the local Docker volume.

Conversations are saved privately per account in SQL and survive reloads. Use the history panel to switch, create or delete chats. Markdown tables render normally and completed tool results remain collapsed until expanded. To test multiple approvals, ask “Crea tres notas: desayuno, almuerzo y cena”. Each mutation pauses for approval before execution. The generated frontend now uses supported Next.js 16.

At http://localhost:3100/connect-ai generate a personal API key with the desired notes permissions and copy the connection configuration into your MCP client. The endpoint is http://localhost:8791/mcp; OAuth is available through the same gateway. MCP writes require `confirm: true`, with interactive approval delegated to the client. The Groq key and MCP personal key are separate credentials.

OAuth is recommended for ChatGPT and Codex: connect from the target client, sign in, then approve access. The connection portal gives separate instructions for each client. API keys also work as `Authorization: Bearer <key>` for clients with bearer-token support. A desktop-only plugin does not automatically become available in ChatGPT web; install and connect a supported remote MCP plugin on the target surface.

Production OAuth was confirmed with Codex/ChatGPT in the browser and Claude in the browser. Codex PC connected successfully through `codex mcp add nordix --url <public-mcp-url>` and its native loopback OAuth callback. The separate desktop Plugins onboarding flow still returned issuer/state errors after browser authorization; its investigation, attempted fixes and evidence limits are tracked in [#120](https://github.com/NordixTech/NordixGen/issues/120). Native CLI success does not establish that Plugins onboarding works.

The opt-in `seed-users.mjs` script provisions `reader@nordix.test` / `DemoReader123!` and `editor@nordix.test` / `DemoEditor123!`. Run it from the generated repository with `NORDIX_DEMO_SEED=true`, `DEMO_APP_URL` and `DATABASE_URL` explicitly set, after migrations. It does not create administrators or change existing passwords. These known-password accounts are exclusively for this public demonstration; they are never part of the generator's normal production seed.

Local email capture is at http://localhost:8026. The backend has no published host port. Ports: frontend 3100, MCP 8791, PostgreSQL 55433, mail 8026.

```powershell
& .\examples\ai-playground\Stop.ps1
```

Stopping preserves notes and accounts. This is a local demo; do not reuse its development database/authentication secrets in production.
