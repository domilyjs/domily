import type { JsonValue } from '../pagespec/types.ts';
import type { ComponentCatalogManifest, JsonSchema } from '../registry/types.ts';
import type {
  DomComponentMountContext,
  DomComponentRendererRegistry,
  TrustedDomComponentRenderer,
} from '../dom/types.ts';

const blockedProps = new Set(['innerhtml', 'outerhtml', 'srcdoc']);
const elementNames = ['a', 'button', 'div', 'form', 'main', 'p', 'section', 'span'] as const;

const scalar: JsonSchema = { type: ['boolean', 'null', 'number', 'string'] };
const style: JsonSchema = {
  type: ['object', 'string'],
  properties: {},
  additionalProperties: { type: ['number', 'string'] },
};
const globalPropertySchemas: Record<string, JsonSchema> = {
  className: { type: 'string' },
  dir: { type: 'string' },
  hidden: { type: 'boolean' },
  id: { type: 'string' },
  lang: { type: 'string' },
  role: { type: 'string' },
  style,
  tabIndex: { type: 'number' },
  title: { type: 'string' },
};
const globalProps: JsonSchema = {
  type: 'object',
  properties: globalPropertySchemas,
  additionalProperties: false,
};
const allowedGlobalProperties = new Set(Object.keys(globalPropertySchemas).map(canonicalPropertyName));
const allowedPropertiesByTag: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['download', 'href', 'rel', 'target']),
  button: new Set(['disabled', 'name', 'type', 'value']),
  input: new Set(['autocomplete', 'checked', 'disabled', 'maxLength', 'minLength', 'name', 'placeholder', 'readOnly', 'required', 'type', 'value']
    .map(canonicalPropertyName)),
};

/** Pure manifest data: remote pages can select these components, never supply their implementation. */
export const nativeHtmlCatalog: ComponentCatalogManifest = {
  schema: 'domily.component-catalog/v1',
  id: '@domily/native-html',
  version: '1.0.0',
  namespace: 'html',
  description: 'Trusted native HTML components supplied by @domily/next.',
  delivery: { remotePage: true },
  components: {
    fragment: {
      description: 'A transparent native DOM fragment.',
      children: {},
    },
    text: {
      description: 'A text node written through textContent rather than HTML parsing.',
      props: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      bindings: { value: { mode: 'read', value: { type: 'string' } } },
    },
    a: nativeElementManifest({
      properties: {
        download: { type: 'string' },
        href: { type: 'string' },
        rel: { type: 'string' },
        target: { type: 'string' },
      },
      events: { click: emptyEvent('Projected anchor click payload.') },
    }),
    button: nativeElementManifest({
      properties: { disabled: { type: 'boolean' }, type: { type: 'string' }, value: scalar },
      events: { click: emptyEvent('Projected button click payload.') },
    }),
    div: nativeElementManifest(),
    form: nativeElementManifest({
      events: { submit: emptyEvent('Projected form submit payload.') },
    }),
    main: nativeElementManifest(),
    p: nativeElementManifest(),
    section: nativeElementManifest(),
    span: nativeElementManifest(),
    input: nativeElementManifest({
      properties: {
        autoComplete: { type: 'string' },
        checked: { type: 'boolean' },
        disabled: { type: 'boolean' },
        maxLength: { type: 'number' },
        minLength: { type: 'number' },
        name: { type: 'string' },
        placeholder: { type: 'string' },
        readOnly: { type: 'boolean' },
        required: { type: 'boolean' },
        type: { type: 'string' },
        value: { type: 'string' },
      },
      events: {
        change: inputEvent('Projected input change payload.'),
        input: inputEvent('Projected input payload.'),
      },
      bindings: {
        checked: { mode: 'readwrite', value: { type: 'boolean' }, write: { event: 'input', valuePath: 'checked' } },
        value: { mode: 'readwrite', value: { type: 'string' }, write: { event: 'input', valuePath: 'value' } },
      },
    }),
  },
};

