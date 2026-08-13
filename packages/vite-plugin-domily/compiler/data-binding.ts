const dataBindingIgnoreKeys = ["css", "style"];

const DATA_BINDING_DETECTION_REG_EXP = /^:(?<bind>[\w.?]+\(?[\w,?]*\)?)$/;

const DATA_BINDING = (data: string) => `___DOMILY_DATA_BING:${data}`;

const DATA_BINDING_REG_EXP =
  /"___DOMILY_DATA_BING:(?<bind>[\w.?]+\(?[\w,?]*\)?)"/g;

const EVENT_BINDING_DETECTION_REF_EXP = /^@(?<event>[\w.?]+\(?[\w,?]*\)?)$/;

const EVENT_BINDING = (event: string) => `___DOMILY_EVENT_BING:${event}`;

const EVENT_BINDING_REG_EXP =
  /"___DOMILY_EVENT_BING:(?<event>[\w.?]+\(?[\w,?]*\)?)"/g;

type TemplateData =
  | string
  | number
  | boolean
  | null
  | TemplateData[]
  | { [key: string]: TemplateData };

function dataBinding(data: TemplateData): TemplateData {
  if (typeof data === "string") {
    if (DATA_BINDING_DETECTION_REG_EXP.test(data)) {
      return DATA_BINDING(data.slice(1));
    }
    if (EVENT_BINDING_DETECTION_REF_EXP.test(data)) {
      return EVENT_BINDING(data.slice(1));
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(dataBinding);
  }

  if (data !== null && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (!dataBindingIgnoreKeys.includes(key)) {
        data[key] = dataBinding(value);
      }
    }
  }

  return data;
}

function replaceDataBinding(json: string) {
  return json
    .replaceAll(DATA_BINDING_REG_EXP, (_, match) => {
      return match;
    })
    .replaceAll(EVENT_BINDING_REG_EXP, (_, match) => {
      return match;
    });
}

export function codeDataBinding(json: string) {
  return replaceDataBinding(JSON.stringify(dataBinding(JSON.parse(json) as TemplateData)));
}
