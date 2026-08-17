import type { PageSpec } from './types.ts';

/**
 * Type-preserving local authoring helper. It deliberately performs no runtime
 * execution, lowering, capability registration, or Vite transform. A `.dmy.ts`
 * file remains an ordinary trusted TypeScript module.
 */
export function definePage<const T extends PageSpec>(page: T): T {
  return page;
}
