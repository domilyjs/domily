import { writeNativeHtmlProps } from '../native-html/index.ts';
import type { JsonValue } from '../pagespec/types.ts';
import type {
  TrustedDomComponentRenderer,
} from '../dom/types.ts';

export class BusinessFormRendererError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessFormRendererError';
  }
}

interface FormField {
  readonly className?: string;
  readonly label: string;
  readonly name: string;
  readonly placeholder?: string;
  readonly required: boolean;
  readonly style?: JsonValue;
}

interface FormEventDetail {
  readonly value: Record<string, string>;
}

/** Trusted native renderer paired with businessFormCatalog's pure manifest. */
export const businessFormRenderer: TrustedDomComponentRenderer = {
  type: 'business.form',
  mount(context) {
    const fields = readFields(context.props.fields);
    const values = readValues(context.props.value);
    const form = context.document.createElement('form');
    writeNativeHtmlProps(form, 'form', selectFormProps(context.props));
    const events = new FormEventTarget();
    const inputs: { field: FormField; input: HTMLInputElement }[] = [];
    const releases: (() => void)[] = [];

    for (const field of fields) {
      const label = context.document.createElement('label');
      label.append(context.document.createTextNode(field.label));
      const input = context.document.createElement('input');
      const inputProps: Record<string, JsonValue> = {
        ...(field.className === undefined ? {} : { className: field.className }),
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.style === undefined ? {} : { style: field.style }),
        required: field.required,
        type: 'text',
      };
      writeNativeHtmlProps(input, 'input', inputProps);
      input.name = field.name;
      input.value = values[field.name] ?? '';
      input.setAttribute('data-domily-node', `${context.nodeId}.fields.${field.name}`);
      const emitInput = async (): Promise<void> => {
        await events.emit('input', { value: collectValues(inputs) });
      };
      input.addEventListener('input', emitInput);
      releases.push(() => input.removeEventListener('input', emitInput));
      label.append(input);
      form.append(label);
      inputs.push({ field, input });
    }

    const submit = context.document.createElement('button');
    submit.type = 'submit';
    submit.replaceChildren(context.document.createTextNode(readRequiredString(context.props.submitLabel, 'submitLabel')));
    form.append(submit);
    const emitSubmit = async (event: Event): Promise<void> => {
      event.preventDefault();
      await events.emit('submit', { value: collectValues(inputs) });
    };
    form.addEventListener('submit', emitSubmit);
    releases.push(() => form.removeEventListener('submit', emitSubmit));

    return {
      nodes: [form],
      eventTarget: events as unknown as EventTarget,
      dispose() {
        for (const release of releases.reverse()) release();
      },
      projectEvent(_name, event) {
        const detail = (event as CustomEvent<unknown>).detail;
        return isFormEventDetail(detail) ? detail : {};
      },
    };
  },
};

class FormEventTarget {
  private readonly listeners = new Map<string, Set<(event: Event) => unknown>>();

  addEventListener(name: string, listener: (event: Event) => unknown): void {
    const listeners = this.listeners.get(name) ?? new Set<(event: Event) => unknown>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: (event: Event) => unknown): void {
    this.listeners.get(name)?.delete(listener);
  }

  async emit(name: string, detail: FormEventDetail): Promise<void> {
    const event = new CustomEvent(name, { detail });
    for (const listener of this.listeners.get(name) ?? []) {
      await listener(event);
    }
  }
}

function readFields(value: JsonValue | undefined): readonly FormField[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BusinessFormRendererError('business-form.fields.invalid', 'business.form requires at least one field.');
  }
  const names = new Set<string>();
  return value.map((field, index) => {
    if (!isRecord(field)) {
      throw new BusinessFormRendererError('business-form.field.invalid', `Field ${index} must be an object.`);
    }
    const name = readRequiredString(field.name, `fields[${index}].name`);
    if (!isSafeSegment(name) || names.has(name)) {
      throw new BusinessFormRendererError('business-form.field.name.invalid', `Field "${name}" must be unique and safe.`);
    }
    names.add(name);
    return {
      ...(typeof field.className === 'string' ? { className: field.className } : {}),
      label: readRequiredString(field.label, `fields[${index}].label`),
      name,
      ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}),
      required: field.required === true,
      ...(field.style === undefined ? {} : { style: field.style }),
    };
  });
}

function readValues(value: JsonValue | undefined): Record<string, string> {
  if (!isRecord(value)) {
    throw new BusinessFormRendererError('business-form.value.invalid', 'business.form value must be a string object.');
  }
  const values: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isSafeSegment(name) || typeof entry !== 'string') {
      throw new BusinessFormRendererError('business-form.value.invalid', 'business.form value must contain only safe string fields.');
    }
    values[name] = entry;
  }
  return values;
}

function selectFormProps(props: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  return {
    ...(typeof props.className === 'string' ? { className: props.className } : {}),
    ...(props.style === undefined ? {} : { style: props.style }),
  };
}

function collectValues(inputs: readonly { readonly field: FormField; readonly input: HTMLInputElement }[]): Record<string, string> {
  return Object.fromEntries(inputs.map(({ field, input }) => [field.name, String(input.value ?? '')]));
}

function isFormEventDetail(value: unknown): value is FormEventDetail {
  return isRecord(value as JsonValue)
    && isRecord((value as FormEventDetail).value as JsonValue)
    && Object.values((value as FormEventDetail).value).every((entry) => typeof entry === 'string');
}

function readRequiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string') {
    throw new BusinessFormRendererError('business-form.string.invalid', `${label} must be a string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function isSafeSegment(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}
