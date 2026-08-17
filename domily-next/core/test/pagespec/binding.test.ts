import { describe, expect, test } from 'bun:test';

import {
  BindingMaterializationError,
  materializeTemplate,
  parseBindingPath,
  readBindingPath,
} from '../../src/pagespec/binding.ts';

describe('PageSpec binding paths', () => {
  test('keeps an escaped dollar literal distinct from a scope reference until materialization', () => {
    const value = materializeTemplate(
      { title: '$draft.title', price: '$$100' },
      (path) => path.scope === 'draft'
        ? readBindingPath({ title: 'Read the proposal' }, path.segments)
        : undefined,
    );

    expect(value).toEqual({ title: 'Read the proposal', price: '$100' });
  });

  test('shares one safe path grammar between validation and runtime materialization', () => {
    expect(parseBindingPath('$draft.title')?.segments).toEqual(['title']);
    expect(parseBindingPath('$draft.__proto__')).toBeUndefined();
    expect(() => materializeTemplate('$100', () => undefined)).toThrow(BindingMaterializationError);
  });
});
