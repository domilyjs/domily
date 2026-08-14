import {
  createDomilyApp,
  type DomilyAppInstance,
  type DomilyAppOptions,
} from '@domily/next';
import {
  createCodecRegistry,
  freezeDocument,
  type ActionNode,
  type CallActionNode,
  type CodecIssue,
  type CodecRegistry,
  type CodecResult,
  type Document,
  type DocumentCodecWithSourceMap,
  type ElementViewNode,
  type ExpressionNode,
  type JsonValue,
  type NodeOrigins,
  type ObjectNode,
  type SourceLocation,
  type SourceMap,
  type SourceMappedDocument,
  type ValueNode,
  type ViewNode,
} from '@domily/next/codec';

const expressionOperators = new Set([
  'add',
  'and',
  'coalesce',
  'concat',
  'div',
  'empty',
  'eq',
  'get',
  'gt',
  'gte',
  'lt',
  'lte',
  'mul',
  'neq',
  'not',
  'or',
  'sub',
  'ternary',
]);

type RawObject = Record<string, unknown>;

export const jsonDocumentCodec: DocumentCodecWithSourceMap = {
  id: 'json',
  extensions: ['dmy.json'],
  mediaTypes: ['application/json', 'application/vnd.domily+json'],
  parse: parseJsonDocument,
  parseWithSourceMap: parseJsonDocumentWithSourceMap,
  serialize: serializeJsonDocument,
};

export type DomilyJsonAppOptions = Omit<DomilyAppOptions, 'codecs'> & {
  codecs?: CodecRegistry;
};

/** Creates a codec registry with the protocol's JSON delivery codec. */
export function createJsonCodecRegistry(): CodecRegistry {
  const codecs = createCodecRegistry();
  codecs.register(jsonDocumentCodec);
  return codecs;
}

/**
 * JSON-enabled app convenience factory for server-delivered documents.
 * Local AST-only apps should import createDomilyApp from @domily/next.
 */
export function createDomilyJsonApp(options: DomilyJsonAppOptions = {}): DomilyAppInstance {
  return createDomilyApp({
    ...options,
    codecs: options.codecs ?? createJsonCodecRegistry(),
  });
}

export function parseJsonDocument(input: string): CodecResult<Document> {
  const result = parseJsonDocumentWithSourceMap(input);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    value: result.value.document,
    issues: result.issues,
  };
}

export function parseJsonDocumentWithSourceMap(input: string): CodecResult<SourceMappedDocument> {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    return {
      ok: false,
      issues: [createSyntaxIssue(input, error)],
    };
  }

  try {
    const sourceMap = createJsonSourceMap(input);
    const document = freezeDocument(parseDocument(raw, 'document'));
    return {
      ok: true,
      value: {
        document,
        sourceMap,
        nodeOrigins: createNodeOrigins(document, raw),
      },
      issues: [],
    };
  } catch (error) {
    return {
      ok: false,
      issues: [createMappingIssue(input, error)],
    };
  }
}

function createJsonSourceMap(input: string): SourceMap {
  return new JsonSourceMapParser(input).parse();
}

