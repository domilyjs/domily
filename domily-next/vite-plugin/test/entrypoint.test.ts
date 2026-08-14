import { describe, expect, test } from 'bun:test';

import domilyNext, { domilyNext as namedDomilyNext } from '../src/index.ts';

describe('@domily/next-vite-plugin', () => {
  test('owns the Vite plugin factory', () => {
    expect(domilyNext).toBe(namedDomilyNext);
    expect(namedDomilyNext().name).toBe('vite:domily-next');
  });
});
