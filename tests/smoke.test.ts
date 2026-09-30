import { describe, expect, it } from 'vitest';
import pkg from '@/package.json';

describe('project setup', () => {
  it('resolves the @/ alias to the repo root', () => {
    expect(pkg.name).toBe('frc-fantasy');
  });
});
