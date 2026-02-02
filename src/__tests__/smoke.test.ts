import { describe, it, expect } from 'vitest';

describe('Vitest Setup', () => {
  it('works correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('handles async tests', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });

  it('supports matchers', () => {
    expect({ a: 1 }).toEqual({ a: 1 });
    expect([1, 2, 3]).toContain(2);
    expect('hello world').toMatch(/world/);
  });
});
