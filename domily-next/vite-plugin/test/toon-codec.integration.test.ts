import { describe, expect, test } from 'bun:test';

import { createToonSourceCodecRegistry } from '../../codec-toon/src/index.ts';
import {
  DomilyVitePageError,
  domilyNext,
} from '../src/index.ts';

const fixture = await Bun.file(new URL('../../codec-toon/test/fixtures/todo.dmy.toon', import.meta.url)).text();

describe('Domily Next Vite plugin with the official TOON codec', () => {
  test('loads .dmy.toon through an application-injected codec, not a Vite dependency', () => {
    const transformed = domilyNext({ codecs: createToonSourceCodecRegistry() })
      .transform(fixture, '/src/todo.dmy.toon?domily=page');

    expect(transformed?.code).toContain('const page = JSON.parse(');
    expect(transformed?.code).toContain('json-todo');
    expect(transformed?.code).toContain('export default page;');
  });

  test('preserves the official decoder line while adapting its column to Vite', () => {
    const plugin = domilyNext({ codecs: createToonSourceCodecRegistry() });
    try {
      plugin.transform('items[2]:\n  - one', '/src/bad.dmy.toon');
      throw new Error('Expected malformed TOON to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(DomilyVitePageError);
      expect(error).toMatchObject({
        code: 'toon.syntax',
        id: '/src/bad.dmy.toon',
        loc: { column: 0, file: '/src/bad.dmy.toon', line: 2 },
      });
    }
  });
});