function createNodeOrigins(document: Document, raw: unknown): NodeOrigins {
  const origins = new WeakMap<object, readonly string[]>();
  const rawDocument = objectAt(raw, 'document');

  const remember = (node: object, pointer: string) => {
    origins.set(node, [sourceNodeId(pointer)]);
  };
  const fieldPointer = (object: RawObject, key: string, parentPointer: string) =>
    Object.hasOwn(object, key) ? appendJsonPointer(parentPointer, key) : parentPointer;

  const rememberValue = (value: ValueNode, rawValue: unknown, pointer: string): void => {
    remember(value, pointer);

    if (value.kind === 'array') {
      const rawItems = arrayAt(rawValue, pointer);
      value.items.forEach((item, index) => rememberValue(item, rawItems[index], appendJsonPointer(pointer, index)));
      return;
    }

    if (value.kind === 'object') {
      const rawEntries = objectAt(rawValue, pointer);
      for (const [key, entry] of Object.entries(value.entries)) {
        rememberValue(entry, rawEntries[key], appendJsonPointer(pointer, key));
      }
      return;
    }

    if (value.kind === 'expression') {
      const rawExpression = objectAt(rawValue, pointer);
      const rawArgs = rawExpression.args === undefined ? (rawExpression.arg === undefined ? [] : [rawExpression.arg]) : rawExpression.args;
      const rawArgList = arrayAt(rawArgs, pointer);
      const argsPointer = rawExpression.args === undefined ? appendJsonPointer(pointer, 'arg') : appendJsonPointer(pointer, 'args');
      value.args.forEach((argument, index) => {
        const argumentPointer = rawExpression.args === undefined ? argsPointer : appendJsonPointer(argsPointer, index);
        rememberValue(argument, rawArgList[index], argumentPointer);
      });
    }
  };

  const rememberActions = (actions: ActionNode[], rawActions: unknown, pointer: string): void => {
    const rawActionList = arrayAt(rawActions, pointer);
    actions.forEach((action, index) => rememberAction(action, rawActionList[index], appendJsonPointer(pointer, index)));
  };

  const rememberAction = (action: ActionNode, rawAction: unknown, pointer: string): void => {
    remember(action, pointer);
    const input = objectAt(rawAction, pointer);

    switch (action.kind) {
      case 'set':
      case 'merge':
        rememberValue(action.value, input.value, appendJsonPointer(pointer, 'value'));
        return;
      case 'call':
        if (action.args) {
          rememberValue(action.args, input.args, appendJsonPointer(pointer, 'args'));
        }
        return;
      case 'if':
        rememberValue(action.condition, input.condition, appendJsonPointer(pointer, 'condition'));
        rememberActions(action.then, input.then, appendJsonPointer(pointer, 'then'));
        if (action.else) {
          rememberActions(action.else, input.else, appendJsonPointer(pointer, 'else'));
        }
        return;
      case 'try':
        rememberActions(action.body, input.body, appendJsonPointer(pointer, 'body'));
        if (action.catch) {
          rememberActions(action.catch, input.catch, appendJsonPointer(pointer, 'catch'));
        }
        if (action.finally) {
          rememberActions(action.finally, input.finally, appendJsonPointer(pointer, 'finally'));
        }
        return;
      case 'run':
      case 'toggle':
        return;
    }
  };

  const rememberView = (view: ViewNode, rawView: unknown, pointer: string): void => {
    remember(view, pointer);
    const input = objectAt(rawView, pointer);

    switch (view.kind) {
      case 'text':
        rememberValue(view.value, input.value, appendJsonPointer(pointer, 'value'));
        return;
      case 'fragment':
        rememberViews(view.children, input.children ?? [], fieldPointer(input, 'children', pointer));
        return;
      case 'when':
        rememberValue(view.condition, input.condition, appendJsonPointer(pointer, 'condition'));
        rememberView(view.child, input.child, appendJsonPointer(pointer, 'child'));
        return;
      case 'repeat':
        rememberValue(view.in, input.in, appendJsonPointer(pointer, 'in'));
        if (view.key) {
          rememberValue(view.key, input.key, appendJsonPointer(pointer, 'key'));
        }
        rememberView(view.template, input.template, appendJsonPointer(pointer, 'template'));
        return;
      case 'element': {
        const rawProps = objectAt(input.props ?? {}, appendJsonPointer(pointer, 'props'));
        const propsPointer = fieldPointer(input, 'props', pointer);
        for (const [key, value] of Object.entries(view.props)) {
          rememberValue(value, rawProps[key], appendJsonPointer(propsPointer, key));
        }

        const rawEvents = objectAt(input.events ?? {}, appendJsonPointer(pointer, 'events'));
        const eventsPointer = fieldPointer(input, 'events', pointer);
        for (const [key, action] of Object.entries(view.events)) {
          const rawEvent = rawEvents[key];
          const eventPointer = appendJsonPointer(eventsPointer, key);
          if (Array.isArray(action)) {
            rememberActions(action, rawEvent, eventPointer);
          } else {
            rememberAction(action, rawEvent, eventPointer);
          }
        }

        rememberViews(view.children, input.children ?? [], fieldPointer(input, 'children', pointer));
      }
    }
  };

  const rememberViews = (views: ViewNode[], rawViews: unknown, pointer: string): void => {
    const rawViewList = arrayAt(rawViews, pointer);
    views.forEach((view, index) => rememberView(view, rawViewList[index], appendJsonPointer(pointer, index)));
  };

  remember(document, '');
  remember(document.meta, appendJsonPointer('', 'meta'));

  const statePointer = fieldPointer(rawDocument, 'state', '');
  rememberValue(document.state, rawDocument.state ?? {}, statePointer);

  const derived = objectAt(rawDocument.derived ?? {}, appendJsonPointer('', 'derived'));
  const derivedPointer = fieldPointer(rawDocument, 'derived', '');
  for (const [key, value] of Object.entries(document.derived)) {
    rememberValue(value, derived[key], appendJsonPointer(derivedPointer, key));
  }

  const actions = objectAt(rawDocument.actions ?? {}, appendJsonPointer('', 'actions'));
  const actionsPointer = fieldPointer(rawDocument, 'actions', '');
  for (const [key, value] of Object.entries(document.actions)) {
    rememberActions(value, actions[key], appendJsonPointer(actionsPointer, key));
  }

  const lifecycle = objectAt(rawDocument.lifecycle ?? {}, appendJsonPointer('', 'lifecycle'));
  const lifecyclePointer = fieldPointer(rawDocument, 'lifecycle', '');
  for (const [key, value] of Object.entries(document.lifecycle)) {
    const rawValue = lifecycle[key];
    const pointer = appendJsonPointer(lifecyclePointer, key);
    if (Array.isArray(value)) {
      rememberActions(value, rawValue, pointer);
    } else {
      rememberAction(value, rawValue, pointer);
    }
  }

  rememberView(document.view, rawDocument.view, appendJsonPointer('', 'view'));

  return {
    get(node) {
      return origins.get(node);
    },
    has(node) {
      return origins.has(node);
    },
  };
}

