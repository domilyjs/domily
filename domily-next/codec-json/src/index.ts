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

/** The concrete JSON adapter; PageSpec semantics remain exclusively in core normalization. */
export const jsonPageCodec: SourceCodec = {
  id: 'json',
  version: '1.0.0',
  extensions: ['dmy.json'],
  mediaTypes: ['application/json', 'application/vnd.domily+json'],
  parse(payload) {
    if (payload.kind !== 'text') {
      return failure('json.payload.kind.invalid', 'The JSON codec accepts text payloads only.');
    }
    return parseJsonPage(payload.text);
  },
  serialize(value) {
    return serializeJsonPage(value);
  },
};

/** Convenience parser for a `.dmy.json` payload. It deliberately returns raw JSON data. */
export function parseJsonPage(input: string): SourceCodecResult<ParsedSource> {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    return { ok: false, issues: [syntaxIssue(input, error)] };
  }
  try {
    const value = cloneSourceJson(raw, 'JSON payload');
    return {
      ok: true,
      value: {
        payload: { kind: 'text', text: input },
        sourceMap: new JsonSourceMapParser(input).parse(),
        value,
      },
      issues: [],
    };
  } catch (error) {
    return failure('json.value.invalid', error instanceof Error ? error.message : 'JSON payload is not representable as a source value.');
  }
}

/** Serializes generic protocol data without validating it as a PageSpec. */
export function serializeJsonPage(value: JsonValue): SourceCodecResult<SourcePayload> {
  try {
    return {
      ok: true,
      value: { kind: 'text', text: JSON.stringify(cloneSourceJson(value, 'JSON value'), null, 2) },
      issues: [],
    };
  } catch (error) {
    return failure('json.serialize.invalid', error instanceof Error ? error.message : 'Unable to serialize JSON value.');
  }
}

/** Creates a codec-neutral registry preloaded with the JSON format adapter. */
export function createJsonSourceCodecRegistry(): SourceCodecRegistry {
  return createSourceCodecRegistry([jsonPageCodec]);
}

class JsonSourceMapParser {
  private readonly lineStarts: number[] = [0];
  private readonly nodes: Record<string, SourceMap['nodes'][string]> = {};
  private offset = 0;

  constructor(private readonly input: string) {
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] === '\r') {
        if (input[index + 1] === '\n') index += 1;
        this.lineStarts.push(index + 1);
      } else if (input[index] === '\n') {
        this.lineStarts.push(index + 1);
      }
    }
  }

  parse(): SourceMap {
    this.skipWhitespace();
    this.parseValue('');
    this.skipWhitespace();
    return { codecId: 'json', nodes: this.nodes };
  }

  private parseValue(pointer: string): void {
    this.skipWhitespace();
    const start = this.offset;
    const token = this.input[this.offset];
    if (token === '{') {
      this.parseObject(pointer);
    } else if (token === '[') {
      this.parseArray(pointer);
    } else if (token === '"') {
      this.parseString();
    } else if (token === 't') {
      this.expect('true');
    } else if (token === 'f') {
      this.expect('false');
    } else if (token === 'n') {
      this.expect('null');
    } else {
      this.parseNumber();
    }
    this.nodes[sourceNodeId(pointer)] = {
      start: this.locationAt(start),
      end: this.locationAt(this.offset),
    };
  }

  private parseObject(pointer: string): void {
    this.offset += 1;
    this.skipWhitespace();
    if (this.input[this.offset] === '}') {
      this.offset += 1;
      return;
    }
    while (true) {
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(':');
      this.parseValue(appendJsonPointer(pointer, key));
      this.skipWhitespace();
      if (this.input[this.offset] === '}') {
        this.offset += 1;
        return;
      }
      this.expect(',');
      this.skipWhitespace();
    }
  }

  private parseArray(pointer: string): void {
    this.offset += 1;
    this.skipWhitespace();
    let index = 0;
    if (this.input[this.offset] === ']') {
      this.offset += 1;
      return;
    }
    while (true) {
      this.parseValue(appendJsonPointer(pointer, index));
      index += 1;
      this.skipWhitespace();
      if (this.input[this.offset] === ']') {
        this.offset += 1;
        return;
      }
      this.expect(',');
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.offset;
    this.expect('"');
    while (this.offset < this.input.length) {
      const character = this.input[this.offset];
      if (character === '"') {
        this.offset += 1;
        return JSON.parse(this.input.slice(start, this.offset)) as string;
      }
      this.offset += character === '\\' ? 2 : 1;
    }
    throw new Error('Unterminated JSON string.');
  }

  private parseNumber(): void {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    match.lastIndex = this.offset;
    const value = match.exec(this.input);
    if (!value) throw new Error(`Expected a JSON value at offset ${this.offset}.`);
    this.offset += value[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.offset] ?? '')) this.offset += 1;
  }

  private expect(token: string): void {
    if (!this.input.startsWith(token, this.offset)) {
      throw new Error(`Expected "${token}" at offset ${this.offset}.`);
    }
    this.offset += token.length;
  }

  private locationAt(offset: number): SourceLocation {
    let lower = 0;
    let upper = this.lineStarts.length;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if ((this.lineStarts[middle] ?? 0) <= offset) lower = middle;
      else upper = middle;
    }
    const lineStart = this.lineStarts[lower] ?? 0;
    return { line: lower + 1, column: offset - lineStart + 1, offset };
  }
}

function syntaxIssue(input: string, error: unknown): SourceCodecIssue {
  const message = error instanceof Error ? error.message : 'Invalid JSON.';
  const offset = Number(/position (\d+)/.exec(message)?.[1] ?? 0);
  const before = input.slice(0, offset);
  return {
    code: 'json.syntax',
    message,
    location: {
      line: before.split('\n').length,
      column: before.length - before.lastIndexOf('\n'),
      offset,
    },
  };
}

function appendJsonPointer(pointer: string, segment: string | number): string {
  const escaped = String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${pointer}/${escaped}`;
}

function sourceNodeId(pointer: string): string {
  return `json:${pointer}`;
}

function failure(code: string, message: string): SourceCodecResult<never> {
  return { ok: false, issues: [{ code, message }] };
}
