import * as PTR from "path-to-regexp";
import type DomilyPageSchema from "./page";

export interface IRouterConfig extends DomilyPageSchema<any, any> {
  parent?: IRouterConfig | null;
}

export interface IMatchedRoute extends IRouterConfig {
  params?: Record<string, string>;
  query?: Record<string, string>;
  hash?: string;
  fullPath?: string;
  href?: string;
}

const hasPathBoundary = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

const toPathToRegexpPath = (path: string) => {
  if (path === "*" || path === "/*") {
    return "/{*path}";
  }

  let wildcardIndex = 0;
  return path.replace(/(^|\/)\*(?=\/|$)/g, (_match, separator: string) => {
    const name = `wildcard${wildcardIndex}`;
    wildcardIndex++;
    return `${separator}*${name}`;
  });
};

const normalizeParams = (
  path: string,
  params: Record<string, any> = {}
) => {
  const normalized = { ...params };
  const { tokens } = PTR.parse(toPathToRegexpPath(path));

  const visit = (items: PTR.Token[]) => {
    for (const item of items) {
      if (item.type === "wildcard") {
        const value = normalized[item.name];
        if (typeof value === "string") {
          normalized[item.name] = value ? value.split("/") : [];
        }
      } else if (item.type === "group") {
        visit(item.tokens);
      }
    }
  };

  visit(tokens);
  return normalized;
};

const createMatchedRoute = (
  route: IRouterConfig,
  path: string,
  parent: IMatchedRoute | null,
  data: Pick<IMatchedRoute, "params" | "query" | "hash">
) => {
  const matched = Object.assign(
    Object.create(Object.getPrototypeOf(route)),
    route,
    {
      path,
      parent,
      ...data,
    }
  ) as IMatchedRoute;

  if (typeof route.render === "function") {
    matched.render = route.render.bind(route);
  }

  return matched;
};

export function parsePathname(pathname: string) {
  const hashIndex = pathname.indexOf("#");
  const pathWithQuery =
    hashIndex === -1 ? pathname : pathname.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : pathname.slice(hashIndex + 1);
  const searchIndex = pathWithQuery.indexOf("?");

  return [
    searchIndex === -1 ? pathWithQuery : pathWithQuery.slice(0, searchIndex),
    searchIndex === -1 ? "" : pathWithQuery.slice(searchIndex + 1),
    hash,
  ] as const;
}

export function handleStringPathname(pathname: string) {
  const [path, search, hash] = parsePathname(pathname);
  return {
    path,
    query: Object.fromEntries(new URLSearchParams(search).entries()),
    hash: hash || undefined,
  };
}

