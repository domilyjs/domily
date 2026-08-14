import type {
  ActionNode,
  Document,
  ExpressionNode,
  JsonValue,
  ValueNode,
} from '../ast/index.ts';

export type RuntimeValue = JsonValue;
export type RuntimeObject = Record<string, RuntimeValue>;

export interface CapabilityContext {
  document: Document;
  event: RuntimeValue | undefined;
  props: RuntimeValue | undefined;
}

export interface RuntimeCapability {
  authorize?(context: CapabilityContext): boolean | Promise<boolean>;
  execute(args: RuntimeValue, context: CapabilityContext): RuntimeValue | Promise<RuntimeValue>;
}

export interface RuntimeLimits {
  maxActionDepth: number;
  maxActionSteps: number;
  maxDerivedDepth: number;
}

export interface RuntimeTrace {
  actionPath?: string;
  capability?: string;
  durationMs?: number;
  error?: { code: string };
  kind: 'action' | 'capability' | 'error' | 'state.write';
  statePath?: string;
}

export interface DispatchOptions {
  event?: RuntimeValue;
  scope?: Record<string, RuntimeValue>;
}

export interface DispatchResult {
  state: RuntimeObject;
  trace: readonly RuntimeTrace[];
}

export interface DocumentRuntimeOptions {
  capabilities?: ReadonlyMap<string, RuntimeCapability> | Readonly<Record<string, RuntimeCapability>>;
  limits?: Partial<RuntimeLimits>;
  now?: () => number;
  onTrace?: (trace: RuntimeTrace) => void;
  props?: RuntimeValue;
}

interface Transaction {
  derivedCache: Map<string, RuntimeValue>;
  derivedStack: string[];
  draft: RuntimeObject;
  event: RuntimeValue | undefined;
  scope: RuntimeObject;
  steps: number;
  trace: RuntimeTrace[];
}

const DEFAULT_LIMITS: RuntimeLimits = {
  maxActionDepth: 16,
  maxActionSteps: 128,
  maxDerivedDepth: 32,
};

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** A deterministic failure raised while interpreting a Domily Next document. */
export class RuntimeExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeExecutionError';
  }
}

/**
 * DOM-free, transactional interpreter for a validated Domily Next document.
 * Hosts own rendering and all real side effects through registered capabilities.
 */
export class DocumentRuntime {
  private readonly capabilities: ReadonlyMap<string, RuntimeCapability>;
  private readonly limits: RuntimeLimits;
  private readonly listeners = new Set<(state: RuntimeObject) => void>();
  private readonly now: () => number;
  private readonly props: RuntimeValue | undefined;
  private state: RuntimeObject;

  constructor(
    readonly document: Document,
    private readonly options: DocumentRuntimeOptions = {},
  ) {
    this.capabilities = toCapabilityMap(options.capabilities);
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    validateLimits(this.limits);
    this.now = options.now ?? Date.now;
    this.props = options.props === undefined ? undefined : cloneRuntimeValue(options.props, 'props');
    this.state = toRuntimeObject(evaluateInitialValue(document.state, 'document.state'), 'document.state');
  }

  getState(): RuntimeObject {
    return toRuntimeObject(cloneRuntimeValue(this.state, 'state'), 'state');
  }

