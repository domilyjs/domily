# 0012：Core、Codec 与 Vite 插件的单向包边界

- 状态：MVP 已实现
- 日期：2026-08-14
- 取代：[0011-public-sdk-and-authoring.md](./0011-public-sdk-and-authoring.md)
- 关联：[0002-document-codecs.md](./0002-document-codecs.md)、[0003-authoring-dsl.md](./0003-authoring-dsl.md)、[0009-vite-authoring-integration.md](./0009-vite-authoring-integration.md)、[0010-examples.md](./0010-examples.md)

## 1. 决策

`@domily/next` 是协议与运行时核心，不依赖任何具体文本 codec、Vite 或 Vite 插件。JSON、YAML、TOML、TOON、BSON 等格式实现各自是独立包；Vite 集成也独立发布。所有边缘包只单向依赖 core。

```text
@domily/next-codec-json ──► @domily/next/codec
          │                         │
          └─────────────────────────► @domily/next

@domily/next-vite-plugin ─► @domily/next/compiler
          │                         │
          └─────────────────────────► @domily/next

@domily/next ──┬── no codec dependency
                └── no Vite/plugin dependency
```

这样 JSON parser 或未来 YAML/TOML/TOON/BSON 的第三方依赖、Vite 的生命周期与版本变动都不会污染 core 的浏览器运行时边界。

## 2. 目录与职责

```text
domily-next/
  core/                         # @domily/next
    src/ast/                    # Document AST、freeze
    src/codec/                  # DocumentCodec、registry、CodecIssue、SourceMap
    src/compiler/               # 受限 .dmy.ts compiler
    src/validator/              # AST/host 策略校验
    src/loader/                 # envelope、缓存、抽象 codec registry
    src/runtime/                # 动作与表达式执行
    src/renderer-dom/           # DOM renderer
    src/dom-host/               # host 组合
  codec-json/                   # @domily/next-codec-json
    src/index.ts                # JSON parse/serialize、来源映射、JSON app factory
  vite-plugin/                  # @domily/next-vite-plugin
    src/transform.ts            # .dmy.ts transform 与诊断
    src/index.ts                # domilyNext()/domilyVite()
```

core 内部模块一律使用相对路径；它们不是独立 npm 包。只有真正可独立选择、替换、按需安装的边界才成为 workspace/package。

## 3. Core 的公开入口

| 导入 | 职责 |
| --- | --- |
| `@domily/next` | `createDomilyApp`、`defineCapabilities`、DOM host 默认组合与公共协议类型。 |
| `@domily/next/author` | 编译期擦除的 `.dmy.ts` 声明式 helper。 |
| `@domily/next/codec` | `DocumentCodec`、`CodecRegistry`、`CodecIssue`、`SourceMap` 与 AST codec 所需类型。 |
| `@domily/next/compiler` | 供构建适配器调用的 Node/build-time compiler 子路径。 |

core 不再提供 `@domily/next/json` 或 `@domily/next/vite`。这避免“看似 core 子模块、实际属于可选边缘实现”的误导。

## 4. 独立包的公共入口

| 包 | 依赖方向 | 公开能力 |
| --- | --- | --- |
| `@domily/next-codec-json` | `codec-json → core` | `jsonDocumentCodec`、parse/serialize、来源映射、`createJsonCodecRegistry()`、`createDomilyJsonApp()`。 |
| `@domily/next-vite-plugin` | `vite-plugin → core` | `domilyNext()`、`domilyVite()`、transform 诊断与 Vite plugin 类型。 |

未来 `@domily/next-codec-yaml`、`@domily/next-codec-toml`、`@domily/next-codec-toon`、`@domily/next-codec-bson` 复用同一个 `@domily/next/codec` 合约；它们不能被 core 静态导入。

## 5. 安装与产物边界

本地 DSL + Vite：

```sh
pnpm add @domily/next
pnpm add -D @domily/next-vite-plugin vite
```

服务端 JSON delivery：

```sh
pnpm add @domily/next @domily/next-codec-json
```

Vite plugin 是仅在 Node/Vite 配置进程中执行的开发依赖，绝不进入浏览器产物。JSON codec 仅在远程 JSON delivery 场景导入；纯本地 AST 应用不会把它纳入 bundle。这个显式安装成本换来了正确的依赖方向、可替换 codec 与清晰 tree-shaking 边界。

## 6. TypeScript workspace 规则

根 `tsconfig.json` 只保留不同 workspace 包的开发期 aliases，例如 `@domily/next-codec-json` 与 `@domily/next-vite-plugin`。core 内部不使用 package alias；跨 package 引用使用真实 package exports，并在 `build:next` 中先构建 core，再构建 codec/plugin。

因此声明构建不会把 core 源码错误并入 codec/plugin 的 `rootDir`，也不会重新形成 source-level 的反向依赖。

## 7. MVP 验收

1. `@domily/next` 的 manifest 不含 Vite peer/dependency，也不含 JSON codec 实现；
2. `@domily/next-codec-json` 包含真实 JSON parser/serializer，并只 peer 依赖 core；
3. `@domily/next-vite-plugin` 包含真实 Vite transform，并只 peer 依赖 core 与 Vite；
4. core、JSON codec、Vite plugin 各自拥有并通过对应回归测试；
5. `.dmy.ts` 示例由独立 Vite plugin 成功构建；
6. core root browser bundle 不包含 JSON parser、Vite adapter 或 author compiler；
7. 根 TypeScript 配置不再为 core 的根、author、codec、compiler 等入口提供 `paths` 映射。
