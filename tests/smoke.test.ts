import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('NordixGen Smoke Test', () => {
  it('should export the expected library version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