  subscribe(listener: (state: RuntimeObject) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  evaluate(value: ValueNode, options: DispatchOptions = {}): RuntimeValue {
    const transaction = this.createTransaction(options);
    return requireRuntimeValue(this.evaluateValue(value, transaction), 'runtime.evaluate result');
  }

  async dispatch(actions: ActionNode | readonly ActionNode[], options: DispatchOptions = {}): Promise<DispatchResult> {
    return this.executeTransaction(toActionList(actions), options, 'dispatch');
  }

  async runAction(name: string, options: DispatchOptions = {}): Promise<DispatchResult> {
    const actions = this.document.actions[name];
    if (!actions) {
      throw new RuntimeExecutionError('runtime.action.unknown', `Action "${name}" is not declared.`);
    }
    return this.executeTransaction(actions, options, `actions.${name}`);
  }

  async runLifecycle(name: string, options: DispatchOptions = {}): Promise<DispatchResult> {
    const lifecycle = this.document.lifecycle[name];
    if (!lifecycle) {
      throw new RuntimeExecutionError('runtime.lifecycle.unknown', `Lifecycle "${name}" is not declared.`);
    }
    return this.executeTransaction(toActionList(lifecycle), options, `lifecycle.${name}`);
  }

  private async executeTransaction(
    actions: readonly ActionNode[],
    options: DispatchOptions,
    source: string,
  ): Promise<DispatchResult> {
    const transaction = this.createTransaction(options);
    try {
      await this.executeActions(actions, transaction, {}, source, 0);
      this.state = toRuntimeObject(cloneRuntimeValue(transaction.draft, 'committed state'), 'committed state');
      this.notifySubscribers();
      return { state: this.getState(), trace: cloneTrace(transaction.trace) };
    } catch (error) {
      const runtimeError = toRuntimeError(error, 'runtime.action.failed', 'Action execution failed.');
      this.addTrace(transaction, { kind: 'error', actionPath: source, error: { code: runtimeError.code } });
      throw runtimeError;
    }
  }

  private createTransaction(options: DispatchOptions): Transaction {
    return {
      derivedCache: new Map(),
      derivedStack: [],
      draft: this.getState(),
      event: options.event === undefined ? undefined : cloneRuntimeValue(options.event, 'event'),
      scope: toRuntimeObject(cloneRuntimeValue(options.scope ?? {}, 'scope'), 'scope'),
      steps: 0,
      trace: [],
    };
  }

  private async executeActions(
    actions: readonly ActionNode[],
    transaction: Transaction,
    vars: RuntimeObject,
    path: string,
    actionDepth: number,
  ): Promise<void> {
    if (actionDepth > this.limits.maxActionDepth) {
      throw new RuntimeExecutionError('runtime.action.depth-exceeded', 'Maximum action nesting depth exceeded.');
    }

    for (const [index, action] of actions.entries()) {
      transaction.steps += 1;
      const actionPath = `${path}[${index}]`;
      if (transaction.steps > this.limits.maxActionSteps) {
        throw new RuntimeExecutionError('runtime.action.step-limit', 'Maximum action step count exceeded.');
      }
      await this.executeAction(action, transaction, vars, actionPath, actionDepth);
      this.addTrace(transaction, { kind: 'action', actionPath });
    }
  }

  private async executeAction(
    action: ActionNode,
    transaction: Transaction,
    vars: RuntimeObject,
    actionPath: string,
    actionDepth: number,
  ): Promise<void> {
    switch (action.kind) {
      case 'set': {
        const value = requireRuntimeValue(this.evaluateValue(action.value, transaction, vars), `value for ${action.path}`);
        writeStatePath(transaction.draft, action.path, value);
        this.addTrace(transaction, { kind: 'state.write', actionPath, statePath: action.path });
        return;
      }
      case 'merge': {
        const value = requireRuntimeObject(
          this.evaluateValue(action.value, transaction, vars),
          `value for ${action.path}`,
        );
        mergeStatePath(transaction.draft, action.path, value);
        this.addTrace(transaction, { kind: 'state.write', actionPath, statePath: action.path });
        return;
      }
      case 'toggle': {
        const current = readStatePath(transaction.draft, action.path);
        if (typeof current !== 'boolean') {
          throw new RuntimeExecutionError('runtime.action.toggle-type', `State path "${action.path}" must contain a boolean.`);
        }
        writeStatePath(transaction.draft, action.path, !current);
        this.addTrace(transaction, { kind: 'state.write', actionPath, statePath: action.path });
        return;
      }
      case 'if': {
        const condition = requireBoolean(
          requireRuntimeValue(this.evaluateValue(action.condition, transaction, vars), `condition for ${actionPath}`),
          `condition for ${actionPath}`,
        );
        await this.executeActions(condition ? action.then : action.else ?? [], transaction, vars, actionPath, actionDepth);
        return;
      }
      case 'run': {
        const nested = this.document.actions[action.action];
        if (!nested) {
          throw new RuntimeExecutionError('runtime.action.unknown', `Action "${action.action}" is not declared.`);
        }
        await this.executeActions(nested, transaction, vars, `${actionPath}.run(${action.action})`, actionDepth + 1);
        return;
      }
      case 'call': {
        await this.executeCapability(action, transaction, vars, actionPath);
        return;
      }
      case 'try': {
        let unhandled: unknown;
        try {
          await this.executeActions(action.body, transaction, vars, `${actionPath}.body`, actionDepth);
        } catch (error) {
          if (action.catch) {
            const runtimeError = toRuntimeError(error, 'runtime.action.failed', 'Action execution failed.');
            const catchVars = { ...vars, error: errorValue(runtimeError) };
            await this.executeActions(action.catch, transaction, catchVars, `${actionPath}.catch`, actionDepth);
          } else {
            unhandled = error;
          }
        } finally {
          if (action.finally) {
            await this.executeActions(action.finally, transaction, vars, `${actionPath}.finally`, actionDepth);
          }
        }
        if (unhandled !== undefined) {
          throw unhandled;
        }
        return;
      }
    }
  }

  private async executeCapability(
    action: Extract<ActionNode, { kind: 'call' }>,
    transaction: Transaction,
    vars: RuntimeObject,
    actionPath: string,
  ): Promise<void> {
    if (!this.document.meta.capabilities.includes(action.capability)) {
      throw new RuntimeExecutionError(
        'runtime.capability.undeclared',
        `Capability "${action.capability}" is not declared by the document.`,
      );
    }
    const capability = this.capabilities.get(action.capability);
    if (!capability) {
      throw new RuntimeExecutionError(
        'runtime.capability.unregistered',
        `Capability "${action.capability}" is not registered by the host.`,
      );
    }

    const context: CapabilityContext = {
      document: this.document,
      event: transaction.event === undefined ? undefined : cloneRuntimeValue(transaction.event, 'capability event'),
      props: this.props === undefined ? undefined : cloneRuntimeValue(this.props, 'capability props'),
    };
    const args = action.args
      ? requireRuntimeObject(this.evaluateValue(action.args, transaction, vars), `arguments for ${action.capability}`)
      : {};
    const startedAt = this.now();
    try {
      if (capability.authorize && !(await capability.authorize(context))) {
        throw new RuntimeExecutionError(
          'runtime.capability.denied',
          `Capability "${action.capability}" was denied by the host.`,
        );
      }
      const result = cloneRuntimeValue(await capability.execute(cloneRuntimeValue(args, 'capability arguments'), context), 'capability result');
      if (action.assign) {
        assertVariableName(action.assign);
        vars[action.assign] = result;
      }
      this.addTrace(transaction, {
        kind: 'capability',
        actionPath,
        capability: action.capability,
        durationMs: duration(this.now(), startedAt),
      });
    } catch (error) {
      const runtimeError = toRuntimeError(
        error,
        'runtime.capability.failed',
        `Capability "${action.capability}" failed.`,
      );
      this.addTrace(transaction, {
        kind: 'capability',
        actionPath,
        capability: action.capability,
        durationMs: duration(this.now(), startedAt),
        error: { code: runtimeError.code },
      });
      throw runtimeError;
    }
  }

  private evaluateValue(value: ValueNode, transaction: Transaction, vars: RuntimeObject = {}): RuntimeValue | undefined {
    switch (value.kind) {
      case 'literal':
        return cloneRuntimeValue(value.value, 'literal');
      case 'array':
        return value.items.map((item, index) =>
          requireRuntimeValue(this.evaluateValue(item, transaction, vars), `array item ${index}`),
        );
      case 'object': {
        const output: RuntimeObject = {};
        for (const [key, item] of Object.entries(value.entries)) {
          assertSafePathSegment(key);
          output[key] = requireRuntimeValue(this.evaluateValue(item, transaction, vars), `object entry "${key}"`);
        }
        return output;
      }
      case 'reference':
        return this.resolveReference(value.path, transaction, vars);
      case 'expression':
        return this.evaluateExpression(value, transaction, vars);
    }
  }

  private resolveReference(path: string, transaction: Transaction, vars: RuntimeObject): RuntimeValue | undefined {
    const segments = splitPath(path, 'reference');
    const root = segments[0];
    if (!root) {
      return undefined;
    }
    const remaining = segments.slice(1);
    switch (root) {
      case 'state':
        return readPath(transaction.draft, remaining);
      case 'derived': {
        const name = remaining.shift();
        return name ? readPath(this.evaluateDerived(name, transaction, vars), remaining) : undefined;
      }
      case 'props':
        return readPath(this.props, remaining);
      case 'vars':
        return readPath(vars, remaining);
      case 'event':
        return readPath(transaction.event, remaining);
      default:
        return readPath(transaction.scope[root], remaining);
    }
  }

  private evaluateDerived(name: string, transaction: Transaction, vars: RuntimeObject): RuntimeValue {
    const cached = transaction.derivedCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    if (transaction.derivedStack.includes(name)) {
      throw new RuntimeExecutionError('runtime.derived.cycle', `Derived value "${name}" forms a cycle.`);
    }
    if (transaction.derivedStack.length >= this.limits.maxDerivedDepth) {
      throw new RuntimeExecutionError('runtime.derived.depth-exceeded', 'Maximum derived dependency depth exceeded.');
    }
    const value = this.document.derived[name];
    if (!value) {
      throw new RuntimeExecutionError('runtime.derived.unknown', `Derived value "${name}" is not declared.`);
    }

    transaction.derivedStack.push(name);
    try {
      const result = requireRuntimeValue(this.evaluateValue(value, transaction, vars), `derived value "${name}"`);
      transaction.derivedCache.set(name, result);
      return result;
    } finally {
      transaction.derivedStack.pop();
    }
  }

  private evaluateExpression(expression: ExpressionNode, transaction: Transaction, vars: RuntimeObject): RuntimeValue | undefined {
    const evaluate = (index: number): RuntimeValue | undefined => {
      const argument = expression.args[index];
      if (!argument) {
        throw new RuntimeExecutionError(
          'runtime.expression.argument-count',
          `Expression "${expression.op}" is missing argument ${index + 1}.`,
        );
      }
      return this.evaluateValue(argument, transaction, vars);
    };
    const values = (): RuntimeValue[] => expression.args.map((_, index) => requireRuntimeValue(evaluate(index), `argument ${index + 1}`));

    switch (expression.op) {
      case 'and': {
        requireMinimumArgumentCount(expression, 1);
        for (let index = 0; index < expression.args.length; index += 1) {
          if (!requireBoolean(requireRuntimeValue(evaluate(index), `argument ${index + 1}`), `argument ${index + 1}`)) {
            return false;
          }
        }
        return true;
      }
      case 'or': {
        requireMinimumArgumentCount(expression, 1);
        for (let index = 0; index < expression.args.length; index += 1) {
          if (requireBoolean(requireRuntimeValue(evaluate(index), `argument ${index + 1}`), `argument ${index + 1}`)) {
            return true;
          }
        }
        return false;
      }
      case 'coalesce': {
        requireMinimumArgumentCount(expression, 1);
        for (let index = 0; index < expression.args.length; index += 1) {
          const value = evaluate(index);
          if (value !== undefined && value !== null) {
            return value;
          }
        }
        return null;
      }
      case 'ternary': {
        requireArgumentCount(expression, 3);
        const condition = requireBoolean(requireRuntimeValue(evaluate(0), 'argument 1'), 'argument 1');
        return requireRuntimeValue(evaluate(condition ? 1 : 2), `argument ${condition ? 2 : 3}`);
      }
      case 'not':
        requireArgumentCount(expression, 1);
        return !requireBoolean(requireRuntimeValue(evaluate(0), 'argument 1'), 'argument 1');
      case 'empty': {
        requireArgumentCount(expression, 1);
        const value = evaluate(0);
        return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (isRuntimeObject(value) && Object.keys(value).length === 0);
      }
      case 'eq':
      case 'neq': {
        requireArgumentCount(expression, 2);
        const equal = runtimeEqual(evaluate(0), evaluate(1));
        return expression.op === 'eq' ? equal : !equal;
      }
      case 'add':
      case 'sub':
      case 'mul':
      case 'div': {
        requireArgumentCount(expression, 2);
        const [left, right] = values().map((value, index) => requireFiniteNumber(value, `argument ${index + 1}`));
        if (left === undefined || right === undefined) {
          throw new RuntimeExecutionError('runtime.expression.type', 'Arithmetic expressions require two numbers.');
        }
        if (expression.op === 'div' && right === 0) {
          throw new RuntimeExecutionError('runtime.expression.divide-by-zero', 'Division by zero is not allowed.');
        }
        return expression.op === 'add' ? left + right : expression.op === 'sub' ? left - right : expression.op === 'mul' ? left * right : left / right;
      }
      case 'concat':
        return values().map((value, index) => requireString(value, `argument ${index + 1}`)).join('');
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        requireArgumentCount(expression, 2);
        const [left, right] = values();
        if (typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)) {
          if (expression.op === 'gt') return left > right;
          if (expression.op === 'gte') return left >= right;
          if (expression.op === 'lt') return left < right;
          return left <= right;
        }
        if (typeof left === 'string' && typeof right === 'string') {
          if (expression.op === 'gt') return left > right;
          if (expression.op === 'gte') return left >= right;
          if (expression.op === 'lt') return left < right;
          return left <= right;
        }
        {
          throw new RuntimeExecutionError('runtime.expression.type', `Expression "${expression.op}" requires two strings or two numbers.`);
        }
      }
      case 'get': {
        requireArgumentCount(expression, 2);
        const target = evaluate(0);
        const key = requireRuntimeValue(evaluate(1), 'argument 2');
        if (!isRuntimeObject(target) && !Array.isArray(target)) {
          throw new RuntimeExecutionError('runtime.expression.get-target', 'Expression "get" requires an object or array target.');
        }
        if (typeof key !== 'number' && typeof key !== 'string') {
          throw new RuntimeExecutionError('runtime.expression.get-key', 'Expression "get" requires a string or number key.');
        }
        const segment = String(key);
        assertSafePathSegment(segment);
        return readPath(target, [segment]);
      }
    }
  }

  private addTrace(transaction: Transaction, trace: RuntimeTrace): void {
    const captured = cloneTrace([trace])[0];
    if (!captured) return;
    transaction.trace.push(captured);
    try {
      this.options.onTrace?.(cloneTrace([captured])[0] as RuntimeTrace);
    } catch {
      // Trace observers are an observability boundary and cannot alter document execution.
    }
  }

  private notifySubscribers(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch {
        // A renderer subscription cannot invalidate an already committed transaction.
      }
    }
  }
}

