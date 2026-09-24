import { describe, expect, it } from 'vitest';
import { buildNordixIr } from '../src/core/ir/builder.js';
import { parseNordixConfig } from '../src/core/schema/parser.js';
import { VirtualFileSystem } from '../src/core/vfs/index.js';
import { generateHonoBackend } from '../src/generators/backend/hono/index.js';

describe('Hono Backend Generator', () => {
  it('should generate a full Hono + Drizzle + Neon backend structure in VFS', () => {
    const yaml = `
name: ecommerce
backend:
  framework: hono
  architecture: clean
database:
  engine: postgres
  orm: drizzle
entities:
  Product:
    fields:
      name:
        type: string
      price:
        type: number
      description:
        type: string
        required: false
  Category:
    fields:
      title:
        type: string
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const ir = buildNordixIr(parseRes.data!);
    const vfs = new VirtualFileSystem();
    generateHonoBackend(ir, vfs, 'apps/api');

    // Verify key files exist
    expect(vfs.exists('apps/api/package.json')).toBe(true);
    expect(vfs.exists('apps/api/wrangler.jsonc')).toBe(true);
    expect(vfs.exists('apps/api/drizzle.config.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/db/schema.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/db/seed.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/common/errors.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/common/error-handler.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/modules/auth/index.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/modules/agent/tools.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/modules/products/products.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/modules/categories/categories.ts')).toBe(true);
    expect(vfs.exists('apps/api/src/index.ts')).toBe(true);

    // Verify schema content
    const schemaContent = vfs.read('apps/api/src/db/schema.ts')!;
    expect(schemaContent).toContain("export const products = pgTable('products'");
    expect(schemaContent).toContain("export const categories = pgTable('categories'");
    expect(schemaContent).toContain("deletedAt: timestamp('deleted_at'");

    // Verify RFC 7807 content
    const errorContent = vfs.read('apps/api/src/common/errors.ts')!;
    expect(errorContent).toContain('interface ProblemDetails');
    expect(errorContent).toContain('class NotFoundError');

    // Verify Agent Tooling content
    const agentContent = vfs.read('apps/api/src/modules/agent/tools.ts')!;
    expect(agentContent).toContain('REGISTERED_USE_CASE_TOOLS');
    expect(agentContent).toContain('CreateProduct');
  });
});
