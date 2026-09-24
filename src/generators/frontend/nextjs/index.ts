import type { NordixIr } from '../../../core/ir/types.js';
import type { VirtualFileSystem } from '../../../core/vfs/index.js';

export function generateNextjsFrontend(
  ir: NordixIr,
  vfs: VirtualFileSystem,
  basePath = 'apps/web',
): void {
  const prefix = basePath ? `${basePath}/` : '';

  // 1. package.json
  vfs.write(
    `${prefix}package.json`,
    JSON.stringify(
      {
        name: `${ir.projectName}-web`,
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'next lint',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          clsx: '^2.1.1',
          'lucide-react': '^0.475.0',
          next: '^15.1.7',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'tailwind-merge': '^3.0.1',
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.0.7',
          '@types/node': '^22.13.5',
          '@types/react': '^19.0.10',
          '@types/react-dom': '^19.0.4',
          postcss: '^8.5.2',
          tailwindcss: '^4.0.7',
          typescript: '^5.7.3',
        },
      },
      null,
      2,
    ),
  );

  // 2. tsconfig.json
  vfs.write(
    `${prefix}tsconfig.json`,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: {
            '@/*': ['./src/*'],
          },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    ),
  );

  // 3. next.config.ts
  vfs.write(
    `${prefix}next.config.ts`,
    `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Cloudflare Pages / Edge deployment optimizations
  },
};

export default nextConfig;
`,
  );

  // 4. postcss.config.mjs (Tailwind v4)
  vfs.write(
    `${prefix}postcss.config.mjs`,
    `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`,
  );

  // 5. globals.css (Tailwind CSS v4 with custom theme tokens)
  vfs.write(
    `${prefix}src/app/globals.css`,
    `@import "tailwindcss";

:root {
  --background: #f8fafc;
  --foreground: #0f172a;
  --primary: #0284c7;
  --primary-hover: #0369a1;
  --card: #ffffff;
  --card-border: #e2e8f0;
  --muted: #64748b;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #090d16;
    --foreground: #f8fafc;
    --primary: #38bdf8;
    --primary-hover: #0284c7;
    --card: #131b2e;
    --card-border: #1e293b;
    --muted: #94a3b8;
  }
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  margin: 0;
  padding: 0;
}
`,
  );

  // 6. Typed API Client (src/lib/api.ts) with RFC 7807 support
  vfs.write(
    `${prefix}src/lib/api.ts`,
    `export interface ApiProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}

export class ApiException extends Error {
  constructor(public problem: ApiProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiException';
  }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', \`Bearer \${token}\`);
  }

  const response = await fetch(\`\${API_BASE_URL}\${endpoint}\`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({
      title: 'Request Failed',
      detail: response.statusText,
      status: response.status,
      type: 'about:blank',
    }))) as ApiProblemDetails;
    throw new ApiException(errorBody);
  }

  return response.json() as Promise<T>;
}
`,
  );

  // 7. Root Layout with Sidebar (src/app/layout.tsx)
  const navLinks = Object.values(ir.entities)
    .map(
      (
        e,
      ) => `            <a href="/${e.tableName}" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <span>📦</span>
              <span>${e.name}s</span>
            </a>`,
    )
    .join('\n');

  vfs.write(
    `${prefix}src/app/layout.tsx`,
    `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${ir.projectName} - Console',
  description: 'Generated by NordixGen with Next.js and Tailwind CSS v4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between shrink-0">
          <div className="space-y-4">
            <div className="px-3 py-2">
              <span className="text-xl font-bold tracking-tight text-sky-600 dark:text-sky-400">⚡ ${ir.projectName}</span>
              <p className="text-xs text-slate-500 mt-1">NordixGen Platform</p>
            </div>
            <nav className="space-y-1">
              <a href="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <span>📊</span>
                <span>Dashboard</span>
              </a>
${navLinks}
            </nav>
          </div>
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
            Cloudflare Edge Ready
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-8 flex items-center justify-between">
            <h1 className="text-sm font-medium text-slate-500">Workspace / Overview</h1>
            <div className="flex items-center gap-4">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Edge API Connected</span>
            </div>
          </header>
          <div className="p-8 flex-1">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
`,
  );

  // 8. Home Page (src/app/page.tsx)
  const entityCards = Object.values(ir.entities)
    .map(
      (
        e,
      ) => `          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">${e.name}s</h3>
            <p className="text-sm text-slate-500 mt-1">Manage ${e.name.toLowerCase()} catalog and records</p>
            <div className="mt-4 flex justify-between items-center">
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full">Active</span>
              <a href="/${e.tableName}" className="text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400">View Catalog →</a>
            </div>
          </div>`,
    )
    .join('\n');

  vfs.write(
    `${prefix}src/app/page.tsx`,
    `export default function HomePage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome to ${ir.projectName}</h2>
        <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">Full-stack project generated with Next.js, Tailwind CSS v4, Hono and Drizzle ORM.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
${entityCards}
      </div>
    </div>
  );
}
`,
  );

  // 9. Generate Entity Data Table Pages (src/app/[entity]/page.tsx)
  for (const entity of Object.values(ir.entities)) {
    const fields = Object.values(entity.fields).filter((f) => !f.isSystemAudit);
    const tableHeaders = fields
      .map(
        (f) =>
          `<th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">${f.name}</th>`,
      )
      .join('\n                  ');

    vfs.write(
      `${prefix}src/app/${entity.tableName}/page.tsx`,
      `'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ${entity.name}sPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ data: any[] }>('/api/${entity.tableName}')
      .then((res) => setItems(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">${entity.name} Management</h2>
          <p className="text-slate-500 text-sm mt-1">Manage all ${entity.name.toLowerCase()} items synchronized with PostgreSQL</p>
        </div>
        <button className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium rounded-lg transition-colors shadow-xs">
          + New ${entity.name}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
            <tr>
              ${tableHeaders}
              <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={${fields.length + 1}} className="px-4 py-8 text-center text-slate-400">
                  Loading records from Cloudflare Edge...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={${fields.length + 1}} className="px-4 py-8 text-center text-slate-400">
                  No ${entity.name.toLowerCase()} records found. Run \`pnpm db:seed\` to generate mock data.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  ${fields.map((f) => `<td className="px-4 py-3 text-slate-800 dark:text-slate-200">{String(item.${f.name} ?? '')}</td>`).join('\n                  ')}
                  <td className="px-4 py-3 text-right">
                    <button className="text-xs text-sky-600 hover:text-sky-700 font-medium mr-3">Edit</button>
                    <button className="text-xs text-rose-600 hover:text-rose-700 font-medium">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`,
    );
  }
}
