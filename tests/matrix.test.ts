import { describe, expect, it } from 'vitest';
import { checkCompatibility } from '../src/core/matrix/compatibility.js';
import { parseNordixConfig } from '../src/core/schema/parser.js';

describe('Compatibility Matrix Engine', () => {
  it('should identify the Golden Path correctly', () => {
    const yaml = `
name: golden-app
frontend:
  framework: nextjs
  styling: tailwind
backend:
  framework: hono
database:
  engine: postgres
  orm: drizzle
deployment:
  provider: cloudflare
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const check = checkCompatibility(parseRes.data!);
    expect(check.isValid).toBe(true);
    expect(check.status).toBe('golden-path');
    expect(check.errors.length).toBe(0);
  });

  it('should reject EF Core with non-dotnet backends', () => {
    const yaml = `
name: invalid-app
backend:
  framework: hono
database:
  engine: postgres
  orm: efcore
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const check = checkCompatibility(parseRes.data!);
    expect(check.isValid).toBe(false);
    expect(check.status).toBe('incompatible');
    expect(check.errors[0]).toContain("EF Core ORM is only compatible with the '.NET'");
  });

  it('should reject Drizzle with MongoDB', () => {
    const yaml = `
name: mongo-app
backend:
  framework: hono
database:
  engine: mongodb
  orm: drizzle
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const check = checkCompatibility(parseRes.data!);
    expect(check.isValid).toBe(false);
    expect(check.errors[0]).toContain('Drizzle ORM does not support MongoDB');
  });

  it('should warn about Prisma bundle size on Cloudflare Workers', () => {
    const yaml = `
name: prisma-cloudflare-app
backend:
  framework: hono
database:
  engine: postgres
  orm: prisma
deployment:
  provider: cloudflare
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const check = checkCompatibility(parseRes.data!);
    expect(check.isValid).toBe(true);
    expect(check.warnings.some((w) => w.includes('Prisma on Cloudflare Workers'))).toBe(true);
  });
});