function evaluateInitialValue(value: ValueNode, path: string): RuntimeValue {
  switch (value.kind) {
    case 'literal':
      return cloneRuntimeValue(value.value, path);
    case 'array':
      return value.items.map((item, index) => evaluateInitialValue(item, `${path}[${index}]`));
    case 'object': {
      const output: RuntimeObject = {};
      for (const [key, item] of Object.entries(value.entries)) {
        assertSafePathSegment(key);
        output[key] = evaluateInitialValue(item, `${path}.${key}`);
      }
      return output;
    }
    case 'expression':
    case 'reference':
      throw new RuntimeExecutionError('runtime.state.initial-value', `${path} must contain only literal, object, or array values.`);
  }
}

function toActionList(actions: ActionNode | readonly ActionNode[]): readonly ActionNode[] {
  return isActionNode(actions) ? [actions] : actions;
}

function isActionNode(value: ActionNode | readonly ActionNode[]): value is ActionNode {
  return !Array.isArray(value);
}

function toCapabilityMap(
  capabilities: DocumentRuntimeOptions['capabilities'],
): ReadonlyMap<string, RuntimeCapability> {
  if (!capabilities) return new Map();
  return isReadonlyCapabilityMap(capabilities) ? new Map(capabilities) : new Map(Object.entries(capabilities));
}

