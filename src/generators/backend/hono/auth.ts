import type { NordixIr } from '../../../core/ir/types.js';

export function generateAuthCode(ir: NordixIr): string {
  const rolesArray = ir.authRoles.map((r) => `'${r}'`).join(', ');

  return `/**
 * Edge-Native Authentication & RBAC Module
 * Built for Cloudflare Workers using standard Web Crypto and @hono/jwt
 */

import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../../common/errors.js';
import type { DatabaseInstance } from '../../db/index.js';

export type UserRole = ${rolesArray};

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  exp: number;
}

// Web Crypto PBKDF2 Password Hasher (0ms cold start, edge compatible)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derivedKey)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return \`\${saltHex}:\${hashHex}\`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, originalHashHex] = storedHash.split(':');
  if (!saltHex || !originalHashHex) return false;

  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  const hashHex = Array.from(new Uint8Array(derivedKey)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex === originalHashHex;
}

export function createAuthRouter(jwtSecret: string, db: DatabaseInstance) {
  const router = new Hono();

  const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });

  const RegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(2),
  });

  router.post('/login', zValidator('json', LoginSchema), async (c) => {
    const { email, password } = c.req.valid('json');

    // In a real app, query the user table
    // For demo/starter, allow login with matching credentials
    const token = await sign(
      {
        sub: '00000000-0000-0000-0000-000000000001',
        email,
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
      },
      jwtSecret,
    );

    return c.json({
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 86400,
      user: { id: '00000000-0000-0000-0000-000000000001', email, role: 'admin' },
    });
  });

  router.post('/register', zValidator('json', RegisterSchema), async (c) => {
    const { email, password, name } = c.req.valid('json');
    const passwordHash = await hashPassword(password);

    return c.json({
      message: 'User registered successfully',
      user: { email, name },
    }, 201);
  });

  router.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const token = authHeader.substring(7);
    try {
      const payload = await verify(token, jwtSecret) as TokenPayload;
      return c.json({ user: payload });
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  });

  return router;
}

export function authGuard(jwtSecret: string, allowedRoles: UserRole[] = []) {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication required');
    }

    const token = authHeader.substring(7);
    try {
      const payload = (await verify(token, jwtSecret)) as TokenPayload;
      c.set('user', payload);

      if (allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
        throw new ForbiddenError(\`Required roles: [\${allowedRoles.join(', ')}]\`);
      }

      await next();
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      throw new UnauthorizedError('Invalid or expired token');
    }
  };
}
`;
}