/** Local trusted implementations for the manifest above. */
export const nativeHtmlRenderers: readonly TrustedDomComponentRenderer[] = [
  {
    type: 'html.fragment',
    mount(context) {
      return { nodes: context.children };
    },
  },
  {
    type: 'html.text',
    mount(context) {
      const value = context.props.value;
      if (typeof value !== 'string') {
        throw new NativeHtmlError('native-html.text.value.invalid', 'html.text requires a string value.');
      }
      return { nodes: [context.document.createTextNode(value)] };
    },
  },
  ...elementNames.map((name) => createNativeElementRenderer(name)),
  createNativeElementRenderer('input'),
];

/** Registers all native implementations against a host-local renderer registry. */
export function registerNativeHtmlRenderers(registry: DomComponentRendererRegistry): void {
  for (const renderer of nativeHtmlRenderers) {
    registry.register(renderer);
  }
}

export function getNativeHtmlRenderer(type: string): TrustedDomComponentRenderer | undefined {
  return nativeHtmlRenderers.find((renderer) => renderer.type === type);
}

export class NativeHtmlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NativeHtmlError';
  }
}

function nativeElementManifest(options: {
  readonly bindings?: Record<string, { readonly mode: 'read' | 'readwrite'; readonly value?: JsonSchema; readonly write?: { readonly event: string; readonly valuePath: string } }>;
  readonly events?: Record<string, { readonly description: string; readonly payload: JsonSchema }>;
  readonly properties?: Record<string, JsonSchema>;
} = {}) {
  return {
    description: 'A trusted native HTML element.',
    children: {},
    props: {
      ...globalProps,
      properties: { ...globalProps.properties, ...options.properties },
    },
    ...(options.events ? { events: options.events } : {}),
    ...(options.bindings ? { bindings: options.bindings } : {}),
    styleForwarding: { className: true, style: true },
  };
}

function emptyEvent(description: string) {
  return {
    description,
    payload: { type: 'object', additionalProperties: false } satisfies JsonSchema,
  };
}

function inputEvent(description: string) {
  return {
    description,
    payload: {
      type: 'object',
      properties: { checked: { type: 'boolean' }, value: { type: 'string' } },
      required: ['checked', 'value'],
      additionalProperties: false,
    } satisfies JsonSchema,
  };
}

function createNativeElementRenderer(name: typeof elementNames[number] | 'input'): TrustedDomComponentRenderer {
  return {
    type: `html.${name}`,
    mount(context: DomComponentMountContext) {
      const element = context.document.createElement(name);
      writeNativeHtmlProps(element, name, context.props);
      element.append(...context.children);
      return {
        nodes: [element],
        eventTarget: element,
        ...(name === 'form' ? { preventDefaultEvents: ['submit'] } : {}),
        projectEvent(eventName) {
          return projectNativeEvent(name, eventName, element);
        },
      };
    },
  };
}