function isReadonlyCapabilityMap(
  value: NonNullable<DocumentRuntimeOptions['capabilities']>,
): value is ReadonlyMap<string, RuntimeCapability> {
  return typeof (value as ReadonlyMap<string, RuntimeCapability>).get === 'function' &&
    typeof (value as ReadonlyMap<string, RuntimeCapability>)[Symbol.iterator] === 'function';
}

function validateLimits(limits: RuntimeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RuntimeExecutionError('runtime.options.invalid-limit', `Runtime limit "${name}" must be a positive integer.`);
    }
  }
}

function cloneTrace(trace: readonly RuntimeTrace[]): readonly RuntimeTrace[] {
  return trace.map((entry) => ({ ...entry, ...(entry.error ? { error: { ...entry.error } } : {}) }));
}

function cloneRuntimeValue(value: unknown, path: string, ancestors: Set<object> = new Set()): RuntimeValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RuntimeExecutionError('runtime.value.non-finite-number', `${path} must not contain a non-finite number.`);
    }
    return value;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new RuntimeExecutionError('runtime.value.invalid', `${path} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw new RuntimeExecutionError('runtime.value.circular', `${path} must not contain circular references.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => cloneRuntimeValue(item, `${path}[${index}]`, ancestors));
    }
    if (!isPlainObject(value)) {
      throw new RuntimeExecutionError('runtime.value.prototype', `${path} must not contain a prototype-chain object.`);
    }
    const output: RuntimeObject = {};
    for (const key of Object.keys(value)) {
      assertSafePathSegment(key);
      output[key] = cloneRuntimeValue(value[key], `${path}.${key}`, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function toRuntimeObject(value: RuntimeValue, path: string): RuntimeObject {
  if (!isRuntimeObject(value)) {
    throw new RuntimeExecutionError('runtime.value.object-required', `${path} must be an object.`);
  }
  return value;
}

function requireRuntimeValue(value: RuntimeValue | undefined, path: string): RuntimeValue {
  if (value === undefined) {
    throw new RuntimeExecutionError('runtime.reference.missing', `${path} resolved to no value.`);
  }
  return value;
}

function requireRuntimeObject(value: RuntimeValue | undefined, path: string): RuntimeObject {
  return toRuntimeObject(requireRuntimeValue(value, path), path);
}

function requireBoolean(value: RuntimeValue, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RuntimeExecutionError('runtime.expression.type', `${path} must be a boolean.`);
  }
  return value;
}

function requireFiniteNumber(value: RuntimeValue, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RuntimeExecutionError('runtime.expression.type', `${path} must be a finite number.`);
  }
  return value;
}

