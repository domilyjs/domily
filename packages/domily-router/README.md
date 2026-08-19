# @domily/router

A lightweight router implementation for the Domily applications.

## Installation

```bash
npm install @domily/router
# or
bun add @domily/router
```

## Basic Usage

in the `routers/index.js` or `routers/index.ts`:

```typescript
import { createHistoryRouter } from "@domily/router";

const routes = [
  {
    name: "parent",
    path: "/",
    component: import("view/parent"),
    meta: {
      // ...
    },
    children: [
      {
        name: "child",
        path: "/path",
        component: import("view/child"),
      },
    ],
  },
  {
    name: "not-found",
    path: "*",
    component: import("view/not-found"),
  },
];

const router = createHistoryRouter({
  base: "/",
  routes,
});

// also you can use `createHashRouter` to create a hash router as follow:
/**
 * import { createHashRouter } from '@domily/router';
 *
 * const router = createHashRouter({
 *   base: '/',
 *   routes,
 * });
 */

router.beforeEach((from, to, next) => {
  // the router guards here
  // Call next() after any asynchronous work; navigation waits for it.
  next();
});

router.afterEach((to) => {
  // the callback here after the router resolved
});

export default router;
```

in the `app.js` or `app.ts`:

```ts
export default () => ({ tag: "router-view" });
```

in the `main.js` or `main.ts`

```typescript
import { createApp } from "@domily/runtime-core";

import App from "./app";
import router from "./routers";
import "./css.css";

const { app, mount } = createApp(App);

app.use(router);

mount();
```

## API Reference

```ts
function createHistoryRouter(option?: ICreateRouterOptions): DOMilyRouterPlugin

function createHashRouter(option?: ICreateRouterOptions): DOMilyRouterPlugin

function useRouter(namespace?: string | symbol): DOMilyRouterHelper

function useRoute(namespace?: string | symbol): DomilyRouterBase["currentRoute"]

interface DOMilyRouterHelper {
  push: DomilyRouterBase["push"];
  replace: DomilyRouterBase["replace"];
  resolve: DomilyRouterBase["resolve"];
  back: DomilyRouterBase["back"];
  forward: DomilyRouterBase["forward"];
  go: DomilyRouterBase["go"];
  destroy: DomilyRouterBase["destroy"];
  routes: DomilyRouterBase["routes"];
  currentRoute: DomilyRouterBase["currentRoute"];
}
```

### Router Configuration

```ts
interface ICreateRouterOptions {
  base?: string;
  routes?: IDomilyPageSchema<any, any>[];
}

interface IDomilyPageSchema<
  PageMeta = {},
  Props extends Record<string, any> = {}
> {
  /**
   * the name of the route
   */
  name?: string;
  /**
   * the namespace of the domily application to which the route belongs
   */
  namespace?: string | symbol;
  /**
   * the path of the route
   */
  path: string;
  /**
   * the alias of the route
   */
  alias?: string | string[];
  /**
   * the component of the route
   */
  component?: DOMilyComponent | AsyncDOMilyComponentModule;
  /**
   * the redirect configuration of the route
   */
  redirect?: { name?: string; path?: string };
  /**
   * the meta information of the route
   */
  meta?: PageMeta;
  /**
   * the children of the route
   */
  children?: IDomilyPageSchema[];
  /**
   * the props of the route component
   */
  props?: Props;
}
```
