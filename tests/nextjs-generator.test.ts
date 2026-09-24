import { describe, expect, it } from 'vitest';
import { buildNordixIr } from '../src/core/ir/builder.js';
import { parseNordixConfig } from '../src/core/schema/parser.js';
import { VirtualFileSystem } from '../src/core/vfs/index.js';
import { generateNextjsFrontend } from '../src/generators/frontend/nextjs/index.js';

describe('Next.js + Tailwind v4 Frontend Generator', () => {
  it('should generate a full Next.js App Router structure in VFS', () => {
    const yaml = `
name: storefront
frontend:
  framework: nextjs
  styling: tailwind
entities:
  Product:
    fields:
      title:
        type: string
      price:
        type: number
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const ir = buildNordixIr(parseRes.data!);
    const vfs = new VirtualFileSystem();
    generateNextjsFrontend(ir, vfs, 'apps/web');

    // Verify key files exist
    expect(vfs.exists('apps/web/package.json')).toBe(true);
    expect(vfs.exists('apps/web/tsconfig.json')).toBe(true);
    expect(vfs.exists('apps/web/next.config.ts')).toBe(true);
    expect(vfs.exists('apps/web/postcss.config.mjs')).toBe(true);
    expect(vfs.exists('apps/web/src/app/globals.css')).toBe(true);
    expect(vfs.exists('apps/web/src/lib/api.ts')).toBe(true);
    expect(vfs.exists('apps/web/src/app/layout.tsx')).toBe(true);
    expect(vfs.exists('apps/web/src/app/page.tsx')).toBe(true);
    expect(vfs.exists('apps/web/src/app/products/page.tsx')).toBe(true);

    // Verify Tailwind v4 imports
    const cssContent = vfs.read('apps/web/src/app/globals.css')!;
    expect(cssContent).toContain('@import "tailwindcss";');

    // Verify API client RFC 7807 support
    const apiContent = vfs.read('apps/web/src/lib/api.ts')!;
    expect(apiContent).toContain('interface ApiProblemDetails');
    expect(apiContent).toContain('class ApiException');
  });
});