function requireString(value: RuntimeValue, path: string): string {
  if (typeof value !== 'string') {
    throw new RuntimeExecutionError('runtime.expression.type', `${path} must be a string.`);
  }
  return value;
}

function requireArgumentCount(expression: ExpressionNode, expected: number): void {
  if (expression.args.length !== expected) {
    throw new RuntimeExecutionError(
      'runtime.expression.argument-count',
      `Expression "${expression.op}" requires exactly ${expected} arguments.`,
    );
  }
}

function requireMinimumArgumentCount(expression: ExpressionNode, minimum: number): void {
  if (expression.args.length < minimum) {
    throw new RuntimeExecutionError(
      'runtime.expression.argument-count',
      `Expression "${expression.op}" requires at least ${minimum} argument${minimum === 1 ? '' : 's'}.`,
    );
  }
}

function readStatePath(state: RuntimeObject, path: string): RuntimeValue | undefined {
  const segments = splitPath(path, 'state path');
  if (segments[0] !== 'state' || segments.length < 2) {
    throw new RuntimeExecutionError('runtime.state.path', `State path "${path}" must start with "state.".`);
  }
  return readPath(state, segments.slice(1));
}

function writeStatePath(state: RuntimeObject, path: string, value: RuntimeValue): void {
  const segments = splitPath(path, 'state path');
  if (segments[0] !== 'state' || segments.length < 2) {
    throw new RuntimeExecutionError('runtime.state.path', `State path "${path}" must start with "state.".`);
  }
  const target = segments.slice(1);
  const last = target.pop();
  if (!last) {
    throw new RuntimeExecutionError('runtime.state.path', `State path "${path}" must name a property.`);
  }

  let container: RuntimeObject | RuntimeValue[] = state;
  for (const segment of target) {
    const current = readContainerValue(container, segment);
    if (current === undefined) {
      const next: RuntimeObject = {};
      writeContainerValue(container, segment, next);
      container = next;
    } else if (isRuntimeObject(current) || Array.isArray(current)) {
      container = current;
    } else {
      throw new RuntimeExecutionError('runtime.state.path-conflict', `State path "${path}" crosses a non-container value.`);
    }
  }
  writeContainerValue(container, last, cloneRuntimeValue(value, `state value for ${path}`));
}

