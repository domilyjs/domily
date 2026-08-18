import {
  ToonDecodeError,
  decode,
  encode,
} from '@toon-format/toon';
import {
  cloneSourceJson,
  createSourceCodecRegistry,
  type ParsedSource,
  type SourceCodec,
  type SourceCodecIssue,
  type SourceCodecRegistry,
  type SourceCodecResult,
  type SourceLocation,
  type SourceMap,
  type SourcePayload,
} from '@domily/next/codec';
import type { JsonValue } from '@domily/next/pagespec';

/** The official TOON specification targeted by this adapter. */
export const TOON_SPEC_VERSION = '4.1';
/** The exact official parser package audited for this adapter release. */
export const TOON_PARSER_VERSION = '4.1.1';
/** Domily's parser-semantics version used by delivery envelopes. */
export const TOON_CODEC_VERSION = '1.0.0';

/** The concrete TOON adapter; PageSpec semantics remain exclusively in core normalization. */
export const toonPageCodec: SourceCodec = {
  extensions: ['dmy.toon'],
  id: 'toon',
  mediaTypes: ['text/toon'],
  parse(payload) {
    if (payload.kind !== 'text') {
      return failure('toon.payload.kind.invalid', 'The TOON codec accepts text payloads only.');
    }
    return parseToonPage(payload.text);
  },
  serialize(value) {
    return serializeToonPage(value);
  },
  version: TOON_CODEC_VERSION,
};

/** Parses a `.dmy.toon` payload through the official TOON decoder only. */
export function parseToonPage(input: string): SourceCodecResult<ParsedSource> {
  let decoded: unknown;
  try {
    decoded = decode(input, { strict: true });
  } catch (error) {
    return decodeFailure(input, error);
  }

  try {
    const value = cloneSourceJson(decoded, 'TOON payload');
    return {
      issues: [],
      ok: true,
      value: {
        payload: { kind: 'text', text: input },
        sourceMap: rootSourceMap(input),
        value,
      },
    };
  } catch (error) {
    return failure(
      'toon.value.invalid',
      error instanceof Error ? error.message : 'TOON decoder returned a non-JSON-compatible value.',
    );
  }
}

/** Serializes generic protocol data with the audited official TOON encoder. */
export function serializeToonPage(value: JsonValue): SourceCodecResult<SourcePayload> {
  try {
    const text = encode(cloneSourceJson(value, 'TOON value'), { indentSize: 2 });
    return { issues: [], ok: true, value: { kind: 'text', text } };
  } catch (error) {
    return failure(
      'toon.serialize.invalid',
      error instanceof Error ? error.message : 'Unable to serialize the TOON value.',
    );
  }
}

/** Creates a codec-neutral registry preloaded with the TOON format adapter. */
export function createToonSourceCodecRegistry(): SourceCodecRegistry {
  return createSourceCodecRegistry([toonPageCodec]);
}

function decodeFailure(input: string, error: unknown): SourceCodecResult<never> {
  if (error instanceof ToonDecodeError) {
    return failure('toon.syntax', error.message, sourceLocationAtLineStart(input, error.line));
  }
  return failure(
    'toon.parse.failed',
    error instanceof Error ? error.message : 'The official TOON decoder failed unexpectedly.',
  );
}

function rootSourceMap(input: string): SourceMap {
  const start = textLocationAt(input, 0);
  const end = textLocationAt(input, input.length);
  return Object.freeze({
    codecId: 'toon',
    nodes: Object.freeze({
      'toon:': Object.freeze({ end, start }),
    }),
  });
}

function sourceLocationAtLineStart(input: string, line: number | undefined): SourceLocation | undefined {
  if (line === undefined || !Number.isSafeInteger(line) || line < 1) return undefined;
  let currentLine = 1;
  let offset = 0;
  if (line === currentLine) return { column: 1, line, offset };

  while (offset < input.length) {
    const character = input[offset];
    offset += 1;
    if (character === '\r') {
      if (input[offset] === '\n') offset += 1;
      currentLine += 1;
    } else if (character === '\n') {
      currentLine += 1;
    } else {
      continue;
    }
    if (currentLine === line) return { column: 1, line, offset };
  }
  return undefined;
}

function textLocationAt(input: string, targetOffset: number): SourceLocation {
  let column = 1;
  let line = 1;
  for (let offset = 0; offset < targetOffset; offset += 1) {
    const character = input[offset];
    if (character === '\r') {
      if (input[offset + 1] === '\n' && offset + 1 < targetOffset) offset += 1;
      column = 1;
      line += 1;
    } else if (character === '\n') {
      column = 1;
      line += 1;
    } else {
      column += 1;
    }
  }
  return { column, line, offset: targetOffset };
}

function failure(code: string, message: string, location?: SourceLocation): SourceCodecResult<never> {
  const issue: SourceCodecIssue = { code, message, ...(location ? { location } : {}) };
  return { issues: [issue], ok: false };
}
