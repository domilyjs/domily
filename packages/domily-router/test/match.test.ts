import { describe, expect, test } from "bun:test";

import {
  combinePaths,
  compilePath,
  generateFullUrl,
  handleStringPathname,
  matchRoute,
  parsePathname,
  type IRouterConfig,
} from "../src/match";

const asRoutes = (routes: unknown) => routes as IRouterConfig[];

describe("router path matching", () => {
  test("keeps the complete fragment when parsing a string navigation target", () => {
    expect(parsePathname("/todos?filter=open#details")).toEqual([
      "/todos",
      "filter=open",
      "details",
    ]);
    expect(handleStringPathname("/todos?filter=open#details")).toEqual({
      path: "/todos",
      query: { filter: "open" },
      hash: "details",
    });
  });

  test("joins a base only once and does not mistake a shared prefix for a full path", () => {
    expect(combinePaths("/app", "/users")).toBe("/app/users");
    expect(combinePaths("/app", "/app/users")).toBe("/app/users");
    expect(combinePaths("/app", "/apple")).toBe("/app/apple");
  });

  test("matches nested routes by their complete path without exposing children at the root", () => {
    const routes = asRoutes([
      {
        name: "account",
        path: "/account",
        children: [
          {
            name: "account-user",
            path: "users/:id",
          },
        ],
      },
    ]);

    const matched = matchRoute(routes, "/app/account/users/42", "/app");

    expect(matched).toMatchObject({
      name: "account-user",
      path: "/app/account/users/:id",
      params: { id: "42" },
    });
    expect(matched?.parent).toMatchObject({
      name: "account",
      path: "/app/account",
    });
    expect(matchRoute(routes, "/app/users/42", "/app")).toBeNull();
  });

  test("does not write route metadata or match data back to caller-owned configs", () => {
    const routes = [
      {
        name: "account",
        path: "/account",
        children: [
          {
            name: "account-user",
            path: "users/:id",
          },
        ],
      },
    ];
    const original = structuredClone(routes);

    matchRoute(asRoutes(routes), "/app/account/users/42", "/app");

    expect(routes).toEqual(original);
  });

  test("accepts legacy anonymous wildcards with path-to-regexp v8", () => {
    const compiled = compilePath("/*");

    expect(compiled.regexp.test("/")).toBeTrue();
    expect(compiled.regexp.test("/missing/path")).toBeTrue();
    expect(
      matchRoute(asRoutes([{ name: "not-found", path: "*" }]), "/missing/path")
    ).toMatchObject({ name: "not-found", path: "/*" });
  });

  test("does not duplicate the base while generating a nested named-route URL", () => {
    const location = new URL("https://domily.test/app/");
    Reflect.defineProperty(globalThis, "location", {
      configurable: true,
      value: location,
    });

    expect(
      generateFullUrl(
        "/app/account/users/:id",
        { params: { id: "42" } },
        "history",
        "/app"
      )
    ).toEqual({
      fullPath: "/app/account/users/42",
      href: "https://domily.test/app/account/users/42",
    });
  });
});