function mergeStatePath(state: RuntimeObject, path: string, value: RuntimeObject): void {
  const existing = readStatePath(state, path);
  if (existing === undefined) {
    writeStatePath(state, path, {});
  } else if (!isRuntimeObject(existing)) {
    throw new RuntimeExecutionError('runtime.action.merge-type', `State path "${path}" must contain an object.`);
  }
  const target = readStatePath(state, path);
  if (!isRuntimeObject(target)) {
    throw new RuntimeExecutionError('runtime.action.merge-type', `State path "${path}" must contain an object.`);
  }
  for (const [key, item] of Object.entries(value)) {
    assertSafePathSegment(key);
    target[key] = cloneRuntimeValue(item, `merge value for ${path}.${key}`);
  }
}

function readPath(value: RuntimeValue | undefined, segments: readonly string[]): RuntimeValue | undefined {
  let current = value;
  for (const segment of segments) {
    if (current === undefined || (!isRuntimeObject(current) && !Array.isArray(current))) {
      return undefined;
    }
    current = readContainerValue(current, segment);
  }
  return current;
}

function readContainerValue(container: RuntimeObject | RuntimeValue[], segment: string): RuntimeValue | undefined {
  if (Array.isArray(container)) {
    const index = toArrayIndex(segment);
    return index === undefined ? undefined : container[index];
  }
  return Object.hasOwn(container, segment) ? container[segment] : undefined;
}