export const removeEndSlash = (path: string) => {
  const [pathname, search, hash] = parsePathname(path);
  const normalizedPath =
    !pathname || /^\/+$/u.test(pathname)
      ? pathname
        ? "/"
        : ""
      : pathname.replace(/\/+$/u, "");
  return `${normalizedPath}${search ? `?${search}` : ""}${
    hash ? `#${hash}` : ""
  }`;
};

export const normalizeBase = (base = "/") => {
  const path = base.startsWith("/") ? base : `/${base}`;
  return removeEndSlash(path) || "/";
};

export const isPathWithinBase = (path: string, base = "/") => {
  const normalizedBase = normalizeBase(base);
  const [pathname] = parsePathname(path);
  return normalizedBase === "/" || hasPathBoundary(pathname, normalizedBase);
};

// Combine parent and child route paths without treating an unrelated shared
// string prefix (for example /app and /apple) as an already complete path.
export const combinePaths = (parent?: string, child: string = ""): string => {
  if (!parent) {
    return removeEndSlash(child);
  }
  if (!child) {
    return removeEndSlash(parent);
  }

  const normalizedParent = removeEndSlash(parent) || "/";
  if (hasPathBoundary(child, normalizedParent)) {
    return removeEndSlash(child);
  }
  if (normalizedParent === "/") {
    return removeEndSlash(child.startsWith("/") ? child : `/${child}`);
  }

  return removeEndSlash(
    `${normalizedParent}${child.startsWith("/") ? "" : "/"}${child}`
  );
};

// 辅助函数：路径优先级评分（静态>动态>通配符）
export const getPathPriorityScore = (path: string): number => {
  const normalizedPath = toPathToRegexpPath(path);
  if (normalizedPath.includes("*")) return 0;
  const dynamicSegments = (normalizedPath.match(/:\w+/g) || []).length;
  return 1000 - dynamicSegments * 100 + normalizedPath.length;
};

// 编译路径为正则表达式
export const compilePath = (path: string, end = true) => {
  return PTR.pathToRegexp(toPathToRegexpPath(path), { end });
};

// 提取参数（合并父级参数）
export const extractParams = (
  keys: PTR.Key[],
  matched: RegExpExecArray,
  parentParams: Record<string, string>
) => {
  return keys.reduce((params, key, index) => {
    params[key.name] = matched[index + 1] || "";
    return params;
  }, { ...parentParams } as Record<string, string>);
};

// 处理别名路径
export const getAliasPaths = (
  route: IRouterConfig,
  parentPath: string,
  basePath = ""
): string[] => {
  const aliases = Array.isArray(route.alias)
    ? route.alias
    : route.alias
      ? [route.alias]
      : [];

  return aliases.map((alias) =>
    alias.startsWith("/")
      ? combinePaths(basePath, alias)
      : combinePaths(parentPath, alias)
  );
};

export function generateFullUrl(
  pathTemplate: string,
  data?: {
    params?: Record<string, any>;
    query?: Record<string, any>;
    hash?: string;
  },
  mode: "hash" | "history" = "hash",
  base = "/"
) {
  const [pathname = "", search, templateHash] = parsePathname(pathTemplate);
  const toPath = PTR.compile(toPathToRegexpPath(pathname));
  const pathWithParams = toPath(normalizeParams(pathname, data?.params));
  const query = Object.fromEntries(new URLSearchParams(search).entries());
  const queryString = new URLSearchParams({
    ...query,
    ...data?.query,
  }).toString();
  const hash = data?.hash ?? templateHash;
  const pathWithSearch = `${pathWithParams}${
    queryString ? `?${queryString}` : ""
  }${hash ? `#${hash}` : ""}`;
  const fullPath = isPathWithinBase(pathWithSearch, base)
    ? pathWithSearch
    : combinePaths(normalizeBase(base), pathWithSearch);
  const location = globalThis.location;
  const origin = location?.origin || "http://localhost";
  const href =
    mode === "hash"
      ? (() => {
          const url = new URL(location?.href || `${origin}/`);
          url.hash = fullPath;
          return url.toString();
        })()
      : new URL(fullPath, origin).toString();

  return {
    fullPath,
    href,
  };
}

export function matchRoute(
  routes: IRouterConfig[],
  currentPath: string = globalThis.location?.pathname || "/",
  basePath = ""
): IMatchedRoute | null {
  const [pathname = "", search, hash] = parsePathname(currentPath);
  const query = Object.fromEntries(new URLSearchParams(search).entries());

  const matchRoutes = (
    configs: IRouterConfig[],
    parentPath: string,
    parentParams: Record<string, string>,
    parentRoute: IMatchedRoute | null
  ): IMatchedRoute | null => {
    const sortedRoutes = [...configs].sort(
      (a, b) =>
        getPathPriorityScore(b.path || "") -
        getPathPriorityScore(a.path || "")
    );

    for (const route of sortedRoutes) {
      const fullPath = combinePaths(parentPath, route.path || "");
      const aliasPaths = getAliasPaths(route, parentPath, basePath);

      for (const candidatePath of [fullPath, ...aliasPaths]) {
        const prefix = compilePath(candidatePath, false);
        const prefixMatch = prefix.regexp.exec(pathname);

        if (!prefixMatch) {
          continue;
        }

        const params = extractParams(prefix.keys, prefixMatch, parentParams);
        const matchedParent = createMatchedRoute(route, fullPath, parentRoute, {
          params,
          query,
          hash: hash || undefined,
        });

        if (route.children?.length) {
          const childMatch = matchRoutes(
            route.children as IRouterConfig[],
            candidatePath,
            params,
            matchedParent
          );
          if (childMatch) {
            return childMatch;
          }
        }

        const exact = compilePath(candidatePath);
        const exactMatch = exact.regexp.exec(pathname);
        if (exactMatch) {
          return createMatchedRoute(route, fullPath, parentRoute, {
            params: extractParams(exact.keys, exactMatch, parentParams),
            query,
            hash: hash || undefined,
          });
        }
      }
    }
    return null;
  };

  return matchRoutes(routes, normalizeBase(basePath), {}, null);
}
