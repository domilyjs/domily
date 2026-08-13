import { parseSync, type Argument, type Expression, type Module, type ObjectExpression, type PropertyName } from '@swc/core';
import {
  freezeDocument,
  type ActionNode,
  type CodecIssue,
  type CodecResult,
  type Document,
  type ExpressionOperator,
  type JsonPrimitive,
  type ObjectNode,
  type ValueNode,
  type ViewNode,
} from '@domily/next-ast';

const dslModule = '@domily/next';
const dslSymbols = new Set(['action', 'cap', 'defineDocument', 'derived', 'event', 'ref', 'state', 'view']);
const expressionOperators = new Set<ExpressionOperator>([
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

interface Span {
  start: number;
  end: number;
}

interface StaticConstant {
  expression: Expression;
  index: number;
  span: Span;
}

interface MemberCall {
  root: string;
  member: string;
}

class CompileFailure extends Error {
  readonly code: string;
  readonly span?: Span;

  constructor(code: string, message: string, span?: Span) {
    super(message);
    this.code = code;
    this.span = span;
  }
}

/**
 * Compiles the restricted, static `.domily.ts` author DSL into the protocol AST.
 * The compiler only reads a TypeScript syntax tree; it never executes author code.
 */
export function compileAuthorModule(source: string): CodecResult<Document> {
  try {
    const module = parseSync(source, {
      syntax: 'typescript',
      target: 'es2022',
    });
    const compiler = new AuthorModuleCompiler(source, module);

    return {
      ok: true,
      value: compiler.compile(),
      issues: [],
    };
  } catch (error) {
    return {
      ok: false,
      issues: [toIssue(source, error)],
    };
  }
}

class AuthorModuleCompiler {
  private readonly imports = new Map<string, string>();
  private readonly constants = new Map<string, StaticConstant>();
  private readonly resolvingConstants = new Set<string>();
  private readonly capabilities = new Set<string>();
  private documentExpression?: Expression;
  private documentIndex = -1;
  private constantLimit = -1;

  constructor(
    private readonly source: string,
    private readonly module: Module,
  ) {}

  compile(): Document {
    this.collectModuleBindings();
    if (!this.documentExpression || this.documentIndex < 0) {
      this.fail('dsl.document', 'The module must default-export exactly one defineDocument(...) call.');
    }

    this.constantLimit = this.documentIndex;
    const document = this.compileDocument(this.documentExpression);
    return freezeDocument(document);
  }

  private collectModuleBindings(): void {
    for (const [index, item] of this.module.body.entries()) {
      switch (item.type) {
        case 'ImportDeclaration':
          this.collectImport(item);
          break;
        case 'VariableDeclaration':
          this.collectConstants(item, index);
          break;
        case 'ExportDefaultExpression':
          if (this.documentExpression) {
            this.fail('dsl.document', 'A Domily author module can default-export only one document.', item.span);
          }
          this.documentExpression = item.expression;
          this.documentIndex = index;
          break;
        case 'TsInterfaceDeclaration':
        case 'TsTypeAliasDeclaration':
          break;
        default:
          this.fail(
            'dsl.module',
            'Only imports, top-level const declarations, type declarations, and one default export are allowed.',
            item.span,
          );
      }
    }
  }

  private collectImport(declaration: Extract<Module['body'][number], { type: 'ImportDeclaration' }>): void {
    if (declaration.typeOnly) {
      return;
    }
    if (declaration.source.value !== dslModule) {
      this.fail('dsl.import', `Only type-only imports or named DSL imports from "${dslModule}" are allowed.`, declaration.span);
    }

    for (const specifier of declaration.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.isTypeOnly) {
        continue;
      }
      if (specifier.type !== 'ImportSpecifier') {
        this.fail('dsl.import', 'DSL imports must be named imports.', specifier.span);
      }

      const imported = specifier.imported?.value ?? specifier.local.value;
      if (!dslSymbols.has(imported)) {
        this.fail('dsl.import', `"${imported}" is not a supported Domily DSL constructor.`, specifier.span);
      }
      if (this.imports.has(specifier.local.value)) {
        this.fail('dsl.import', `The local DSL binding "${specifier.local.value}" is declared more than once.`, specifier.span);
      }
      this.imports.set(specifier.local.value, imported);
    }
  }

  private collectConstants(declaration: Extract<Module['body'][number], { type: 'VariableDeclaration' }>, index: number): void {
    if (declaration.kind !== 'const' || declaration.declare) {
      this.fail('dsl.static', 'Only initialized top-level const declarations are allowed.', declaration.span);
    }

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) {
        this.fail('dsl.static', 'A static const must use an identifier and an initializer.', declarator.span);
      }
      if (this.imports.has(declarator.id.value) || this.constants.has(declarator.id.value)) {
        this.fail('dsl.static', `The static binding "${declarator.id.value}" is declared more than once.`, declarator.span);
      }
      this.constants.set(declarator.id.value, {
        expression: declarator.init,
        index,
        span: declarator.span,
      });
    }
  }

  private compileDocument(expression: Expression): Document {
    const call = this.asCall(expression, 'defineDocument(...)');
    if (this.importedSymbol(call.callee) !== 'defineDocument') {
      this.fail('dsl.document', 'The default export must call the imported defineDocument constructor.', call.span);
    }
    const [definition] = this.arguments(call, 'defineDocument', 1, 1);
    const fields = this.objectEntries(definition, 'defineDocument(...)');
    this.rejectUnknownKeys(fields, new Set(['actions', 'capabilities', 'derived', 'id', 'lifecycle', 'state', 'view']), definition);

    const id = this.stringValue(this.requiredField(fields, 'id', definition), 'document id');
    const declaredCapabilities = fields.has('capabilities')
      ? this.capabilityList(this.requiredField(fields, 'capabilities', definition))
      : [];
    const state = this.compileState(this.requiredField(fields, 'state', definition));
    const derived = fields.has('derived')
      ? this.valueRecord(this.requiredField(fields, 'derived', definition), 'derived')
      : {};
    const actions = fields.has('actions')
      ? this.actionsRecord(this.requiredField(fields, 'actions', definition))
      : {};
    const lifecycle = fields.has('lifecycle')
      ? this.lifecycleRecord(this.requiredField(fields, 'lifecycle', definition))
      : {};
    const view = this.compileView(this.requiredField(fields, 'view', definition));

    for (const capability of declaredCapabilities) {
      this.capabilities.add(capability);
    }

    return {
      kind: 'document',
      protocol: 'domily-next',
      version: '0.1',
      meta: {
        id,
        capabilities: [...this.capabilities],
      },
      state,
      derived,
      actions,
      lifecycle,
      view,
    };
  }

  private compileState(expression: Expression): ObjectNode {
    return this.resolveStatic(expression, 'a state declaration', (resolved) => {
      const call = this.asCall(resolved, 'state(...)');
      if (this.importedSymbol(call.callee) !== 'state') {
        this.fail('dsl.state', 'The state field must use state({...}).', call.span);
      }
      const [value] = this.arguments(call, 'state', 1, 1);
      return this.objectValue(value, 'state');
    });
  }

  private valueRecord(expression: Expression, context: string): Record<string, ValueNode> {
    const entries = this.objectEntries(expression, context);
    const result: Record<string, ValueNode> = {};
    for (const [key, value] of entries) {
      result[key] = this.compileValue(value);
    }
    return result;
  }

  private actionsRecord(expression: Expression): Record<string, ActionNode[]> {
    const entries = this.objectEntries(expression, 'actions');
    const result: Record<string, ActionNode[]> = {};
    for (const [key, value] of entries) {
      result[key] = this.compileActionList(value);
    }
    return result;
  }

  private lifecycleRecord(expression: Expression): Record<string, ActionNode | ActionNode[]> {
    const entries = this.objectEntries(expression, 'lifecycle');
    const result: Record<string, ActionNode | ActionNode[]> = {};
    for (const [key, value] of entries) {
      result[key] = this.isArray(value) ? this.compileActionList(value) : this.compileAction(value);
    }
    return result;
  }

  private compileValue(expression: Expression): ValueNode {
    return this.resolveStatic(expression, 'a value', (resolved) => {
      switch (resolved.type) {
        case 'NullLiteral':
          return { kind: 'literal', value: null };
        case 'BooleanLiteral':
        case 'NumericLiteral':
        case 'StringLiteral':
          return { kind: 'literal', value: resolved.value };
        case 'TemplateLiteral':
          if (resolved.expressions.length !== 0 || resolved.quasis.length !== 1) {
            this.fail('dsl.value', 'Template literals may contain only one static text segment.', resolved.span);
          }
          return { kind: 'literal', value: resolved.quasis[0]?.cooked ?? resolved.quasis[0]?.raw ?? '' };
        case 'ArrayExpression':
          return {
            kind: 'array',
            items: resolved.elements.map((element) => {
              if (!element || element.spread) {
                this.fail('dsl.value', 'Array holes and spread elements are not supported.', resolved.span);
              }
              return this.compileValue(element.expression);
            }),
          };
        case 'ObjectExpression':
          return this.objectValue(resolved, 'object value');
        case 'CallExpression':
          return this.compileValueCall(resolved);
        case 'Identifier':
          this.fail('dsl.value', `"${resolved.value}" is not a static Domily value.`, resolved.span);
        default:
          this.fail('dsl.value', `${resolved.type} is not a supported static Domily value.`, resolved.span);
      }
    });
  }

  private compileValueCall(expression: Extract<Expression, { type: 'CallExpression' }>): ValueNode {
    const member = this.memberCall(expression.callee);
    if (member?.root === 'ref') {
      return this.compileReference(member.member, this.arguments(expression, `ref.${member.member}`, 1, 2), expression.span);
    }
    if (member?.root === 'event') {
      const supportedEvents = new Set(['checked', 'key', 'value']);
      if (!supportedEvents.has(member.member)) {
        this.fail('dsl.event', `event.${member.member}() is not supported.`, expression.span);
      }
      this.arguments(expression, `event.${member.member}`, 0, 0);
      return { kind: 'reference', path: `event.${member.member}` };
    }
    if (member?.root === 'derived') {
      if (!expressionOperators.has(member.member as ExpressionOperator)) {
        this.fail('dsl.derived', `derived.${member.member}(...) is not supported.`, expression.span);
      }
      return {
        kind: 'expression',
        op: member.member as ExpressionOperator,
        args: this.arguments(expression, `derived.${member.member}`, 1).map((argument) => this.compileValue(argument)),
      };
    }
    this.fail('dsl.call', 'Only ref.*, event.*, and derived.* calls can produce a Domily value.', expression.span);
  }

  private compileReference(member: string, argumentsList: Expression[], span: Span): ValueNode {
    switch (member) {
      case 'state':
        return { kind: 'reference', path: `state.${this.stringValue(argumentsList[0]!, 'state reference')}` };
      case 'derived':
        return { kind: 'reference', path: `derived.${this.stringValue(argumentsList[0]!, 'derived reference')}` };
      case 'var':
        return { kind: 'reference', path: `vars.${this.stringValue(argumentsList[0]!, 'variable reference')}` };
      case 'error':
        return { kind: 'reference', path: `vars.error.${this.stringValue(argumentsList[0]!, 'error reference')}` };
      case 'item': {
        const each = this.stringValue(argumentsList[0]!, 'repeat item name');
        const path = argumentsList[1] ? this.stringValue(argumentsList[1], 'repeat item path') : '';
        return { kind: 'reference', path: path === '' ? each : `${each}.${path}` };
      }
      default:
        this.fail('dsl.reference', `ref.${member}(...) is not supported.`, span);
    }
  }

  private compileActionList(expression: Expression): ActionNode[] {
    return this.resolveStatic(expression, 'an action list', (resolved) => {
      if (resolved.type !== 'ArrayExpression') {
        return [this.compileAction(resolved)];
      }
      return resolved.elements.map((element) => {
        if (!element || element.spread) {
          this.fail('dsl.action', 'Action lists cannot contain holes or spread elements.', resolved.span);
        }
        return this.compileAction(element.expression);
      });
    });
  }

  private compileAction(expression: Expression): ActionNode {
    return this.resolveStatic(expression, 'an action', (resolved) => {
      const call = this.asCall(resolved, 'an action constructor');
      const member = this.memberCall(call.callee);
      if (!member || member.root !== 'action') {
        this.fail('dsl.action', 'Actions must use an imported action.* constructor.', call.span);
      }

      switch (member.member) {
        case 'set': {
          const [path, value] = this.arguments(call, 'action.set', 2, 2);
          return {
            kind: 'set',
            path: this.statePath(path),
            value: this.compileValue(value),
          };
        }
        case 'merge': {
          const [path, value] = this.arguments(call, 'action.merge', 2, 2);
          return {
            kind: 'merge',
            path: this.statePath(path),
            value: this.objectValue(value, 'action.merge value'),
          };
        }
        case 'toggle': {
          const [path] = this.arguments(call, 'action.toggle', 1, 1);
          return { kind: 'toggle', path: this.statePath(path) };
        }
        case 'run': {
          const [action] = this.arguments(call, 'action.run', 1, 1);
          return { kind: 'run', action: this.stringValue(action, 'action name') };
        }
        case 'call':
          return this.compileCallAction(call);
        case 'if':
          return this.compileIfAction(call);
        case 'try':
          return this.compileTryAction(call);
        default:
          this.fail('dsl.action', `action.${member.member}(...) is not supported.`, call.span);
      }
    });
  }

  private compileCallAction(call: Extract<Expression, { type: 'CallExpression' }>): ActionNode {
    const [capability, options] = this.arguments(call, 'action.call', 1, 2);
    const optionsEntries = options ? this.objectEntries(options, 'action.call options') : new Map<string, Expression>();
    this.rejectUnknownKeys(optionsEntries, new Set(['args', 'assign']), call);

    return {
      kind: 'call',
      capability: this.compileCapability(capability),
      ...(optionsEntries.has('args')
        ? { args: this.objectValue(this.requiredField(optionsEntries, 'args', call), 'action.call args') }
        : {}),
      ...(optionsEntries.has('assign')
        ? { assign: this.stringValue(this.requiredField(optionsEntries, 'assign', call), 'action.call assign') }
        : {}),
    };
  }

  private compileIfAction(call: Extract<Expression, { type: 'CallExpression' }>): ActionNode {
    const [condition, thenBranch, elseBranch] = this.arguments(call, 'action.if', 2, 3);
    return {
      kind: 'if',
      condition: this.compileValue(condition),
      then: this.compileActionList(thenBranch),
      ...(elseBranch ? { else: this.compileActionList(elseBranch) } : {}),
    };
  }

  private compileTryAction(call: Extract<Expression, { type: 'CallExpression' }>): ActionNode {
    const [body, options] = this.arguments(call, 'action.try', 1, 2);
    const optionsEntries = options ? this.objectEntries(options, 'action.try options') : new Map<string, Expression>();
    this.rejectUnknownKeys(optionsEntries, new Set(['catch', 'finally']), call);
    return {
      kind: 'try',
      body: this.compileActionList(body),
      ...(optionsEntries.has('catch')
        ? { catch: this.compileActionList(this.requiredField(optionsEntries, 'catch', call)) }
        : {}),
      ...(optionsEntries.has('finally')
        ? { finally: this.compileActionList(this.requiredField(optionsEntries, 'finally', call)) }
        : {}),
    };
  }

  private compileView(expression: Expression): ViewNode {
    return this.resolveStatic(expression, 'a view node', (resolved) => {
      const call = this.asCall(resolved, 'a view constructor');
      const member = this.memberCall(call.callee);
      if (!member || member.root !== 'view') {
        this.fail('dsl.view', 'Views must use an imported view.* constructor.', call.span);
      }

      switch (member.member) {
        case 'component':
          return this.compileComponentView(call);
        case 'text':
          return this.compileTextView(call);
        case 'fragment':
          return this.compileFragmentView(call);
        case 'when':
          return this.compileWhenView(call);
        case 'repeat':
          return this.compileRepeatView(call);
        default:
          this.fail('dsl.view', `view.${member.member}(...) is not supported by the MVP compiler.`, call.span);
      }
    });
  }

  private compileComponentView(call: Extract<Expression, { type: 'CallExpression' }>): ViewNode {
    const [component, props, children, events] = this.arguments(call, 'view.component', 1, 4);
    return {
      kind: 'element',
      component: this.stringValue(component, 'component name'),
      props: props ? this.valueRecord(props, 'component props') : {},
      events: events ? this.eventsRecord(events) : {},
      children: children ? this.viewList(children) : [],
    };
  }

  private compileTextView(call: Extract<Expression, { type: 'CallExpression' }>): ViewNode {
    const [value] = this.arguments(call, 'view.text', 1, 1);
    if (this.unwrap(value).type !== 'ObjectExpression') {
      return { kind: 'text', value: this.compileValue(value) };
    }
    const fields = this.objectEntries(value, 'view.text options');
    this.rejectUnknownKeys(fields, new Set(['value']), value);
    return { kind: 'text', value: this.compileValue(this.requiredField(fields, 'value', value)) };
  }

  private compileFragmentView(call: Extract<Expression, { type: 'CallExpression' }>): ViewNode {
    const [children] = this.arguments(call, 'view.fragment', 1, 1);
    return { kind: 'fragment', children: this.viewList(children) };
  }

  private compileWhenView(call: Extract<Expression, { type: 'CallExpression' }>): ViewNode {
    const [condition, child] = this.arguments(call, 'view.when', 2, 2);
    return {
      kind: 'when',
      condition: this.compileValue(condition),
      child: this.compileView(child),
    };
  }

  private compileRepeatView(call: Extract<Expression, { type: 'CallExpression' }>): ViewNode {
    const [options] = this.arguments(call, 'view.repeat', 1, 1);
    const fields = this.objectEntries(options, 'view.repeat options');
    this.rejectUnknownKeys(fields, new Set(['each', 'in', 'key', 'template']), options);
    return {
      kind: 'repeat',
      each: this.stringValue(this.requiredField(fields, 'each', options), 'repeat item name'),
      in: this.compileValue(this.requiredField(fields, 'in', options)),
      ...(fields.has('key') ? { key: this.compileValue(this.requiredField(fields, 'key', options)) } : {}),
      template: this.compileView(this.requiredField(fields, 'template', options)),
    };
  }

  private viewList(expression: Expression): ViewNode[] {
    return this.resolveStatic(expression, 'a view list', (resolved) => {
      if (resolved.type !== 'ArrayExpression') {
        this.fail('dsl.view', 'View children must be a static array.', resolved.span);
      }
      return resolved.elements.map((element) => {
        if (!element || element.spread) {
          this.fail('dsl.view', 'View children cannot contain holes or spread elements.', resolved.span);
        }
        return this.compileView(element.expression);
      });
    });
  }

  private eventsRecord(expression: Expression): Record<string, ActionNode | ActionNode[]> {
    const entries = this.objectEntries(expression, 'component events');
    const result: Record<string, ActionNode | ActionNode[]> = {};
    for (const [event, action] of entries) {
      result[event] = this.isArray(action) ? this.compileActionList(action) : this.compileAction(action);
    }
    return result;
  }

  private compileCapability(expression: Expression): string {
    return this.resolveStatic(expression, 'a capability', (resolved) => {
      const call = this.asCall(resolved, 'cap(...)');
      if (this.importedSymbol(call.callee) !== 'cap') {
        this.fail('dsl.capability', 'Capabilities must use cap("name").', call.span);
      }
      const [name] = this.arguments(call, 'cap', 1, 1);
      const capability = this.stringValue(name, 'capability name');
      this.capabilities.add(capability);
      return capability;
    });
  }

  private capabilityList(expression: Expression): string[] {
    return this.resolveStatic(expression, 'a capability list', (resolved) => {
      if (resolved.type !== 'ArrayExpression') {
        this.fail('dsl.capability', 'The capabilities field must be a static array of cap(...) calls.', resolved.span);
      }
      return resolved.elements.map((element) => {
        if (!element || element.spread) {
          this.fail('dsl.capability', 'Capability lists cannot contain holes or spread elements.', resolved.span);
        }
        return this.compileCapability(element.expression);
      });
    });
  }

  private objectValue(expression: Expression, context: string): ObjectNode {
    const entries = this.objectEntries(expression, context);
    const result: Record<string, ValueNode> = {};
    for (const [key, value] of entries) {
      result[key] = this.compileValue(value);
    }
    return { kind: 'object', entries: result };
  }

  private objectEntries(expression: Expression, context: string): Map<string, Expression> {
    return this.resolveStatic(expression, `an object for ${context}`, (resolved) => {
      if (resolved.type !== 'ObjectExpression') {
        this.fail('dsl.object', `${context} must be a static object literal.`, resolved.span);
      }

      const entries = new Map<string, Expression>();
      for (const property of resolved.properties) {
        if (property.type === 'SpreadElement') {
          this.fail('dsl.object', 'Object spread is not supported in the author DSL.', property.span);
        }
        if (property.type !== 'KeyValueProperty') {
          this.fail('dsl.object', 'Object methods, accessors, and shorthand properties are not supported.', property.span);
        }
        const key = this.propertyName(property.key);
        if (entries.has(key)) {
          this.fail('dsl.object', `The object property "${key}" is declared more than once.`, property.span);
        }
        entries.set(key, property.value);
      }
      return entries;
    });
  }

  private propertyName(key: PropertyName): string {
    if (key.type === 'Identifier' || key.type === 'StringLiteral') {
      return key.value;
    }
    if (key.type === 'NumericLiteral') {
      return String(key.value);
    }
    this.fail('dsl.object', 'Computed and bigint object property names are not supported.', key.span);
  }

  private stringValue(expression: Expression, context: string): string {
    const value = this.compileValue(expression);
    if (value.kind !== 'literal' || typeof value.value !== 'string') {
      this.fail('dsl.value', `${context} must be a static string.`, this.unwrap(expression).span);
    }
    return value.value;
  }

  private statePath(expression: Expression): `state.${string}` {
    const path = this.stringValue(expression, 'state path');
    const normalized = path.startsWith('state.') ? path : `state.${path}`;
    if (normalized === 'state.') {
      this.fail('dsl.action', 'A state path cannot be empty.', this.unwrap(expression).span);
    }
    return normalized;
  }

  private requiredField(fields: Map<string, Expression>, key: string, owner: { span: Span }): Expression {
    const value = fields.get(key);
    if (!value) {
      this.fail('dsl.object', `The required "${key}" property is missing.`, owner.span);
    }
    return value;
  }

  private rejectUnknownKeys(fields: Map<string, Expression>, allowed: Set<string>, owner: { span: Span }): void {
    for (const key of fields.keys()) {
      if (!allowed.has(key)) {
        this.fail('dsl.object', `The property "${key}" is not allowed here.`, owner.span);
      }
    }
  }

  private asCall(expression: Expression, context: string): Extract<Expression, { type: 'CallExpression' }> {
    const resolved = this.unwrap(expression);
    if (resolved.type !== 'CallExpression') {
      this.fail('dsl.call', `${context} must be a call to a supported DSL constructor.`, resolved.span);
    }
    return resolved;
  }

  private arguments(
    call: Extract<Expression, { type: 'CallExpression' }>,
    name: string,
    minimum: number,
    maximum = Number.POSITIVE_INFINITY,
  ): Expression[] {
    if (call.arguments.length < minimum || call.arguments.length > maximum) {
      this.fail('dsl.arguments', `${name} expects ${argumentCountLabel(minimum, maximum)}.`, call.span);
    }
    return call.arguments.map((argument: Argument) => {
      if (argument.spread) {
        this.fail('dsl.arguments', `${name} does not accept spread arguments.`, call.span);
      }
      return argument.expression;
    });
  }

  private memberCall(callee: Expression | { type: 'Super' | 'Import' }): MemberCall | undefined {
    const resolved = this.unwrap(callee);
    if (resolved.type !== 'MemberExpression' || resolved.object.type !== 'Identifier' || resolved.property.type !== 'Identifier') {
      return undefined;
    }
    const root = this.imports.get(resolved.object.value);
    return root ? { root, member: resolved.property.value } : undefined;
  }

  private importedSymbol(expression: Expression | { type: 'Super' | 'Import' }): string | undefined {
    const resolved = this.unwrap(expression);
    return resolved.type === 'Identifier' ? this.imports.get(resolved.value) : undefined;
  }

  private resolveStatic<T>(expression: Expression, context: string, compile: (resolved: Expression) => T): T {
    const resolved = this.unwrap(expression);
    if (resolved.type !== 'Identifier' || !this.constants.has(resolved.value)) {
      return compile(resolved);
    }

    const binding = this.constants.get(resolved.value)!;
    if (this.resolvingConstants.has(resolved.value)) {
      this.fail('dsl.static.circular', `The static const "${resolved.value}" forms a circular reference.`, resolved.span);
    }
    if (binding.index >= this.constantLimit) {
      this.fail(
        'dsl.static.order',
        `The static const "${resolved.value}" must be declared before the value that references it.`,
        resolved.span,
      );
    }

    const previousLimit = this.constantLimit;
    this.constantLimit = binding.index;
    this.resolvingConstants.add(resolved.value);
    try {
      return compile(binding.expression);
    } finally {
      this.resolvingConstants.delete(resolved.value);
      this.constantLimit = previousLimit;
    }
  }

  private unwrap(expression: Expression | { type: 'Super' | 'Import' }): Expression | { type: 'Super' | 'Import' } {
    if (
      expression.type === 'ParenthesisExpression' ||
      expression.type === 'TsAsExpression' ||
      expression.type === 'TsConstAssertion' ||
      expression.type === 'TsNonNullExpression' ||
      expression.type === 'TsSatisfiesExpression' ||
      expression.type === 'TsTypeAssertion' ||
      expression.type === 'TsInstantiation'
    ) {
      return this.unwrap(expression.expression);
    }
    return expression;
  }

  private isArray(expression: Expression): boolean {
    return this.unwrap(expression).type === 'ArrayExpression';
  }

  private fail(code: string, message: string, span?: Span): never {
    throw new CompileFailure(code, message, span);
  }
}

function argumentCountLabel(minimum: number, maximum: number): string {
  if (minimum === maximum) {
    return `${minimum} argument${minimum === 1 ? '' : 's'}`;
  }
  if (maximum === Number.POSITIVE_INFINITY) {
    return `at least ${minimum} arguments`;
  }
  return `${minimum} to ${maximum} arguments`;
}

function toIssue(source: string, error: unknown): CodecIssue {
  if (error instanceof CompileFailure) {
    return {
      code: error.code,
      message: error.message,
      ...(error.span ? { location: sourceLocation(source, error.span.start) } : {}),
    };
  }
  return {
    code: 'dsl.syntax',
    message: error instanceof Error ? error.message : 'Unable to parse the author module.',
    location: sourceLocation(source, 1),
  };
}

function sourceLocation(source: string, start: number): { line: number; column: number; offset: number } {
  const offset = Math.max(0, start - 1);
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const lastLineBreak = before.lastIndexOf('\n');
  return {
    line,
    column: offset - lastLineBreak,
    offset,
  };
}
