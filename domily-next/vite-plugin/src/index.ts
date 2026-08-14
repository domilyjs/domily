import type { CodecIssue, Document } from '@domily/next-ast';
import { compileAuthorModule } from '@domily/next-compiler';

export interface DomilyNextVitePluginOptions {
  extensions?: readonly string[];
  validate?: (document: Document) => DomilyViteValidationResult;
}

export interface DomilyViteValidationResult {
  issues: readonly CodecIssue[];
  ok: boolean;
}

export interface DomilyViteTransformResult {
  code: string;
  map: null;
}

/** The structural subset of Vite's plugin contract used by this adapter. */
export interface DomilyVitePlugin {
  enforce: 'pre';
  name: string;
  transform(code: string, id: string): DomilyViteTransformResult | null;
}

export interface DomilyViteErrorLocation {
  column: number;
  file: string;
  line: number;
}

/** A Vite/Rolldown-compatible transform error tied to the original author file. */
export class DomilyViteCompileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly id: string,
    readonly loc?: DomilyViteErrorLocation,
  ) {
    super(message);
    this.name = 'DomilyViteCompileError';
  }
}

const DEFAULT_EXTENSIONS = ['.domily.ts'];

/**
 * Creates a Vite pre-transform plugin that replaces a restricted author module
 * with a JSON-compatible Document AST ES module. It never executes author code.
 */
export function domilyNext(options: DomilyNextVitePluginOptions = {}): DomilyVitePlugin {
  const normalized = normalizeOptions(options);
  return {
    enforce: 'pre',
    name: 'vite:domily-next',
    transform(code, id) {
      if (!matchesAuthorModule(id, normalized.extensions)) return null;
      return transformDomilyAuthorModule(code, id, normalized);
    },
  };
}

export default domilyNext;

/** Compiles one matching author module and exposes the generated AST module for tests/tooling. */
export function transformDomilyAuthorModule(
  source: string,
  id: string,
  options: DomilyNextVitePluginOptions = {},
): DomilyViteTransformResult {
  const normalized = normalizeOptions(options);
  const compiled = compileAuthorModule(source);
  if (!compiled.ok) {
    throw issueError(id, compiled.issues[0] ?? fallbackIssue('dsl.compile', 'Unable to compile the Domily author module.'));
  }

  const validation = normalized.validate?.(compiled.value);
  if (validation && !validation.ok) {
    throw issueError(id, validation.issues[0] ?? fallbackIssue('dsl.validation', 'Document failed Vite host validation.'));
  }
  return { code: documentModuleCode(compiled.value, stripQuery(id)), map: null };
}

function normalizeOptions(options: DomilyNextVitePluginOptions): Required<Pick<DomilyNextVitePluginOptions, 'extensions'>> & DomilyNextVitePluginOptions {
  const extensions = [...(options.extensions ?? DEFAULT_EXTENSIONS)];
  if (extensions.length === 0 || extensions.some((extension) => !extension.startsWith('.') || extension.includes('?'))) {
    throw new DomilyViteCompileError(
      'vite.options.extensions',
      'Domily Vite extensions must be non-empty dot-prefixed file extensions without query strings.',
      '<vite-config>',
    );
  }
  return { ...options, extensions };
}

function matchesAuthorModule(id: string, extensions: readonly string[]): boolean {
  const filename = stripQuery(id);
  return extensions.some((extension) => filename.endsWith(extension));
}

function documentModuleCode(document: Document, id: string): string {
  const serialized = JSON.stringify(document)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return [
    `// Generated from ${JSON.stringify(id)} by @domily/next-vite-plugin.`,
    `const document = ${serialized};`,
    'export { document };',
    'export default document;',
    '',
  ].join('\n');
}

function issueError(id: string, issue: CodecIssue): DomilyViteCompileError {
  const file = stripQuery(id);
  const loc = issue.location
    ? {
        column: Math.max(0, issue.location.column - 1),
        file,
        line: issue.location.line,
      }
    : undefined;
  return new DomilyViteCompileError(issue.code, `[domily-next] ${issue.message}`, file, loc);
}

function fallbackIssue(code: string, message: string): CodecIssue {
  return { code, message };
}

function stripQuery(id: string): string {
  const queryStart = id.indexOf('?');
  return queryStart === -1 ? id : id.slice(0, queryStart);
}