function writeContainerValue(container: RuntimeObject | RuntimeValue[], segment: string, value: RuntimeValue): void {
  if (Array.isArray(container)) {
    const index = toArrayIndex(segment);
    if (index === undefined) {
      throw new RuntimeExecutionError('runtime.state.array-index', `Array path segment "${segment}" must be a non-negative integer.`);
    }
    container[index] = value;
    return;
  }
  container[segment] = value;
}

function splitPath(path: string, label: string): string[] {
  const segments = path.split('.');
  if (!path || segments.some((segment) => !segment)) {
    throw new RuntimeExecutionError('runtime.path.invalid', `${label} must be a non-empty dot-separated path.`);
  }
  for (const segment of segments) assertSafePathSegment(segment);
  return segments;
}

function assertSafePathSegment(segment: string): void {
  if (UNSAFE_PATH_SEGMENTS.has(segment)) {
    throw new RuntimeExecutionError('runtime.path.unsafe', `Path segment "${segment}" is not allowed.`);
  }
}

function assertVariableName(name: string): void {
  if (!name || name.includes('.')) {
    throw new RuntimeExecutionError('runtime.vars.invalid-name', 'Capability assignment names must be one safe identifier segment.');
  }
  assertSafePathSegment(name);
}

function toArrayIndex(segment: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
  const index = Number(segment);
  return Number.isSafeInteger(index) ? index : undefined;
}

function runtimeEqual(left: RuntimeValue | undefined, right: RuntimeValue | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => runtimeEqual(value, right[index]));
  }
  if (isRuntimeObject(left) && isRuntimeObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && runtimeEqual(left[key], right[key]));
  }
  return false;
}

function isRuntimeObject(value: RuntimeValue | undefined): value is RuntimeObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function duration(now: number, startedAt: number): number {
  return Math.max(0, now - startedAt);
}

function errorValue(error: RuntimeExecutionError): RuntimeObject {
  return { code: error.code, message: error.message };
}

function toRuntimeError(error: unknown, fallbackCode: string, fallbackMessage: string): RuntimeExecutionError {
  return error instanceof RuntimeExecutionError ? error : new RuntimeExecutionError(fallbackCode, fallbackMessage);
}
