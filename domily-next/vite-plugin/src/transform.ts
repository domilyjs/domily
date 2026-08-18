import { normalizePageSpec } from '@domily/next/pagespec';
import {
  cloneSourceJson,
  type SourceCodec,
  type SourceCodecIssue,
  type SourceCodecRegistry,
} from '@domily/next/codec';
import type { PageRegistry } from '@domily/next/registry';

export interface DomilyNextVitePluginOptions {
  /**
   * Optional locally registered text codecs. The plugin only asks this registry
   * to parse a file whose suffix matches a codec-declared extension; it never
   * downloads a codec or gives source documents executable behavior.
   */
  readonly codecs?: SourceCodecRegistry;
  /** `.dmy.ts` is ordinary trusted TypeScript; this list controls JSON fallback modules only. */
  readonly extensions?: readonly string[];
  /** Optional build-time PageSpec validation against the local manifest registry. */
  readonly registry?: PageRegistry;
  readonly origin?: 'local' | 'remote';
}

export interface DomilyViteTransformResult {
  readonly code: string;
  readonly map: null;
}

export interface DomilyViteConfigPatch {
  readonly optimizeDeps?: { readonly exclude: readonly string[] };
}

/** The small Vite/Rolldown plugin surface needed by Domily. */
export interface DomilyVitePlugin {
  config(): DomilyViteConfigPatch;
  enforce: 'pre';
  name: string;
  transform(code: string, id: string): DomilyViteTransformResult | null;
}

export interface DomilyViteErrorLocation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
}

export class DomilyVitePageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly id: string,
    readonly loc?: DomilyViteErrorLocation,
  ) {
    super(message);
    this.name = 'DomilyVitePageError';
  }
}

const defaultExtensions = ['.dmy.json'];

/**
 * Validates and converts static JSON PageSpec modules to an import-free ES
 * module. `.dmy.ts` deliberately stays a normal Vite TypeScript module: local
 * authors use `definePage()` as a type helper, not a second macro language.
 */
export function domilyNext(options: DomilyNextVitePluginOptions = {}): DomilyVitePlugin {
  const normalized = normalizeOptions(options);
  return {
    config() {
      return {};
    },
    enforce: 'pre',
    name: 'vite:domily-next',
    transform(code, id) {
      if (isLocalTypeScriptPage(id)) return null;
      const codec = codecForFile(id, normalized.codecs);
      if (codec) {
        return transformSourceCodecModule(code, id, codec, normalized);
      }
      if (!matchesJsonPage(id, normalized.extensions)) return null;
      return transformJsonModule(code, id, normalized);
    },
  };
}

export default domilyNext;

export function transformDomilyJsonModule(
  source: string,
  id: string,
  options: DomilyNextVitePluginOptions = {},
): DomilyViteTransformResult {
  const normalized = normalizeOptions(options);
  return transformJsonModule(source, id, normalized);
}

function transformJsonModule(
  source: string,
  id: string,
  options: NormalizedDomilyNextVitePluginOptions,
): DomilyViteTransformResult {
  let page: unknown;
  try {
    page = JSON.parse(source);
  } catch (error) {
    throw jsonError(id, source, error);
  }
  return transformPageModule(page, id, options);
}

function transformSourceCodecModule(
  source: string,
  id: string,
  codec: SourceCodec,
  options: NormalizedDomilyNextVitePluginOptions,
): DomilyViteTransformResult {
  let result: ReturnType<SourceCodec['parse']>;
  try {
    result = codec.parse({ kind: 'text', text: source });
  } catch {
    throw new DomilyVitePageError(
      'codec.parse.failed',
      `[domily-next] Source codec "${codec.id}" threw while parsing this page.`,
      stripQuery(id),
      undefined,
    );
  }

  if (!result.ok) {
    throw codecError(id, codec, result.issues[0]);
  }
  return transformPageModule(result.value.value, id, options);
}

