// src/index.ts
import {
  freezeDocument
} from "@domily/next-ast";
var expressionOperators = new Set([
  "add",
  "and",
  "coalesce",
  "concat",
  "div",
  "empty",
  "eq",
  "get",
  "gt",
  "gte",
  "lt",
  "lte",
  "mul",
  "neq",
  "not",
  "or",
  "sub",
  "ternary"
]);
var jsonDocumentCodec = {
  id: "json",
  extensions: ["domily.json", "json"],
  mediaTypes: ["application/json", "application/vnd.domily+json"],
  parse: parseJsonDocument,
  serialize: serializeJsonDocument
};
function parseJsonDocument(input) {
  let raw;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    return {
      ok: false,
      issues: [createSyntaxIssue(input, error)]
    };
  }
  try {
    return {
      ok: true,
      value: freezeDocument(parseDocument(raw, "document")),
      issues: []
    };
  } catch (error) {
    return {
      ok: false,
      issues: [createMappingIssue(input, error)]
    };
  }
}
function serializeJsonDocument(document) {
  try {
    return {
      ok: true,
      value: JSON.stringify(serializeDocument(document), null, 2),
      issues: []
    };
  } catch (error) {
    return {
      ok: false,
      issues: [createMappingIssue("", error)]
    };
  }
}
function parseDocument(raw, path) {
  const input = objectAt(raw, path);
  const meta = objectAt(input.meta, `${path}.meta`);
  const protocol = stringAt(meta.protocol, `${path}.meta.protocol`);
  const version = stringAt(meta.version, `${path}.meta.version`);
  if (protocol !== "domily-next") {
    throw mappingError(`${path}.meta.protocol`, 'must equal "domily-next".');
  }
  if (version !== "0.1") {
    throw mappingError(`${path}.meta.version`, 'must equal "0.1".');
  }
  return {
    kind: "document",
    protocol,
    version,
    meta: {
      id: stringAt(meta.id, `${path}.meta.id`),
      capabilities: arrayAt(meta.capabilities ?? [], `${path}.meta.capabilities`).map((item, index) => stringAt(item, `${path}.meta.capabilities[${index}]`))
    },
    state: valueToObject(input.state ?? {}, `${path}.state`),
    derived: parseValueRecord(input.derived ?? {}, `${path}.derived`),
    actions: parseActionsRecord(input.actions ?? {}, `${path}.actions`),
    lifecycle: parseLifecycle(input.lifecycle ?? {}, `${path}.lifecycle`),
    view: parseView(input.view, `${path}.view`)
  };
}
function parseValueRecord(raw, path) {
  return Object.fromEntries(Object.entries(objectAt(raw, path)).map(([key, value]) => [key, parseValue(value, `${path}.${key}`)]));
}
function parseActionsRecord(raw, path) {
  return Object.fromEntries(Object.entries(objectAt(raw, path)).map(([key, value]) => [key, parseActionList(value, `${path}.${key}`)]));
}
function parseLifecycle(raw, path) {
  return Object.fromEntries(Object.entries(objectAt(raw, path)).map(([key, value]) => {
    const nextPath = `${path}.${key}`;
    return [key, Array.isArray(value) ? parseActionList(value, nextPath) : parseAction(value, nextPath)];
  }));
}
function parseActionList(raw, path) {
  return arrayAt(raw, path).map((item, index) => parseAction(item, `${path}[${index}]`));
}
function parseAction(raw, path) {
  const input = objectAt(raw, path);
  const operation = stringAt(input.op, `${path}.op`);
  switch (operation) {
    case "set":
      return {
        kind: "set",
        path: statePath(input.path, `${path}.path`),
        value: parseValue(input.value, `${path}.value`)
      };
    case "merge":
      return {
        kind: "merge",
        path: statePath(input.path, `${path}.path`),
        value: valueToObject(input.value, `${path}.value`)
      };
    case "toggle":
      return { kind: "toggle", path: statePath(input.path, `${path}.path`) };
    case "run":
      return { kind: "run", action: stringAt(input.action, `${path}.action`) };
    case "call":
      return parseCallAction(input, path);
    case "if":
      return {
        kind: "if",
        condition: parseValue(input.condition, `${path}.condition`),
        then: parseActionList(input.then, `${path}.then`),
        ...input.else === undefined ? {} : { else: parseActionList(input.else, `${path}.else`) }
      };
    case "try":
      return {
        kind: "try",
        body: parseActionList(input.body, `${path}.body`),
        ...input.catch === undefined ? {} : { catch: parseActionList(input.catch, `${path}.catch`) },
        ...input.finally === undefined ? {} : { finally: parseActionList(input.finally, `${path}.finally`) }
      };
    default:
      throw mappingError(`${path}.op`, `does not support action "${operation}".`);
  }
}
function parseCallAction(input, path) {
  const args = input.args;
  return {
    kind: "call",
    capability: stringAt(input.capability, `${path}.capability`),
    ...args === undefined ? {} : { args: valueToObject(args, `${path}.args`) },
    ...input.assign === undefined ? {} : { assign: stringAt(input.assign, `${path}.assign`) }
  };
}
function parseValue(raw, path) {
  if (raw === null || typeof raw === "boolean" || typeof raw === "number" || typeof raw === "string") {
    return { kind: "literal", value: raw };
  }
  if (Array.isArray(raw)) {
    return { kind: "array", items: raw.map((item, index) => parseValue(item, `${path}[${index}]`)) };
  }
  const input = objectAt(raw, path);
  if ("$ref" in input) {
    return { kind: "reference", path: stringAt(input.$ref, `${path}.$ref`) };
  }
  if ("op" in input) {
    const op = stringAt(input.op, `${path}.op`);
    if (!expressionOperators.has(op)) {
      throw mappingError(`${path}.op`, `does not support expression "${op}".`);
    }
    return parseExpression(input, op, path);
  }
  return {
    kind: "object",
    entries: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, parseValue(value, `${path}.${key}`)]))
  };
}
function parseExpression(input, op, path) {
  const rawArgs = input.args === undefined ? input.arg === undefined ? [] : [input.arg] : input.args;
  return {
    kind: "expression",
    op,
    args: arrayAt(rawArgs, `${path}.args`).map((item, index) => parseValue(item, `${path}.args[${index}]`))
  };
}
function valueToObject(raw, path) {
  const value = parseValue(raw, path);
  if (value.kind !== "object") {
    throw mappingError(path, "must be an object value.");
  }
  return value;
}
function parseView(raw, path) {
  const input = objectAt(raw, path);
  const kind = typeof input.kind === "string" ? input.kind : undefined;
  if (kind === "text") {
    return { kind, value: parseValue(input.value, `${path}.value`) };
  }
  if (kind === "fragment") {
    return { kind, children: parseViews(input.children ?? [], `${path}.children`) };
  }
  if (kind === "when") {
    return {
      kind,
      condition: parseValue(input.condition, `${path}.condition`),
      child: parseView(input.child, `${path}.child`)
    };
  }
  if (kind === "repeat") {
    return {
      kind,
      each: stringAt(input.each, `${path}.each`),
      in: parseValue(input.in, `${path}.in`),
      ...input.key === undefined ? {} : { key: parseValue(input.key, `${path}.key`) },
      template: parseView(input.template, `${path}.template`)
    };
  }
  return parseElementView(input, path);
}
function parseElementView(input, path) {
  return {
    kind: "element",
    component: stringAt(input.component, `${path}.component`),
    props: parseValueRecord(input.props ?? {}, `${path}.props`),
    events: Object.fromEntries(Object.entries(objectAt(input.events ?? {}, `${path}.events`)).map(([key, value]) => {
      const nextPath = `${path}.events.${key}`;
      return [key, Array.isArray(value) ? parseActionList(value, nextPath) : parseAction(value, nextPath)];
    })),
    children: parseViews(input.children ?? [], `${path}.children`)
  };
}
function parseViews(raw, path) {
  return arrayAt(raw, path).map((item, index) => parseView(item, `${path}[${index}]`));
}
function serializeDocument(document) {
  return {
    meta: {
      protocol: document.protocol,
      version: document.version,
      id: document.meta.id,
      capabilities: document.meta.capabilities
    },
    state: serializeValue(document.state),
    derived: serializeRecord(document.derived),
    actions: Object.fromEntries(Object.entries(document.actions).map(([key, actions]) => [key, actions.map(serializeAction)])),
    lifecycle: Object.fromEntries(Object.entries(document.lifecycle).map(([key, action]) => [
      key,
      Array.isArray(action) ? action.map(serializeAction) : serializeAction(action)
    ])),
    view: serializeView(document.view)
  };
}
function serializeRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, serializeValue(value)]));
}
function serializeAction(action) {
  switch (action.kind) {
    case "set":
      return { op: "set", path: action.path, value: serializeValue(action.value) };
    case "merge":
      return { op: "merge", path: action.path, value: serializeValue(action.value) };
    case "toggle":
      return { op: "toggle", path: action.path };
    case "run":
      return { op: "run", action: action.action };
    case "call":
      return {
        op: "call",
        capability: action.capability,
        ...action.args ? { args: serializeValue(action.args) } : {},
        ...action.assign ? { assign: action.assign } : {}
      };
    case "if":
      return {
        op: "if",
        condition: serializeValue(action.condition),
        then: action.then.map(serializeAction),
        ...action.else ? { else: action.else.map(serializeAction) } : {}
      };
    case "try":
      return {
        op: "try",
        body: action.body.map(serializeAction),
        ...action.catch ? { catch: action.catch.map(serializeAction) } : {},
        ...action.finally ? { finally: action.finally.map(serializeAction) } : {}
      };
  }
}
function serializeValue(value) {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "reference":
      return { $ref: value.path };
    case "expression":
      return { op: value.op, args: value.args.map(serializeValue) };
    case "object":
      return serializeRecord(value.entries);
    case "array":
      return value.items.map(serializeValue);
  }
}
function serializeView(view) {
  switch (view.kind) {
    case "text":
      return { kind: "text", value: serializeValue(view.value) };
    case "fragment":
      return { kind: "fragment", children: view.children.map(serializeView) };
    case "when":
      return { kind: "when", condition: serializeValue(view.condition), child: serializeView(view.child) };
    case "repeat":
      return {
        kind: "repeat",
        each: view.each,
        in: serializeValue(view.in),
        ...view.key ? { key: serializeValue(view.key) } : {},
        template: serializeView(view.template)
      };
    case "element":
      return {
        component: view.component,
        props: serializeRecord(view.props),
        events: Object.fromEntries(Object.entries(view.events).map(([key, action]) => [
          key,
          Array.isArray(action) ? action.map(serializeAction) : serializeAction(action)
        ])),
        children: view.children.map(serializeView)
      };
  }
}
function objectAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mappingError(path, "must be an object.");
  }
  return value;
}
function arrayAt(value, path) {
  if (!Array.isArray(value)) {
    throw mappingError(path, "must be an array.");
  }
  return value;
}
function stringAt(value, path) {
  if (typeof value !== "string") {
    throw mappingError(path, "must be a string.");
  }
  return value;
}
function statePath(value, path) {
  const result = stringAt(value, path);
  if (!result.startsWith("state.")) {
    throw mappingError(path, 'must start with "state.".');
  }
  return result;
}
function createSyntaxIssue(input, error) {
  const message = error instanceof Error ? error.message : "Invalid JSON.";
  const position = /at position (\d+)/.exec(message)?.[1];
  const offset = position === undefined ? 0 : Number(position);
  const before = input.slice(0, offset);
  const line = before.split(`
`).length;
  const column = before.length - before.lastIndexOf(`
`);
  return { code: "json.syntax", message, location: { line, column, offset } };
}
function createMappingIssue(input, error) {
  if (error instanceof MappingError) {
    return {
      code: "json.mapping",
      message: error.message,
      path: error.path,
      ...input ? { location: locateJsonPath(input, error.path) } : {}
    };
  }
  return { code: "json.mapping", message: error instanceof Error ? error.message : "Invalid document." };
}
function locateJsonPath(input, path) {
  const segments = path.split(".").filter((segment) => segment !== "document");
  const property = segments.at(-1)?.replace(/\[\d+\]$/, "");
  if (!property) {
    return { line: 1, column: 1, offset: 0 };
  }
  const match = new RegExp(`"${escapeRegExp(property)}"\\s*:`).exec(input);
  const offset = match?.index ?? 0;
  const before = input.slice(0, offset);
  return {
    line: before.split(`
`).length,
    column: before.length - before.lastIndexOf(`
`),
    offset
  };
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class MappingError extends Error {
  path;
  constructor(path, detail) {
    super(`${path} ${detail}`);
    this.path = path;
  }
}
function mappingError(path, detail) {
  return new MappingError(path, detail);
}
export {
  serializeJsonDocument,
  parseJsonDocument,
  jsonDocumentCodec
};