/** Defense-in-depth sink: it remains safe even if a caller bypasses PageSpec normalization. */
export function writeNativeHtmlProps(
  element: HTMLElement,
  tagName: string,
  props: Readonly<Record<string, JsonValue>>,
): void {
  for (const [name, value] of Object.entries(props)) {
    const canonicalName = canonicalPropertyName(name);
    if (canonicalName.startsWith('on') || blockedProps.has(canonicalName)) {
      throw new NativeHtmlError('native-html.prop.disallowed', `Native HTML property "${name}" is not allowed.`);
    }
    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(name)) {
      throw new NativeHtmlError('native-html.prop.name.invalid', `Native HTML property "${name}" is invalid.`);
    }
    if (!isAllowedNativeProperty(tagName, canonicalName)) {
      throw new NativeHtmlError(
        'native-html.prop.unknown',
        `Native HTML property "${name}" is not available for <${tagName}> in the native-html MVP.`,
      );
    }
    if (canonicalName === 'style') {
      applyStyle(element, value);
      continue;
    }
    if (canonicalName === 'classname') {
      if (typeof value !== 'string') throw propTypeError(name, 'a string');
      element.className = value;
      continue;
    }
    if (canonicalName === 'href') {
      if (tagName !== 'a' || typeof value !== 'string' || !isSafeHref(value)) {
        throw new NativeHtmlError('native-html.href.invalid', 'Native anchor href must be a relative or HTTPS URL.');
      }
      element.setAttribute('href', value);
      continue;
    }
    if (canonicalName === 'src') {
      throw new NativeHtmlError('native-html.src.disallowed', 'src is not available in the native-html MVP.');
    }
    applyNativeProperty(element, canonicalName, value);
  }
  if (tagName.toLowerCase() === 'a' && (element as HTMLAnchorElement).target.toLowerCase() === '_blank') {
    const anchor = element as HTMLAnchorElement;
    const existingRel = anchor.rel || element.getAttribute('rel');
    anchor.rel = mergeRel(existingRel);
    element.setAttribute('rel', anchor.rel);
  }
}

function applyStyle(element: HTMLElement, value: JsonValue): void {
  if (typeof value === 'string') {
    element.style.cssText = value;
    return;
  }
  if (!isRecord(value)) {
    throw propTypeError('style', 'a CSS string or object');
  }
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      throw new NativeHtmlError('native-html.style.value.invalid', `Style property "${name}" must be a string or number.`);
    }
    element.style.setProperty(toCssProperty(name), String(entry));
  }
}

function applyNativeProperty(element: HTMLElement, name: string, value: JsonValue): void {
  if (value === null) {
    element.removeAttribute(name);
    return;
  }
  if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
    throw propTypeError(name, 'a JSON scalar');
  }
  if (name.includes('-') || name.startsWith('aria')) {
    if (value === false) {
      element.removeAttribute(name);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
    return;
  }
  const propertyName = domPropertyName(name);
  const target = element as unknown as Record<string, unknown>;
  if (propertyName in target) {
    target[propertyName] = value;
    return;
  }
  if (value === false) {
    element.removeAttribute(name);
  } else if (value === true) {
    element.setAttribute(name, '');
  } else {
    element.setAttribute(name, String(value));
  }
}

function canonicalPropertyName(name: string): string {
  return name.toLowerCase();
}

function domPropertyName(name: string): string {
  const known: Readonly<Record<string, string>> = {
    autocomplete: 'autocomplete',
    maxlength: 'maxLength',
    minlength: 'minLength',
    readonly: 'readOnly',
    tabindex: 'tabIndex',
  };
  return known[name] ?? name;
}

function isAllowedNativeProperty(tagName: string, propertyName: string): boolean {
  return allowedGlobalProperties.has(propertyName)
    || allowedPropertiesByTag[tagName.toLowerCase()]?.has(propertyName) === true;
}

function projectNativeEvent(tagName: string, eventName: string, element: HTMLElement): JsonValue {
  if (tagName === 'input' && (eventName === 'input' || eventName === 'change')) {
    const input = element as HTMLInputElement;
    return { checked: Boolean(input.checked), value: String(input.value ?? '') };
  }
  return {};
}

function isSafeHref(value: string): boolean {
  if ((value.startsWith('/') && !value.startsWith('//'))
    || value.startsWith('./') || value.startsWith('../') || value.startsWith('#') || value.startsWith('?')) {
    return true;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function mergeRel(existing: string | null): string {
  const tokens = new Set((existing ?? '').split(/\s+/).filter(Boolean));
  tokens.add('noopener');
  tokens.add('noreferrer');
  return [...tokens].join(' ');
}

function toCssProperty(name: string): string {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function propTypeError(name: string, expected: string): NativeHtmlError {
  return new NativeHtmlError('native-html.prop.type.invalid', `Native HTML property "${name}" must be ${expected}.`);
}
