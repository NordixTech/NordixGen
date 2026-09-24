import { describe, expect, it } from 'vitest';
import { parseNordixConfig } from '../src/core/schema/parser.js';

describe('NordixConfig Schema & Parser', () => {
  it('should successfully parse a valid minimal configuration', () => {
    const yaml = `
name: my-app
version: 0.1.0
backend:
  framework: hono
  architecture: clean
frontend:
  framework: nextjs
  styling: tailwind
database:
  engine: postgres
  orm: drizzle
`;
    const result = parseNordixConfig(yaml);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.name).toBe('my-app');
    expect(result.data?.backend.framework).toBe('hono');
    expect(result.data?.frontend.framework).toBe('nextjs');
    expect(result.data?.database.orm).toBe('drizzle');
    expect(result.data?.docker.mailpit).toBe(true); // default value
    expect(result.data?.llm.enabled).toBe(true); // default value
  });

  it('should parse entities, fields, enums and relationships', () => {
    const yaml = `
name: ecommerce-api
enums:
  OrderStatus: [PENDING, PAID, SHIPPED, CANCELLED]
entities:
  User:
    name: User
    fields:
      email:
        type: string
        unique: true
      name:
        type: string
  Order:
    name: Order
    fields:
      total:
        type: number
      status:
        type: enum
        enumName: OrderStatus
    relations:
      user:
        type: many-to-one
        target: User
        onDelete: cascade
`;
    const result = parseNordixConfig(yaml);
    expect(result.success).toBe(true);
    expect(result.data?.entities.Order?.relations.user?.target).toBe('User');
    expect(result.data?.enums.OrderStatus).toContain('PAID');
  });

  it('should fail with readable error for invalid project name', () => {
    const yaml = `
name: "INVALID NAME WITH SPACES"
`;
    const result = parseNordixConfig(yaml);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]).toContain('Project name must contain only lowercase');
  });

  it('should fail if root is not an object', () => {
    const yaml = `
- item1
- item2
`;
    const result = parseNordixConfig(yaml);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('must be an object');
  });
});
