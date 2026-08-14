import type { Document } from './ast/index.ts';

/**
 * These declarations are compiler-recognized author constructs. They are
 * intentionally declaration-only: a .dmy.ts module must be erased by the
 * Vite plugin and can never execute these helpers in the browser.
 */
export type AuthorValue = unknown;
type AuthorFunction = (...args: AuthorValue[]) => AuthorValue;

export declare function cap(name: string): AuthorValue;
export declare function defineDocument(definition: AuthorValue): Document;
export declare function state(value: AuthorValue): AuthorValue;

export declare const action: {
  call(capability: AuthorValue, options?: AuthorValue): AuthorValue;
  if(condition: AuthorValue, thenBranch: AuthorValue, elseBranch?: AuthorValue): AuthorValue;
  merge(path: string, value: AuthorValue): AuthorValue;
  run(name: string): AuthorValue;
  set(path: string, value: AuthorValue): AuthorValue;
  toggle(path: string): AuthorValue;
  try(body: AuthorValue, options?: AuthorValue): AuthorValue;
};

export declare const derived: Record<
  'add' | 'and' | 'coalesce' | 'concat' | 'div' | 'empty' | 'eq' | 'get' | 'gt' | 'gte' | 'lt' | 'lte' | 'mul' | 'neq' | 'not' | 'or' | 'sub' | 'ternary',
  AuthorFunction
>;

export declare const event: {
  checked(): AuthorValue;
  key(): AuthorValue;
  value(): AuthorValue;
};

export declare const ref: {
  derived(name: string): AuthorValue;
  error(name: string): AuthorValue;
  item(each: string, path?: string): AuthorValue;
  state(path: string): AuthorValue;
  var(name: string): AuthorValue;
};

export declare const view: {
  alert(options: {
    message: AuthorValue;
    testId?: string;
    when?: AuthorValue;
  }): AuthorValue;
  button(options: {
    disabled?: AuthorValue;
    label: AuthorValue;
    onClick?: AuthorValue;
    testId?: string;
    type?: AuthorValue;
  }): AuthorValue;
  checkbox(options: {
    ariaLabel?: AuthorValue;
    checked: AuthorValue;
    label: AuthorValue;
    onChange?: AuthorValue;
    testId?: string;
  }): AuthorValue;
  component(name: string, props?: AuthorValue, children?: AuthorValue, events?: AuthorValue): AuthorValue;
  form(options: {
    children: AuthorValue;
    id?: AuthorValue;
    name?: AuthorValue;
    onSubmit?: AuthorValue;
    testId?: string;
  }): AuthorValue;
  fragment(children: AuthorValue): AuthorValue;
  list(options: {
    each: string;
    in: AuthorValue;
    key?: AuthorValue;
    label?: AuthorValue;
    template: AuthorValue;
    testId?: string;
  }): AuthorValue;
  page(options: {
    children?: AuthorValue;
    description?: AuthorValue;
    testId?: string;
    title: AuthorValue;
  }): AuthorValue;
  repeat(options: AuthorValue): AuthorValue;
  text(value: AuthorValue): AuthorValue;
  textField(options: {
    disabled?: AuthorValue;
    id?: AuthorValue;
    label: AuthorValue;
    onInput?: AuthorValue;
    placeholder?: AuthorValue;
    required?: AuthorValue;
    testId?: string;
    type?: AuthorValue;
    value: AuthorValue;
  }): AuthorValue;
  when(condition: AuthorValue, child: AuthorValue): AuthorValue;
};
