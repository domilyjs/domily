import { describe, expect, test } from 'bun:test';

import { cloneSourceJson, SourceCodecValueError } from '../../src/codec/index.ts';

describe('source codec JSON values', () => {
  test('clones plain protocol values without retaining caller-owned containers', () => {
    const source = { nested: { values: [1, 'two', true, null] } };
    const cloned = cloneSourceJson(source, 'Fixture');

    source.nested.values[0] = 99;
    expect(cloned).toEqual({ nested: { values: [1, 'two', true, null] } });
  });

  test('retains generic JSON keys without changing an object prototype', () => {
    const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data","prototype":"data"}');
    const cloned = cloneSourceJson(source, 'Fixture') as Record<string, unknown>;

    expect(Object.getPrototypeOf(cloned)).toBeNull();
    expect(Object.hasOwn(cloned, '__proto__')).toBe(true);
    expect(cloned.__proto__).toEqual({ polluted: true });
    expect(cloned['constructor']).toBe('data');
    expect(cloned['prototype']).toBe('data');
  });

  test('rejects non-JSON values without evaluating accessors or silently dropping data', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let accessorRead = false;
    const accessor = {};
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get() {
        accessorRead = true;
        return 'must not run';
      },
    });

    const sparse = Array.from({ length: 3 }, (_, index) => index);
    Reflect.deleteProperty(sparse, 1);
    for (const value of [
      new Date(),
      () => undefined,
      { missing: undefined },
      accessor,
      cyclic,
      sparse,
      Object.assign([1], { '01': 'not-an-index' }),
    ]) {
      expect(() => cloneSourceJson(value, 'Fixture')).toThrow(SourceCodecValueError);
    }
    expect(accessorRead).toBe(false);
  });
});