function transformPageModule(
  page: unknown,
  id: string,
  options: NormalizedDomilyNextVitePluginOptions,
): DomilyViteTransformResult {
  let sourceValue;
  try {
    sourceValue = cloneSourceJson(page, 'PageSpec source codec output');
  } catch {
    throw new DomilyVitePageError(
      'vite.page.serialize.invalid',
      '[domily-next] PageSpec source codec output must be JSON-compatible.',
      stripQuery(id),
    );
  }
  if (options.registry) {
    const result = normalizePageSpec(sourceValue, {
      origin: options.origin,
      registry: options.registry.snapshot(),
    });
    if (!result.ok) {
      const issue = result.issues[0];
      throw new DomilyVitePageError(
        issue?.code ?? 'pagespec.invalid',
        `[domily-next] ${issue?.message ?? 'PageSpec validation failed.'}`,
        stripQuery(id),
      );
    }
  }

  let serialized: string;
  try {
    const encoded = JSON.stringify(sourceValue);
    if (typeof encoded !== 'string') {
      throw new Error('PageSpec source codec output is not JSON-compatible.');
    }
    serialized = encoded;
  } catch {
    throw new DomilyVitePageError(
      'vite.page.serialize.invalid',
      '[domily-next] PageSpec source codec output must be JSON-compatible.',
      stripQuery(id),
    );
  }
  const escaped = serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return {
    code: [
      `// Generated from ${JSON.stringify(stripQuery(id))} by @domily/next-vite-plugin.`,
      `const page = JSON.parse(${JSON.stringify(escaped)});`,
      'export { page };',
      'export default page;',
      '',
    ].join('\n'),
    map: null,
  };
}

type NormalizedDomilyNextVitePluginOptions = DomilyNextVitePluginOptions & {
  readonly extensions: readonly string[];
};

function normalizeOptions(options: DomilyNextVitePluginOptions): NormalizedDomilyNextVitePluginOptions {
  const extensions = [...(options.extensions ?? defaultExtensions)];
  if (extensions.length === 0 || extensions.some((extension) => !extension.startsWith('.') || extension.includes('?'))) {
    throw new DomilyVitePageError(
      'vite.options.extensions',
      'Domily Vite JSON extensions must be non-empty dot-prefixed file extensions without query strings.',
      '<vite-config>',
    );
  }
  return { ...options, extensions };
}

function codecForFile(id: string, codecs: SourceCodecRegistry | undefined): SourceCodec | undefined {
  if (!codecs) return undefined;
  const filename = stripQuery(id).split('/').at(-1) ?? '';
  for (let index = filename.indexOf('.'); index !== -1; index = filename.indexOf('.', index + 1)) {
    const codec = codecs.byExtension(filename.slice(index + 1));
    if (codec) return codec;
  }
  return undefined;
}

function isLocalTypeScriptPage(id: string): boolean {
  return stripQuery(id).endsWith('.dmy.ts');
}

function matchesJsonPage(id: string, extensions: readonly string[]): boolean {
  const filename = stripQuery(id);
  return extensions.some((extension) => filename.endsWith(extension));
}

function jsonError(id: string, source: string, error: unknown): DomilyVitePageError {
  const message = error instanceof Error ? error.message : 'Invalid JSON.';
  const position = /position (\d+)/.exec(message)?.[1];
  const unexpectedToken = /Unexpected token ['"](.+?)['"]/.exec(message)?.[1];
  const offset = position === undefined
    ? Math.max(0, unexpectedToken === undefined ? 0 : source.indexOf(unexpectedToken))
    : Number(position);
  const location = viteTextLocationAt(source, offset);
  return new DomilyVitePageError(
    'json.syntax',
    `[domily-next] ${message}`,
    stripQuery(id),
    {
      column: location.column,
      file: stripQuery(id),
      line: location.line,
    },
  );
}

function viteTextLocationAt(source: string, targetOffset: number): Pick<DomilyViteErrorLocation, 'column' | 'line'> {
  let column = 0;
  let line = 1;
  const end = Math.min(Math.max(0, targetOffset), source.length);
  for (let offset = 0; offset < end; offset += 1) {
    const character = source[offset];
    if (character === '\r') {
      if (source[offset + 1] === '\n' && offset + 1 < end) offset += 1;
      column = 0;
      line += 1;
    } else if (character === '\n') {
      column = 0;
      line += 1;
    } else {
      column += 1;
    }
  }
  return { column, line };
}

function codecError(id: string, codec: SourceCodec, issue: SourceCodecIssue | undefined): DomilyVitePageError {
  const location = issue?.location;
  return new DomilyVitePageError(
    issue?.code ?? 'codec.parse.invalid',
    `[domily-next] ${issue?.message ?? `Source codec "${codec.id}" rejected this page.`}`,
    stripQuery(id),
    location
      ? { column: Math.max(0, location.column - 1), file: stripQuery(id), line: location.line }
      : undefined,
  );
}

function stripQuery(id: string): string {
  const queryStart = id.indexOf('?');
  return queryStart === -1 ? id : id.slice(0, queryStart);
}
