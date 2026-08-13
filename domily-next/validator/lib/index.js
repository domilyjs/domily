// src/index.ts
var globalProps = new Set(["aria-label", "class", "data-testid", "hidden", "id", "role", "title"]);
var mvpHtmlComponents = {
  a: component(["href", "target", ...globalProps], ["blur", "click", "focus", "keydown", "keyup"]),
  article: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  button: component(["disabled", "name", "type", "value", ...globalProps], ["blur", "click", "focus", "keydown", "keyup"]),
  div: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  form: component(["name", "novalidate", ...globalProps], ["blur", "focus", "submit"]),
  img: component(["alt", "height", "src", "width", ...globalProps], ["blur", "focus"]),
  input: component(["checked", "disabled", "name", "placeholder", "required", "type", "value", ...globalProps], ["blur", "change", "focus", "input", "keydown", "keyup"]),
  label: component(["for", ...globalProps], ["blur", "click", "focus"]),
  li: component(globalProps, ["blur", "click", "focus"]),
  main: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  nav: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  ol: component(globalProps, ["blur", "click", "focus"]),
  option: component(["disabled", "selected", "value", ...globalProps], ["blur", "click", "focus"]),
  p: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  section: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  select: component(["disabled", "name", "required", "value", ...globalProps], ["blur", "change", "focus", "input"]),
  span: component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]),
  textarea: component(["disabled", "name", "placeholder", "required", "value", ...globalProps], ["blur", "change", "focus", "input", "keydown", "keyup"]),
  ul: component(globalProps, ["blur", "click", "focus"])
};
for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "strong", "em", "small", "code"]) {
  mvpHtmlComponents[tag] = component(globalProps, ["blur", "click", "focus", "keydown", "keyup"]);
}
for (const tag of ["table", "thead", "tbody", "tr", "th", "td"]) {
  mvpHtmlComponents[tag] = component(globalProps, ["blur", "click", "focus"]);
}
function createMvpHtmlRegistry() {
  return new Map(Object.entries(mvpHtmlComponents));
}
function validateDocument(document, options) {
  const issues = [];
  validateView(document.view, "view", document, options, issues);
  for (const [name, actions] of Object.entries(document.actions)) {
    validateActions(actions, `actions.${name}`, document, options, issues);
  }
  for (const [name, action] of Object.entries(document.lifecycle)) {
    validateActions(Array.isArray(action) ? action : [action], `lifecycle.${name}`, document, options, issues);
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
function validateView(view, path, document, options, issues) {
  switch (view.kind) {
    case "element":
      validateElement(view, path, document, options, issues);
      return;
    case "text":
      validateValue(view.value, `${path}.value`, issues);
      return;
    case "fragment":
      view.children.forEach((child, index) => validateView(child, `${path}.children[${index}]`, document, options, issues));
      return;
    case "when":
      validateValue(view.condition, `${path}.condition`, issues);
      validateView(view.child, `${path}.child`, document, options, issues);
      return;
    case "repeat":
      validateValue(view.in, `${path}.in`, issues);
      if (view.key) {
        validateValue(view.key, `${path}.key`, issues);
      }
      validateView(view.template, `${path}.template`, document, options, issues);
  }
}
function validateElement(view, path, document, options, issues) {
  const definition = options.components.get(view.component);
  if (!definition) {
    issues.push(issue("view.component.unknown", `Component "${view.component}" is not registered.`, `${path}.component`));
  } else {
    for (const [name, value] of Object.entries(view.props)) {
      const propPath = `${path}.props.${name}`;
      if (!definition.props.has(name) || name.toLowerCase().startsWith("on")) {
        issues.push(issue("view.prop.disallowed", `Property "${name}" is not allowed on ${view.component}.`, propPath));
        continue;
      }
      validatePropertyValue(view.component, name, value, propPath, issues);
    }
    for (const [name, action] of Object.entries(view.events)) {
      const eventPath = `${path}.events.${name}`;
      if (!definition.events.has(name)) {
        issues.push(issue("view.event.disallowed", `Event "${name}" is not allowed on ${view.component}.`, eventPath));
        continue;
      }
      validateActions(Array.isArray(action) ? action : [action], eventPath, document, options, issues);
    }
  }
  view.children.forEach((child, index) => validateView(child, `${path}.children[${index}]`, document, options, issues));
}
function validatePropertyValue(component, name, value, path, issues) {
  validateValue(value, path, issues);
  if (component === "a" && name === "href") {
    validateUrlValue(value, path, false, issues);
  }
  if (component === "img" && name === "src") {
    validateUrlValue(value, path, true, issues);
  }
  if (component === "a" && name === "target" && literalValue(value) === "_blank") {
    return;
  }
  if (name === "style" || name === "css" || name === "className") {
    issues.push(issue("view.prop.disallowed", `Property "${name}" is not allowed.`, path));
  }
}
function validateUrlValue(value, path, image, issues) {
  const literal = literalValue(value);
  if (typeof literal !== "string") {
    return;
  }
  try {
    const url = new URL(literal, "https://domily.invalid");
    const relative = url.origin === "https://domily.invalid";
    if (!relative && url.protocol !== "https:") {
      issues.push(issue("view.url.disallowed", `${image ? "Image source" : "Link"} must use https or a relative URL.`, path));
    }
  } catch {
    issues.push(issue("view.url.invalid", "URL is invalid.", path));
  }
}
function validateActions(actions, path, document, options, issues) {
  actions.forEach((action, index) => validateAction(action, `${path}[${index}]`, document, options, issues));
}
function validateAction(action, path, document, options, issues) {
  switch (action.kind) {
    case "set":
      validateValue(action.value, `${path}.value`, issues);
      return;
    case "merge":
      validateValue(action.value, `${path}.value`, issues);
      return;
    case "toggle":
    case "run":
      return;
    case "call":
      if (!document.meta.capabilities.includes(action.capability)) {
        issues.push(issue("capability.not-declared", `Capability "${action.capability}" is not declared.`, path));
      }
      if (!options.capabilities.has(action.capability)) {
        issues.push(issue("capability.not-registered", `Capability "${action.capability}" is not registered.`, path));
      }
      if (action.args) {
        validateValue(action.args, `${path}.args`, issues);
      }
      return;
    case "if":
      validateValue(action.condition, `${path}.condition`, issues);
      validateActions(action.then, `${path}.then`, document, options, issues);
      if (action.else) {
        validateActions(action.else, `${path}.else`, document, options, issues);
      }
      return;
    case "try":
      validateActions(action.body, `${path}.body`, document, options, issues);
      if (action.catch) {
        validateActions(action.catch, `${path}.catch`, document, options, issues);
      }
      if (action.finally) {
        validateActions(action.finally, `${path}.finally`, document, options, issues);
      }
  }
}
function validateValue(value, path, issues) {
  switch (value.kind) {
    case "literal":
    case "reference":
      return;
    case "array":
      value.items.forEach((item, index) => validateValue(item, `${path}[${index}]`, issues));
      return;
    case "object":
      Object.entries(value.entries).forEach(([key, item]) => validateValue(item, `${path}.${key}`, issues));
      return;
    case "expression":
      value.args.forEach((item, index) => validateValue(item, `${path}.args[${index}]`, issues));
  }
}
function literalValue(value) {
  return value.kind === "literal" ? value.value : undefined;
}
function component(props, events) {
  return { props: new Set(props), events: new Set(events) };
}
function issue(code, message, path) {
  return { code, message, path };
}
export {
  validateDocument,
  createMvpHtmlRegistry
};