class JsonSourceMapParser {
  private readonly lineStarts: number[] = [0];
  private offset = 0;
  private readonly nodes: Record<string, SourceMap['nodes'][string]> = {};

  constructor(private readonly input: string) {
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] === '\n') {
        this.lineStarts.push(index + 1);
      }
    }
  }

  parse(): SourceMap {
    this.skipWhitespace();
    this.parseValue('');
    this.skipWhitespace();
    return {
      codecId: 'json',
      nodes: this.nodes,
    };
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
      if (character === '\\') {
        this.offset += 2;
      } else {
        this.offset += 1;
      }
    }
    throw new Error('Unterminated JSON string.');
  }

  private parseNumber(): void {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    match.lastIndex = this.offset;
    const value = match.exec(this.input);
    if (!value) {
      throw new Error(`Expected JSON value at offset ${this.offset}.`);
    }
    this.offset += value[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.offset] ?? '')) {
      this.offset += 1;
    }
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
      if ((this.lineStarts[middle] ?? 0) <= offset) {
        lower = middle;
      } else {
        upper = middle;
      }
    }
    const lineStart = this.lineStarts[lower] ?? 0;
    return { line: lower + 1, column: offset - lineStart + 1, offset };
  }
}

function appendJsonPointer(pointer: string, segment: string | number): string {
  const escaped = String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${pointer}/${escaped}`;
}

function sourceNodeId(pointer: string): string {
  return `json:${pointer || '/'}`;
}

export function serializeJsonDocument(document: Document): CodecResult<string> {
  try {
    return {
      ok: true,
      value: JSON.stringify(serializeDocument(document), null, 2),
      issues: [],
    };
  } catch (error) {
    return {
      ok: false,
      issues: [createMappingIssue('', error)],
    };
  }
}

function parseDocument(raw: unknown, path: string): Document {
  const input = objectAt(raw, path);
  const meta = objectAt(input.meta, `${path}.meta`);
  const protocol = stringAt(meta.protocol, `${path}.meta.protocol`);
  const version = stringAt(meta.version, `${path}.meta.version`);
  if (protocol !== 'domily-next') {
    throw mappingError(`${path}.meta.protocol`, 'must equal "domily-next".');
  }
  if (version !== '0.1') {
    throw mappingError(`${path}.meta.version`, 'must equal "0.1".');
  }

  return {
    kind: 'document',
    protocol,
    version,
    meta: {
      id: stringAt(meta.id, `${path}.meta.id`),
      capabilities: arrayAt(meta.capabilities ?? [], `${path}.meta.capabilities`).map((item, index) =>
        stringAt(item, `${path}.meta.capabilities[${index}]`),
      ),
    },
    state: valueToObject(input.state ?? {}, `${path}.state`),
    derived: parseValueRecord(input.derived ?? {}, `${path}.derived`),
    actions: parseActionsRecord(input.actions ?? {}, `${path}.actions`),
    lifecycle: parseLifecycle(input.lifecycle ?? {}, `${path}.lifecycle`),
    view: parseView(input.view, `${path}.view`),
  };
}

function parseValueRecord(raw: unknown, path: string): Record<string, ValueNode> {
  return Object.fromEntries(
    Object.entries(objectAt(raw, path)).map(([key, value]) => [key, parseValue(value, `${path}.${key}`)]),
  );
}

function parseActionsRecord(raw: unknown, path: string): Record<string, ActionNode[]> {
  return Object.fromEntries(
    Object.entries(objectAt(raw, path)).map(([key, value]) => [key, parseActionList(value, `${path}.${key}`)]),
  );
}

function parseLifecycle(raw: unknown, path: string): Record<string, ActionNode | ActionNode[]> {
  return Object.fromEntries(
    Object.entries(objectAt(raw, path)).map(([key, value]) => {
      const nextPath = `${path}.${key}`;
      return [key, Array.isArray(value) ? parseActionList(value, nextPath) : parseAction(value, nextPath)];
    }),
  );
}

function parseActionList(raw: unknown, path: string): ActionNode[] {
  return arrayAt(raw, path).map((item, index) => parseAction(item, `${path}[${index}]`));
}

function parseAction(raw: unknown, path: string): ActionNode {
  const input = objectAt(raw, path);
  const operation = stringAt(input.op, `${path}.op`);
  switch (operation) {
    case 'set':
      return {
        kind: 'set',
        path: statePath(input.path, `${path}.path`),
        value: parseValue(input.value, `${path}.value`),
      };
    case 'merge':
      return {
        kind: 'merge',
        path: statePath(input.path, `${path}.path`),
        value: valueToObject(input.value, `${path}.value`),
      };
    case 'toggle':
      return { kind: 'toggle', path: statePath(input.path, `${path}.path`) };
    case 'run':
      return { kind: 'run', action: stringAt(input.action, `${path}.action`) };
    case 'call':
      return parseCallAction(input, path);
    case 'if':
      return {
        kind: 'if',
        condition: parseValue(input.condition, `${path}.condition`),
        then: parseActionList(input.then, `${path}.then`),
        ...(input.else === undefined ? {} : { else: parseActionList(input.else, `${path}.else`) }),
      };
    case 'try':
      return {
        kind: 'try',
        body: parseActionList(input.body, `${path}.body`),
        ...(input.catch === undefined ? {} : { catch: parseActionList(input.catch, `${path}.catch`) }),
        ...(input.finally === undefined
          ? {}
          : { finally: parseActionList(input.finally, `${path}.finally`) }),
      };
    default:
      throw mappingError(`${path}.op`, `does not support action "${operation}".`);
  }
}

function parseCallAction(input: RawObject, path: string): CallActionNode {
  const args = input.args;
  return {
    kind: 'call',
    capability: stringAt(input.capability, `${path}.capability`),
    ...(args === undefined ? {} : { args: valueToObject(args, `${path}.args`) }),
    ...(input.assign === undefined ? {} : { assign: stringAt(input.assign, `${path}.assign`) }),
  };
}

function parseValue(raw: unknown, path: string): ValueNode {
  if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
    return { kind: 'literal', value: raw };
  }
  if (Array.isArray(raw)) {
    return { kind: 'array', items: raw.map((item, index) => parseValue(item, `${path}[${index}]`)) };
  }

  const input = objectAt(raw, path);
  if ('$ref' in input) {
    return { kind: 'reference', path: stringAt(input.$ref, `${path}.$ref`) };
  }
  if ('op' in input) {
    const op = stringAt(input.op, `${path}.op`);
    if (!expressionOperators.has(op)) {
      throw mappingError(`${path}.op`, `does not support expression "${op}".`);
    }
    return parseExpression(input, op, path);
  }
  return {
    kind: 'object',
    entries: Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, parseValue(value, `${path}.${key}`)]),
    ),
  };
}

function parseExpression(input: RawObject, op: string, path: string): ExpressionNode {
  const rawArgs = input.args === undefined ? (input.arg === undefined ? [] : [input.arg]) : input.args;
  return {
    kind: 'expression',
    op: op as ExpressionNode['op'],
    args: arrayAt(rawArgs, `${path}.args`).map((item, index) => parseValue(item, `${path}.args[${index}]`)),
  };
}

function valueToObject(raw: unknown, path: string): ObjectNode {
  const value = parseValue(raw, path);
  if (value.kind !== 'object') {
    throw mappingError(path, 'must be an object value.');
  }
  return value;
}

function parseView(raw: unknown, path: string): ViewNode {
  const input = objectAt(raw, path);
  const kind = typeof input.kind === 'string' ? input.kind : undefined;
  if (kind === 'text') {
    return { kind, value: parseValue(input.value, `${path}.value`) };
  }
  if (kind === 'fragment') {
    return { kind, children: parseViews(input.children ?? [], `${path}.children`) };
  }
  if (kind === 'when') {
    return {
      kind,
      condition: parseValue(input.condition, `${path}.condition`),
      child: parseView(input.child, `${path}.child`),
    };
  }
  if (kind === 'repeat') {
    return {
      kind,
      each: stringAt(input.each, `${path}.each`),
      in: parseValue(input.in, `${path}.in`),
      ...(input.key === undefined ? {} : { key: parseValue(input.key, `${path}.key`) }),
      template: parseView(input.template, `${path}.template`),
    };
  }
  return parseElementView(input, path);
}

function parseElementView(input: RawObject, path: string): ElementViewNode {
  return {
    kind: 'element',
    component: stringAt(input.component, `${path}.component`),
    props: parseValueRecord(input.props ?? {}, `${path}.props`),
    events: Object.fromEntries(
      Object.entries(objectAt(input.events ?? {}, `${path}.events`)).map(([key, value]) => {
        const nextPath = `${path}.events.${key}`;
        return [key, Array.isArray(value) ? parseActionList(value, nextPath) : parseAction(value, nextPath)];
      }),
    ),
    children: parseViews(input.children ?? [], `${path}.children`),
  };
}

function parseViews(raw: unknown, path: string): ViewNode[] {
  return arrayAt(raw, path).map((item, index) => parseView(item, `${path}[${index}]`));
}

function serializeDocument(document: Document): JsonValue {
  return {
    meta: {
      protocol: document.protocol,
      version: document.version,
      id: document.meta.id,
      capabilities: document.meta.capabilities,
    },
    state: serializeValue(document.state),
    derived: serializeRecord(document.derived),
    actions: Object.fromEntries(
      Object.entries(document.actions).map(([key, actions]) => [key, actions.map(serializeAction)]),
    ),
    lifecycle: Object.fromEntries(
      Object.entries(document.lifecycle).map(([key, action]) => [
        key,
        Array.isArray(action) ? action.map(serializeAction) : serializeAction(action),
      ]),
    ),
    view: serializeView(document.view),
  };
}

function serializeRecord(record: Record<string, ValueNode>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, serializeValue(value)]));
}

function serializeAction(action: ActionNode): JsonValue {
  switch (action.kind) {
    case 'set':
      return { op: 'set', path: action.path, value: serializeValue(action.value) };
    case 'merge':
      return { op: 'merge', path: action.path, value: serializeValue(action.value) };
    case 'toggle':
      return { op: 'toggle', path: action.path };
    case 'run':
      return { op: 'run', action: action.action };
    case 'call':
      return {
        op: 'call',
        capability: action.capability,
        ...(action.args ? { args: serializeValue(action.args) } : {}),
        ...(action.assign ? { assign: action.assign } : {}),
      };
    case 'if':
      return {
        op: 'if',
        condition: serializeValue(action.condition),
        then: action.then.map(serializeAction),
        ...(action.else ? { else: action.else.map(serializeAction) } : {}),
      };
    case 'try':
      return {
        op: 'try',
        body: action.body.map(serializeAction),
        ...(action.catch ? { catch: action.catch.map(serializeAction) } : {}),
        ...(action.finally ? { finally: action.finally.map(serializeAction) } : {}),
      };
  }
}

function serializeValue(value: ValueNode): JsonValue {
  switch (value.kind) {
    case 'literal':
      return value.value;
    case 'reference':
      return { $ref: value.path };
    case 'expression':
      return { op: value.op, args: value.args.map(serializeValue) };
    case 'object':
      return serializeRecord(value.entries);
    case 'array':
      return value.items.map(serializeValue);
  }
}

function serializeView(view: ViewNode): JsonValue {
  switch (view.kind) {
    case 'text':
      return { kind: 'text', value: serializeValue(view.value) };
    case 'fragment':
      return { kind: 'fragment', children: view.children.map(serializeView) };
    case 'when':
      return { kind: 'when', condition: serializeValue(view.condition), child: serializeView(view.child) };
    case 'repeat':
      return {
        kind: 'repeat',
        each: view.each,
        in: serializeValue(view.in),
        ...(view.key ? { key: serializeValue(view.key) } : {}),
        template: serializeView(view.template),
      };
    case 'element':
      return {
        component: view.component,
        props: serializeRecord(view.props),
        events: Object.fromEntries(
          Object.entries(view.events).map(([key, action]) => [
            key,
            Array.isArray(action) ? action.map(serializeAction) : serializeAction(action),
          ]),
        ),
        children: view.children.map(serializeView),
      };
  }
}

function objectAt(value: unknown, path: string): RawObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw mappingError(path, 'must be an object.');
  }
  return value as RawObject;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw mappingError(path, 'must be an array.');
  }
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw mappingError(path, 'must be a string.');
  }
  return value;
}

function statePath(value: unknown, path: string): `state.${string}` {
  const result = stringAt(value, path);
  if (!result.startsWith('state.')) {
    throw mappingError(path, 'must start with "state.".');
  }
  return result as `state.${string}`;
}

function createSyntaxIssue(input: string, error: unknown): CodecIssue {
  const message = error instanceof Error ? error.message : 'Invalid JSON.';
  const position = /at position (\d+)/.exec(message)?.[1];
  const offset = position === undefined ? 0 : Number(position);
  const before = input.slice(0, offset);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return { code: 'json.syntax', message, location: { line, column, offset } };
}

function createMappingIssue(input: string, error: unknown): CodecIssue {
  if (error instanceof MappingError) {
    return {
      code: 'json.mapping',
      message: error.message,
      path: error.path,
      ...(input ? { location: locateJsonPath(input, error.path) } : {}),
    };
  }
  return { code: 'json.mapping', message: error instanceof Error ? error.message : 'Invalid document.' };
}

function locateJsonPath(input: string, path: string) {
  const segments = path.split('.').filter((segment) => segment !== 'document');
  const property = segments.at(-1)?.replace(/\[\d+\]$/, '');
  if (!property) {
    return { line: 1, column: 1, offset: 0 };
  }
  const match = new RegExp(`"${escapeRegExp(property)}"\\s*:`).exec(input);
  const offset = match?.index ?? 0;
  const before = input.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: before.length - before.lastIndexOf('\n'),
    offset,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class MappingError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path} ${detail}`);
  }
}

function mappingError(path: string, detail: string): MappingError {
  return new MappingError(path, detail);
}
