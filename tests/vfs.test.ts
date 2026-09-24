import { beforeEach, describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../src/core/vfs/index.js';

describe('VirtualFileSystem (VFS)', () => {
  let vfs: VirtualFileSystem;

  beforeEach(() => {
    vfs = new VirtualFileSystem();
  });

  it('should stage and retrieve files', () => {
    vfs.write('apps/api/src/index.ts', 'console.log("hello");');
    expect(vfs.exists('apps/api/src/index.ts')).toBe(true);
    expect(vfs.read('apps/api/src/index.ts')).toBe('console.log("hello");');
  });

  it('should normalize Windows backslashes and leading slashes', () => {
    vfs.write('\\apps\\web\\page.tsx', '<h1>Home</h1>');
    expect(vfs.exists('apps/web/page.tsx')).toBe(true);
    expect(vfs.read('/apps/web/page.tsx')).toBe('<h1>Home</h1>');
  });

  it('should merge JSON safely', () => {
    vfs.write('package.json', JSON.stringify({ name: 'my-app', dependencies: { hono: '4.0.0' } }));

    vfs.mergeJson('package.json', (prev) => {
      const deps = (prev.dependencies as Record<string, string>) || {};
      return {
        ...prev,
        dependencies: {
          ...deps,
          'drizzle-orm': '0.38.0',
        },
        scripts: {
          dev: 'wrangler dev',
        },
      };
    });

    const parsed = JSON.parse(vfs.read('package.json')!);
    expect(parsed.name).toBe('my-app');
    expect(parsed.dependencies.hono).toBe('4.0.0');
    expect(parsed.dependencies['drizzle-orm']).toBe('0.38.0');
    expect(parsed.scripts.dev).toBe('wrangler dev');
  });
});
