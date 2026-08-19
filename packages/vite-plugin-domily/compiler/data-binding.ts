const dataBindingIgnoreKeys = new Set(["css", "style"]);

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const MEMBER_EXPRESSION = `${IDENTIFIER}(?:(?:\\?\\.|\\.)${IDENTIFIER})*`;
const CALL_ARGUMENT = `(?:${MEMBER_EXPRESSION}|-?\\d+(?:\\.\\d+)?|true|false|null)`;
const DATA_BINDING_DETECTION_REG_EXP = new RegExp(
  `^:(?:${MEMBER_EXPRESSION})(?:\\((?:${CALL_ARGUMENT}(?:,${CALL_ARGUMENT})*)?\\))?$`,
);
const EVENT_BINDING_DETECTION_REF_EXP = new RegExp(
  `^@(?:${MEMBER_EXPRESSION})$`,
);

type TemplateData =
  | string
  | number
  | boolean
  | null
  | TemplateData[]
  | { [key: string]: TemplateData };

function parseTemplateData(json: string) {
  try {
    return JSON.parse(json) as TemplateData;
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new SyntaxError(`Invalid Domily JSON template.${detail}`);
  }
}

function getBindingExpression(value: string, allowBinding: boolean) {
  if (!allowBinding) {
    return null;
  }

  if (DATA_BINDING_DETECTION_REG_EXP.test(value)) {
    return value.slice(1);
  }

  if (value.startsWith(":") && /[()]/.test(value)) {
    throw new SyntaxError(
      `Invalid Domily data binding ${JSON.stringify(
        value,
      )}. Data bindings must be a member reference or a call with simple arguments.`,
    );
  }

  if (EVENT_BINDING_DETECTION_REF_EXP.test(value)) {
    return value.slice(1);
  }

  if (/^@[\w.?]+\(/.test(value)) {
    throw new SyntaxError(
      `Invalid Domily event binding ${JSON.stringify(
        value
      )}. Event bindings must reference a handler, for example @onClick.`
    );
  }

  return null;
}

function serializeString(value: string, allowBinding: boolean) {
  return getBindingExpression(value, allowBinding) ?? JSON.stringify(value);
}

function serializeObjectProperty(
  key: string,
  value: TemplateData,
  allowBinding: boolean,
) {
  // `__proto__` retains its legacy prototype-setter meaning in an object
  // literal, including when it is quoted. A computed key always creates a
  // normal own data property, matching JSON.parse's semantics.
  const serializedKey =
    key === "__proto__" ? `[${JSON.stringify(key)}]` : JSON.stringify(key);
  const childAllowsBinding = allowBinding && !dataBindingIgnoreKeys.has(key);

  return `${serializedKey}:${serializeTemplateData(value, childAllowsBinding)}`;
}

function serializeTemplateData(data: TemplateData, allowBinding = true): string {
  if (typeof data === "string") {
    return serializeString(data, allowBinding);
  }

  if (Array.isArray(data)) {
    return `[${data
      .map((entry) => serializeTemplateData(entry, allowBinding))
      .join(",")}]`;
  }

  if (data !== null && typeof data === "object") {
    return `{${Object.entries(data)
      .map(([key, value]) => serializeObjectProperty(key, value, allowBinding))
      .join(",")}}`;
  }

  const serialized = JSON.stringify(data);
  if (serialized === undefined) {
    throw new TypeError("Domily template values must be JSON-serializable.");
  }

  return serialized;
}

/**
 * Converts Domily's JSON template syntax into a JavaScript object expression.
 *
 * Values with the explicit `:` and `@` binding prefixes are emitted as source
 * expressions. Every other string is serialized as JSON, so user content can
 * never accidentally become executable code because it resembles an internal
 * compiler marker.
 */
export function codeDataBinding(json: string) {
  return serializeTemplateData(parseTemplateData(json));
}

export function templateUsesProps(json: string) {
  const usesProps = (value: TemplateData, allowBinding = true): boolean => {
    if (typeof value === "string") {
      const expression = getBindingExpression(value, allowBinding);
      return expression ? /(^|[^\w$])props(?![\w$])/.test(expression) : false;
    }
    if (Array.isArray(value)) {
      return value.some((entry) => usesProps(entry, allowBinding));
    }
    if (value !== null && typeof value === "object") {
      return Object.entries(value).some(([key, entry]) =>
        usesProps(entry, allowBinding && !dataBindingIgnoreKeys.has(key))
      );
    }
    return false;
  };

  return usesProps(parseTemplateData(json));
}
