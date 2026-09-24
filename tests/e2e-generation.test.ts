import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNordixConfig } from '../src/core/schema/parser.js';
import { generateProject } from '../src/generators/index.js';

describe('End-to-End Project Generation', () => {
  const testOutputDir = resolve(tmpdir(), `nordixgen-test-${Date.now()}`);

  afterEach(async () => {
    await fs.remove(testOutputDir);
  });

  it('should generate a complete Golden Path project on disk', async () => {
    const yaml = `
name: saas-platform
version: 1.0.0
structure: monorepo

frontend:
  framework: nextjs
  styling: tailwind
backend:
  framework: hono
  architecture: clean
database:
  engine: postgres
  orm: drizzle

docker:
  postgres: true
  mailpit: true
  minio: true

llm:
  enabled: true
  exposeUseCases: true

enums:
  UserRole: [ADMIN, MEMBER, VIEWER]

entities:
  User:
    fields:
      email:
        type: string
        unique: true
      role:
        type: enum
        enumName: UserRole
    softDelete: true
  Organization:
    fields:
      name:
        type: string
    relations:
      owner:
        type: many-to-one
        target: User
    softDelete: true
`;

    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const result = await generateProject(parseRes.data!, {
      targetDirectory: testOutputDir,
      git: false,
    });

    expect(result.success).toBe(true);
    expect(result.fileCount).toBeGreaterThan(15);
    expect(result.errors.length).toBe(0);

    // Verify key files created on physical disk
    expect(await fs.pathExists(resolve(testOutputDir, 'docker-compose.yml'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, '.env'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'package.json'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'pnpm-workspace.yaml'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'README.md'))).toBe(true);

    // Backend files
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/api/package.json'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/api/wrangler.jsonc'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/api/src/db/schema.ts'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/api/src/db/seed.ts'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/api/src/modules/agent/tools.ts'))).toBe(
      true,
    );

    // Frontend files
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/web/package.json'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/web/src/app/globals.css'))).toBe(true);
    expect(await fs.pathExists(resolve(testOutputDir, 'apps/web/src/lib/api.ts'))).toBe(true);

    // Check content of generated schema
    const schemaContent = await fs.readFile(
      resolve(testOutputDir, 'apps/api/src/db/schema.ts'),
      'utf-8',
    );
    expect(schemaContent).toContain("export const users = pgTable('users'");
    expect(schemaContent).toContain("export const organizations = pgTable('organizations'");
    expect(schemaContent).toContain("export const UserRoleEnum = pgEnum('userrole'");
  });
});
