// src/index.ts
import { parseSync } from "@swc/core";
import {
  freezeDocument
} from "@domily/next-ast";
var dslModule = "@domily/next";
var dslSymbols = new Set(["action", "cap", "defineDocument", "derived", "event", "ref", "state", "view"]);
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

class CompileFailure extends Error {
  code;
  span;
  constructor(code, message, span) {
    super(message);
    this.code = code;
    this.span = span;
  }
}
function compileAuthorModule(source) {
  try {
    const module = parseSync(source, {
      syntax: "typescript",
      target: "es2022"
    });
    const compiler = new AuthorModuleCompiler(module);
    return {
      ok: true,
      value: compiler.compile(),
      issues: []
    };
  } catch (error) {
    return {
      ok: false,
      issues: [toIssue(source, error)]
    };
  }
}

class AuthorModuleCompiler {
  module;
  imports = new Map;
  constants = new Map;
  resolvingConstants = new Set;
  capabilities = new Set;
  documentExpression;
  documentIndex = -1;
  constantLimit = -1;
  constructor(module) {
    this.module = module;
  }
  compile() {
    this.collectModuleBindings();
    if (!this.documentExpression || this.documentIndex < 0) {
      this.fail("dsl.document", "The module must default-export exactly one defineDocument(...) call.");
    }
    this.constantLimit = this.documentIndex;
    const document = this.compileDocument(this.documentExpression);
    return freezeDocument(document);
  }
  collectModuleBindings() {
    for (const [index, item] of this.module.body.entries()) {
      switch (item.type) {
        case "ImportDeclaration":
          this.collectImport(item);
          break;
        case "VariableDeclaration":
          this.collectConstants(item, index);
          break;
        case "ExportDefaultExpression":
          if (this.documentExpression) {
            this.fail("dsl.document", "A Domily author module can default-export only one document.", item.span);
          }
          this.documentExpression = item.expression;
          this.documentIndex = index;
          break;
        case "TsInterfaceDeclaration":
        case "TsTypeAliasDeclaration":
          break;
        default:
          this.fail("dsl.module", "Only imports, top-level const declarations, type declarations, and one default export are allowed.", item.span);
      }
    }
  }
  collectImport(declaration) {
    if (declaration.typeOnly) {
      return;
    }
    if (declaration.source.value !== dslModule) {
      this.fail("dsl.import", `Only type-only imports or named DSL imports from "${dslModule}" are allowed.`, declaration.span);
    }
    for (const specifier of declaration.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.isTypeOnly) {
        continue;
      }
      if (specifier.type !== "ImportSpecifier") {
        this.fail("dsl.import", "DSL imports must be named imports.", specifier.span);
      }
      const imported = specifier.imported?.value ?? specifier.local.value;
      if (!dslSymbols.has(imported)) {
        this.fail("dsl.import", `"${imported}" is not a supported Domily DSL constructor.`, specifier.span);
      }
      if (this.imports.has(specifier.local.value)) {
        this.fail("dsl.import", `The local DSL binding "${specifier.local.value}" is declared more than once.`, specifier.span);
      }
      this.imports.set(specifier.local.value, imported);
    }
  }
  collectConstants(declaration, index) {
    if (declaration.kind !== "const" || declaration.declare) {
      this.fail("dsl.static", "Only initialized top-level const declarations are allowed.", declaration.span);
    }
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier" || !declarator.init) {
        this.fail("dsl.static", "A static const must use an identifier and an initializer.", declarator.span);
      }
      if (this.imports.has(declarator.id.value) || this.constants.has(declarator.id.value)) {
        this.fail("dsl.static", `The static binding "${declarator.id.value}" is declared more than once.`, declarator.span);
      }
      this.constants.set(declarator.id.value, {
        expression: declarator.init,
        index,
        span: declarator.span
      });
    }
  }
  compileDocument(expression) {
    const call = this.asCall(expression, "defineDocument(...)");
    if (this.importedSymbol(call.callee) !== "defineDocument") {
      this.fail("dsl.document", "The default export must call the imported defineDocument constructor.", call.span);
    }
    const definition = this.arguments(call, "defineDocument", 1, 1)[0];
    const fields = this.objectEntries(definition, "defineDocument(...)");
    this.rejectUnknownKeys(fields, new Set(["actions", "capabilities", "derived", "id", "lifecycle", "state", "view"]), spanOf(definition));
    const id = this.stringValue(this.requiredField(fields, "id", spanOf(definition)), "document id");
    const declaredCapabilities = fields.has("capabilities") ? this.capabilityList(this.requiredField(fields, "capabilities", spanOf(definition))) : [];
    const state = this.compileState(this.requiredField(fields, "state", spanOf(definition)));
    const derived = fields.has("derived") ? this.valueRecord(this.requiredField(fields, "derived", spanOf(definition)), "derived") : {};
    const actions = fields.has("actions") ? this.actionsRecord(this.requiredField(fields, "actions", spanOf(definition))) : {};
    const lifecycle = fields.has("lifecycle") ? this.lifecycleRecord(this.requiredField(fields, "lifecycle", spanOf(definition))) : {};
    const view = this.compileView(this.requiredField(fields, "view", spanOf(definition)));
    for (const capability of declaredCapabilities) {
      this.capabilities.add(capability);
    }
    return {
      kind: "document",
      protocol: "domily-next",
      version: "0.1",
      meta: {
        id,
        capabilities: [...this.capabilities]
      },
      state,
      derived,
      actions,
      lifecycle,
      view
    };
  }
  compileState(expression) {
    return this.resolveStatic(expression, "a state declaration", (resolved) => {
      const call = this.asCall(resolved, "state(...)");
      if (this.importedSymbol(call.callee) !== "state") {
        this.fail("dsl.state", "The state field must use state({...}).", call.span);
      }
      const value = this.arguments(call, "state", 1, 1)[0];
      return this.objectValue(value, "state");
    });
  }
  valueRecord(expression, context) {
    const entries = this.objectEntries(expression, context);
    const result = {};
    for (const [key, value] of entries) {
      result[key] = this.compileValue(value);
    }
    return result;
  }
  actionsRecord(expression) {
    const entries = this.objectEntries(expression, "actions");
    const result = {};
    for (const [key, value] of entries) {
      result[key] = this.compileActionList(value);
    }
    return result;
  }
  lifecycleRecord(expression) {
    const entries = this.objectEntries(expression, "lifecycle");
    const result = {};
    for (const [key, value] of entries) {
      result[key] = this.isArray(value) ? this.compileActionList(value) : this.compileAction(value);
    }
    return result;
  }
  compileValue(expression) {
    return this.resolveStatic(expression, "a value", (resolved) => {
      switch (resolved.type) {
        case "NullLiteral":
          return { kind: "literal", value: null };
        case "BooleanLiteral":
        case "NumericLiteral":
        case "StringLiteral":
          return { kind: "literal", value: resolved.value };
        case "TemplateLiteral":
          if (resolved.expressions.length !== 0 || resolved.quasis.length !== 1) {
            this.fail("dsl.value", "Template literals may contain only one static text segment.", resolved.span);
          }
          return { kind: "literal", value: resolved.quasis[0]?.cooked ?? resolved.quasis[0]?.raw ?? "" };
        case "ArrayExpression":
          return {
            kind: "array",
            items: resolved.elements.map((element) => {
              if (!element || element.spread) {
                this.fail("dsl.value", "Array holes and spread elements are not supported.", resolved.span);
              }
              return this.compileValue(element.expression);
            })
          };
        case "ObjectExpression":
          return this.objectValue(resolved, "object value");
        case "CallExpression":
          return this.compileValueCall(resolved);
        case "Identifier":
          this.fail("dsl.value", `"${resolved.value}" is not a static Domily value.`, resolved.span);
        default:
          this.fail("dsl.value", `${resolved.type} is not a supported static Domily value.`, spanOf(resolved));
      }
    });
  }
  compileValueCall(expression) {
    const member = this.memberCall(expression.callee);
    if (member?.root === "ref") {
      return this.compileReference(member.member, this.arguments(expression, `ref.${member.member}`, 1, 2), expression.span);
    }
    if (member?.root === "event") {
      const supportedEvents = new Set(["checked", "key", "value"]);
      if (!supportedEvents.has(member.member)) {
        this.fail("dsl.event", `event.${member.member}() is not supported.`, expression.span);
      }
      this.arguments(expression, `event.${member.member}`, 0, 0);
      return { kind: "reference", path: `event.${member.member}` };
    }
    if (member?.root === "derived") {
      if (!expressionOperators.has(member.member)) {
        this.fail("dsl.derived", `derived.${member.member}(...) is not supported.`, expression.span);
      }
      return {
        kind: "expression",
        op: member.member,
        args: this.arguments(expression, `derived.${member.member}`, 1).map((argument) => this.compileValue(argument))
      };
    }
    this.fail("dsl.call", "Only ref.*, event.*, and derived.* calls can produce a Domily value.", expression.span);
  }
  compileReference(member, argumentsList, span) {
    switch (member) {
      case "state":
        return { kind: "reference", path: `state.${this.stringValue(argumentsList[0], "state reference")}` };
      case "derived":
        return { kind: "reference", path: `derived.${this.stringValue(argumentsList[0], "derived reference")}` };
      case "var":
        return { kind: "reference", path: `vars.${this.stringValue(argumentsList[0], "variable reference")}` };
      case "error":
        return { kind: "reference", path: `vars.error.${this.stringValue(argumentsList[0], "error reference")}` };
      case "item": {
        const each = this.stringValue(argumentsList[0], "repeat item name");
        const path = argumentsList[1] ? this.stringValue(argumentsList[1], "repeat item path") : "";
        return { kind: "reference", path: path === "" ? each : `${each}.${path}` };
      }
      default:
        this.fail("dsl.reference", `ref.${member}(...) is not supported.`, span);
    }
  }
  compileActionList(expression) {
    return this.resolveStatic(expression, "an action list", (resolved) => {
      if (resolved.type !== "ArrayExpression") {
        return [this.compileAction(resolved)];
      }
      return resolved.elements.map((element) => {
        if (!element || element.spread) {
          this.fail("dsl.action", "Action lists cannot contain holes or spread elements.", resolved.span);
        }
        return this.compileAction(element.expression);
      });
    });
  }
  compileAction(expression) {
    return this.resolveStatic(expression, "an action", (resolved) => {
      const call = this.asCall(resolved, "an action constructor");
      const member = this.memberCall(call.callee);
      if (!member || member.root !== "action") {
        this.fail("dsl.action", "Actions must use an imported action.* constructor.", call.span);
      }
      switch (member.member) {
        case "set": {
          const actionArguments = this.arguments(call, "action.set", 2, 2);
          const path = actionArguments[0];
          const value = actionArguments[1];
          return {
            kind: "set",
            path: this.statePath(path),
            value: this.compileValue(value)
          };
        }
        case "merge": {
          const actionArguments = this.arguments(call, "action.merge", 2, 2);
          const path = actionArguments[0];
          const value = actionArguments[1];
          return {
            kind: "merge",
            path: this.statePath(path),
            value: this.objectValue(value, "action.merge value")
          };
        }
        case "toggle": {
          const path = this.arguments(call, "action.toggle", 1, 1)[0];
          return { kind: "toggle", path: this.statePath(path) };
        }
        case "run": {
          const action = this.arguments(call, "action.run", 1, 1)[0];
          return { kind: "run", action: this.stringValue(action, "action name") };
        }
        case "call":
          return this.compileCallAction(call);
        case "if":
          return this.compileIfAction(call);
        case "try":
          return this.compileTryAction(call);
        default:
          this.fail("dsl.action", `action.${member.member}(...) is not supported.`, call.span);
      }
    });
  }
  compileCallAction(call) {
    const actionArguments = this.arguments(call, "action.call", 1, 2);
    const capability = actionArguments[0];
    const options = actionArguments[1];
    const optionsEntries = options ? this.objectEntries(options, "action.call options") : new Map;
    this.rejectUnknownKeys(optionsEntries, new Set(["args", "assign"]), spanOf(call));
    return {
      kind: "call",
      capability: this.compileCapability(capability),
      ...optionsEntries.has("args") ? { args: this.objectValue(this.requiredField(optionsEntries, "args", spanOf(call)), "action.call args") } : {},
      ...optionsEntries.has("assign") ? { assign: this.stringValue(this.requiredField(optionsEntries, "assign", spanOf(call)), "action.call assign") } : {}
    };
  }
  compileIfAction(call) {
    const actionArguments = this.arguments(call, "action.if", 2, 3);
    const condition = actionArguments[0];
    const thenBranch = actionArguments[1];
    const elseBranch = actionArguments[2];
    return {
      kind: "if",
      condition: this.compileValue(condition),
      then: this.compileActionList(thenBranch),
      ...elseBranch ? { else: this.compileActionList(elseBranch) } : {}
    };
  }
  compileTryAction(call) {
    const actionArguments = this.arguments(call, "action.try", 1, 2);
    const body = actionArguments[0];
    const options = actionArguments[1];
    const optionsEntries = options ? this.objectEntries(options, "action.try options") : new Map;
    this.rejectUnknownKeys(optionsEntries, new Set(["catch", "finally"]), spanOf(call));
    return {
      kind: "try",
      body: this.compileActionList(body),
      ...optionsEntries.has("catch") ? { catch: this.compileActionList(this.requiredField(optionsEntries, "catch", spanOf(call))) } : {},
      ...optionsEntries.has("finally") ? { finally: this.compileActionList(this.requiredField(optionsEntries, "finally", spanOf(call))) } : {}
    };
  }
  compileView(expression) {
    return this.resolveStatic(expression, "a view node", (resolved) => {
      const call = this.asCall(resolved, "a view constructor");
      const member = this.memberCall(call.callee);
      if (!member || member.root !== "view") {
        this.fail("dsl.view", "Views must use an imported view.* constructor.", call.span);
      }
      switch (member.member) {
        case "component":
          return this.compileComponentView(call);
        case "text":
          return this.compileTextView(call);
        case "fragment":
          return this.compileFragmentView(call);
        case "when":
          return this.compileWhenView(call);
        case "repeat":
          return this.compileRepeatView(call);
        default:
          this.fail("dsl.view", `view.${member.member}(...) is not supported by the MVP compiler.`, call.span);
      }
    });
  }
  compileComponentView(call) {
    const viewArguments = this.arguments(call, "view.component", 1, 4);
    const component = viewArguments[0];
    const props = viewArguments[1];
    const children = viewArguments[2];
    const events = viewArguments[3];
    return {
      kind: "element",
      component: this.stringValue(component, "component name"),
      props: props ? this.valueRecord(props, "component props") : {},
      events: events ? this.eventsRecord(events) : {},
      children: children ? this.viewList(children) : []
    };
  }
  compileTextView(call) {
    const value = this.arguments(call, "view.text", 1, 1)[0];
    if (this.unwrap(value).type !== "ObjectExpression") {
      return { kind: "text", value: this.compileValue(value) };
    }
    const fields = this.objectEntries(value, "view.text options");
    this.rejectUnknownKeys(fields, new Set(["value"]), spanOf(value));
    return { kind: "text", value: this.compileValue(this.requiredField(fields, "value", spanOf(value))) };
  }
  compileFragmentView(call) {
    const children = this.arguments(call, "view.fragment", 1, 1)[0];
    return { kind: "fragment", children: this.viewList(children) };
  }
  compileWhenView(call) {
    const viewArguments = this.arguments(call, "view.when", 2, 2);
    const condition = viewArguments[0];
    const child = viewArguments[1];
    return {
      kind: "when",
      condition: this.compileValue(condition),
      child: this.compileView(child)
    };
  }
  compileRepeatView(call) {
    const options = this.arguments(call, "view.repeat", 1, 1)[0];
    const fields = this.objectEntries(options, "view.repeat options");
    this.rejectUnknownKeys(fields, new Set(["each", "in", "key", "template"]), spanOf(options));
    return {
      kind: "repeat",
      each: this.stringValue(this.requiredField(fields, "each", spanOf(options)), "repeat item name"),
      in: this.compileValue(this.requiredField(fields, "in", spanOf(options))),
      ...fields.has("key") ? { key: this.compileValue(this.requiredField(fields, "key", spanOf(options))) } : {},
      template: this.compileView(this.requiredField(fields, "template", spanOf(options)))
    };
  }
  viewList(expression) {
    return this.resolveStatic(expression, "a view list", (resolved) => {
      if (resolved.type !== "ArrayExpression") {
        this.fail("dsl.view", "View children must be a static array.", spanOf(resolved));
      }
      return resolved.elements.map((element) => {
        if (!element || element.spread) {
          this.fail("dsl.view", "View children cannot contain holes or spread elements.", resolved.span);
        }
        return this.compileView(element.expression);
      });
    });
  }
  eventsRecord(expression) {
    const entries = this.objectEntries(expression, "component events");
    const result = {};
    for (const [event, action] of entries) {
      result[event] = this.isArray(action) ? this.compileActionList(action) : this.compileAction(action);
    }
    return result;
  }
  compileCapability(expression) {
    return this.resolveStatic(expression, "a capability", (resolved) => {
      const call = this.asCall(resolved, "cap(...)");
      if (this.importedSymbol(call.callee) !== "cap") {
        this.fail("dsl.capability", 'Capabilities must use cap("name").', call.span);
      }
      const name = this.arguments(call, "cap", 1, 1)[0];
      const capability = this.stringValue(name, "capability name");
      this.capabilities.add(capability);
      return capability;
    });
  }
  capabilityList(expression) {
    return this.resolveStatic(expression, "a capability list", (resolved) => {
      if (resolved.type !== "ArrayExpression") {
        this.fail("dsl.capability", "The capabilities field must be a static array of cap(...) calls.", spanOf(resolved));
      }
      return resolved.elements.map((element) => {
        if (!element || element.spread) {
          this.fail("dsl.capability", "Capability lists cannot contain holes or spread elements.", resolved.span);
        }
        return this.compileCapability(element.expression);
      });
    });
  }
  objectValue(expression, context) {
    const entries = this.objectEntries(expression, context);
    const result = {};
    for (const [key, value] of entries) {
      result[key] = this.compileValue(value);
    }
    return { kind: "object", entries: result };
  }
  objectEntries(expression, context) {
    return this.resolveStatic(expression, `an object for ${context}`, (resolved) => {
      if (resolved.type !== "ObjectExpression") {
        this.fail("dsl.object", `${context} must be a static object literal.`, spanOf(resolved));
      }
      const entries = new Map;
      for (const property of resolved.properties) {
        if (property.type === "SpreadElement") {
          this.fail("dsl.object", "Object spread is not supported in the author DSL.", spanOf(property));
        }
        if (property.type !== "KeyValueProperty") {
          this.fail("dsl.object", "Object methods, accessors, and shorthand properties are not supported.", spanOf(property));
        }
        const key = this.propertyName(property.key);
        if (entries.has(key)) {
          this.fail("dsl.object", `The object property "${key}" is declared more than once.`, spanOf(property));
        }
        entries.set(key, property.value);
      }
      return entries;
    });
  }
  propertyName(key) {
    if (key.type === "Identifier" || key.type === "StringLiteral") {
      return key.value;
    }
    if (key.type === "NumericLiteral") {
      return String(key.value);
    }
    this.fail("dsl.object", "Computed and bigint object property names are not supported.", spanOf(key));
  }
  stringValue(expression, context) {
    const value = this.compileValue(expression);
    if (value.kind !== "literal" || typeof value.value !== "string") {
      this.fail("dsl.value", `${context} must be a static string.`, spanOf(this.unwrap(expression)));
    }
    return value.value;
  }
  statePath(expression) {
    const path = this.stringValue(expression, "state path");
    const normalized = path.startsWith("state.") ? path : `state.${path}`;
    if (normalized === "state.") {
      this.fail("dsl.action", "A state path cannot be empty.", spanOf(this.unwrap(expression)));
    }
    return normalized;
  }
  requiredField(fields, key, span) {
    const value = fields.get(key);
    if (!value) {
      this.fail("dsl.object", `The required "${key}" property is missing.`, span);
    }
    return value;
  }
  rejectUnknownKeys(fields, allowed, span) {
    for (const key of fields.keys()) {
      if (!allowed.has(key)) {
        this.fail("dsl.object", `The property "${key}" is not allowed here.`, span);
      }
    }
  }
  asCall(expression, context) {
    const resolved = this.unwrap(expression);
    if (resolved.type !== "CallExpression") {
      this.fail("dsl.call", `${context} must be a call to a supported DSL constructor.`, spanOf(resolved));
    }
    return resolved;
  }
  arguments(call, name, minimum, maximum = Number.POSITIVE_INFINITY) {
    if (call.arguments.length < minimum || call.arguments.length > maximum) {
      this.fail("dsl.arguments", `${name} expects ${argumentCountLabel(minimum, maximum)}.`, call.span);
    }
    return call.arguments.map((argument) => {
      if (argument.spread) {
        this.fail("dsl.arguments", `${name} does not accept spread arguments.`, call.span);
      }
      return argument.expression;
    });
  }
  memberCall(callee) {
    const resolved = this.unwrapCallee(callee);
    if (resolved.type !== "MemberExpression" || resolved.object.type !== "Identifier" || resolved.property.type !== "Identifier") {
      return;
    }
    const root = this.imports.get(resolved.object.value);
    return root ? { root, member: resolved.property.value } : undefined;
  }
  importedSymbol(expression) {
    const resolved = this.unwrapCallee(expression);
    return resolved.type === "Identifier" ? this.imports.get(resolved.value) : undefined;
  }
  resolveStatic(expression, _context, compile) {
    const resolved = this.unwrap(expression);
    if (resolved.type !== "Identifier" || !this.constants.has(resolved.value)) {
      return compile(resolved);
    }
    const binding = this.constants.get(resolved.value);
    if (this.resolvingConstants.has(resolved.value)) {
      this.fail("dsl.static.circular", `The static const "${resolved.value}" forms a circular reference.`, resolved.span);
    }
    if (binding.index >= this.constantLimit) {
      this.fail("dsl.static.order", `The static const "${resolved.value}" must be declared before the value that references it.`, resolved.span);
    }
    const previousLimit = this.constantLimit;
    this.constantLimit = binding.index;
    this.resolvingConstants.add(resolved.value);
    try {
      return this.resolveStatic(binding.expression, _context, compile);
    } finally {
      this.resolvingConstants.delete(resolved.value);
      this.constantLimit = previousLimit;
    }
  }
  unwrap(expression) {
    if (expression.type === "ParenthesisExpression" || expression.type === "TsAsExpression" || expression.type === "TsConstAssertion" || expression.type === "TsNonNullExpression" || expression.type === "TsSatisfiesExpression" || expression.type === "TsTypeAssertion" || expression.type === "TsInstantiation") {
      return this.unwrap(expression.expression);
    }
    return expression;
  }
  unwrapCallee(expression) {
    if (expression.type === "Super" || expression.type === "Import") {
      return expression;
    }
    return this.unwrap(expression);
  }
  isArray(expression) {
    return this.unwrap(expression).type === "ArrayExpression";
  }
  fail(code, message, span) {
    throw new CompileFailure(code, message, span);
  }
}
function argumentCountLabel(minimum, maximum) {
  if (minimum === maximum) {
    return `${minimum} argument${minimum === 1 ? "" : "s"}`;
  }
  if (maximum === Number.POSITIVE_INFINITY) {
    return `at least ${minimum} arguments`;
  }
  return `${minimum} to ${maximum} arguments`;
}
function spanOf(value) {
  if (typeof value === "object" && value !== null && "span" in value) {
    const span = value.span;
    if (typeof span === "object" && span !== null && "start" in span && "end" in span && typeof span.start === "number" && typeof span.end === "number") {
      return { start: span.start, end: span.end };
    }
  }
  return;
}
function toIssue(source, error) {
  if (error instanceof CompileFailure) {
    return {
      code: error.code,
      message: error.message,
      ...error.span ? { location: sourceLocation(source, error.span.start) } : {}
    };
  }
  return {
    code: "dsl.syntax",
    message: error instanceof Error ? error.message : "Unable to parse the author module.",
    location: sourceLocation(source, 1)
  };
}
function sourceLocation(source, start) {
  const offset = sourceOffsetFromUtf8BytePosition(source, Math.max(0, start - 1));
  const before = source.slice(0, offset);
  const line = before.split(`
`).length;
  const lastLineBreak = before.lastIndexOf(`
`);
  return {
    line,
    column: offset - lastLineBreak,
    offset
  };
}
function sourceOffsetFromUtf8BytePosition(source, bytePosition) {
  let byteOffset = 0;
  let sourceOffset = 0;
  while (sourceOffset < source.length && byteOffset < bytePosition) {
    const codePoint = source.codePointAt(sourceOffset);
    const width = codePoint > 65535 ? 2 : 1;
    const utf8Length = codePoint <= 127 ? 1 : codePoint <= 2047 ? 2 : codePoint <= 65535 ? 3 : 4;
    if (byteOffset + utf8Length > bytePosition) {
      break;
    }
    byteOffset += utf8Length;
    sourceOffset += width;
  }
  return sourceOffset;
}
export {
  compileAuthorModule
};
