# 0017：Source codec、规范化与交付边界

- 状态：M3 已实现；M4 envelope / memory cache 已实现，持久化 store adapter 待实现
- 日期：2026-08-15
- 前置：[0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md)、[0016-catalog-capability-contract.md](./0016-catalog-capability-contract.md)
- 关联：[0002-document-codecs.md](./0002-document-codecs.md)、[0004-document-delivery.md](./0004-document-delivery.md)

## 1. 决策

JSON、YAML、TOML、TOON、BSON 与本地 TypeScript 对象只是在表达同一个 PageSpec 的**source codec**。它们不得各自拥有组件、binding、capability、extension 或执行 AST 的语义。

```text
原始文本 / 字节 / 静态对象
             │
             ▼
        source codec
  （解析 + JSON-compatible 值 + source map）
             │
             ▼
      唯一 PageSpec normalizer
 （版本迁移 + manifest/extension 校验）
             │
             ▼
      PageHost / renderer
```

这意味着：

- `@domily/next` 只定义 codec 接口、通用数据模型、source map 和 normalizer；
- `@domily/next-codec-json` 是 MVP 唯一必选实现；YAML/TOML/TOON/BSON 均为可选 codec 包；
- 本地 `.dmy.ts` 也必须先得到 JSON-compatible PageSpec 值，再进入同一个 normalizer；它不拥有特殊运行时能力；
- 远程交付保存并校验原始 payload，不能只保存编译后的 IR 或重新序列化的近似值。

## 2. codec 的唯一职责

```ts
interface SourceCodec {
  readonly id: string;
  readonly version: string;
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  parse(payload: SourcePayload): SourceCodecResult<ParsedSource>;
  serialize?(value: JsonValue): SourceCodecResult<SourcePayload>;
}

interface ParsedSource {
  value: JsonValue;
  sourceMap?: SourceMap;
  payload: SourcePayload;
}
```

codec 负责：

1. 将文本或字节解析为 JSON-compatible `null | boolean | number | string | array | object`；
2. 报告语法诊断、字符/字节位置和结构来源；
3. 保留输入的原始文本或字节；
4. 在需要时提供确定性的格式化/输出。

codec 不负责：

- 判断 `type: html.button` 是否存在；
- 理解 `on`、binding、scope、capability 或 `extensions`；
- 将 `$ref`、`op`、`kind` 或任何格式私有字段降级到执行 AST；
- 下载 codec、Catalog、extension 或模块；
- 因为某种格式“更简洁”而添加新的运行时语义。

所有语义校验与版本迁移集中在一个 `normalizePageSpec(value, registrySnapshot)` 中完成。当前 JSON codec 中“JSON → Document AST”的映射应在迁移时删除，而不是复制到 YAML/TOON codec。

## 3. source map：在 parse 阶段分配 node ID

SourceMap 的 node ID 在**parse 阶段**分配，并由 codec 输出与通用值一同保存；normalizer 和 Host
不重新分配它们。

理由：

1. source codec 才知道 JSON token、YAML 行列、TOML table 或 BSON byte offset 的准确位置；
2. PageSpec normalizer 可以在字段重命名、默认值填充、版本迁移后仍回链到原输入；
3. 多 codec 可以为同一语义提供不同的精确 source span，而无需让 Host 理解每种文本格式；
4. parse 后的 ID 不依赖 renderer 的结构，因此升级 normalizer/Host 不会切断已缓存诊断的来源关联。

规则：

- 每个 scalar、array、object、key/value pair 至少有一个稳定 `SourceNodeId`；
- codec 无法提供精确字节范围时，至少提供路径和文档级 origin，不能伪造精确位置；
- node ID 的稳定性只要求在同一次 parse 结果和同一 payload hash 内成立，不承诺跨任意文本编辑永久不变。

当前 `SourceMap` v1 只有 codec node range；normalizer 的 `PageSpecIssue.path` 还是逻辑路径，二者尚未有
codec-neutral 的 `path → SourceNodeId` 映射。因此 delivery 返回二者而不伪造 JSON Pointer 诊断。默认值、
synthetic origin 和精确语义诊断回链属于后续 SourceMap contract 扩展。

## 4. 各格式的承诺与边界

| 格式 | 计划定位 | 必须遵守的边界 |
| --- | --- | --- |
| JSON | MVP 必选、服务端交付的基线 | 严格 JSON；无注释、无函数、无额外类型 |
| YAML | 人工编写的可选表示 | 只接受可规范化到 JSON 的节点；拒绝自定义 tag、对象构造、外部 include 与会改变值图的语义 |
| TOML | 配置文件式的可选表示 | 只接受可规范化到 JSON 的类型；日期、二进制等不能隐式变成运行时对象 |
| TOON | AI 生成/传输的 experimental 紧凑表示 | 必须通过同一 fixture、schema 与 round-trip 测试；不能成为另一套 DSL 或默认真相源 |
| BSON | 后续二进制传输 codec | payload 以字节保存；任何 BSON 专有值都需显式映射为 PageSpec 允许的 JSON 值或报错 |
| `.dmy.ts` | 本地开发时的类型辅助入口 | 只允许静态、JSON-compatible `definePage()` 对象；不允许函数、闭包、import 结果或动态计算混入页面值 |

TOON 可以作为 AI 生成时的优先输出格式，但其 experimental 标签在满足以下条件前不得去除：同一组跨 codec fixture 语义等价、解析器有明确版本、AI 生成质量有可复现评估、失败时可回退 JSON。AI 选择 TOON 是传输/令牌成本决策，不是协议语义决策。

YAML anchors、TOML 扩展类型和 BSON 的特殊值若未来需要支持，也必须由 codec 将它们确定性地归一为 JSON 值并记录 origin；不能把对象引用、日期实例或二进制对象泄漏进 PageSpec。

## 5. 本地 TypeScript 的边界

`.dmy.ts` 应是 PageSpec 的便利书写形式，而非宏语言：

```ts
import { definePage } from '@domily/next';

export default definePage({
  schema: 'domily.page/v1',
  id: 'todos',
  ui: { type: 'app.TodoPage' },
});
```

Vite 插件在构建期仅做静态提取、类型辅助和 source map 映射，然后把值送入 normalizer。下面形式必须报错或显式降级为普通业务 TypeScript，而不能伪装成远程可下发 PageSpec：

- function、class、symbol、bigint、`Date`、`Map`、DOM 节点；
- 闭包捕获、运行时条件、网络返回值和非静态计算；
- `action()`、`ref()`、`derived()`、`event()` 等旧执行 AST 宏；
- 仅本地能运行、却无法被 JSON/YAML/TOON 同构表示的能力。

## 6. delivery envelope 与原始 payload

服务端交付使用 envelope 包住 source payload，而不是下发任何私有执行产物。建议规范化为可承载文本和字节的抽象：

```ts
interface PageEnvelope {
  schema: 'domily.envelope/v2';
  documentId: string;
  revision: number;
  pageSpec: 'domily.page/v1';
  codec: { id: string; version: string; mediaType?: string };
  payload: SourcePayload;
  payloadHash: string;
  cache: { maxAgeSeconds: number; staleWhileRevalidateSeconds?: number };
  signature?: { algorithm: 'Ed25519'; keyId: string; value: string };
  issuedAt?: string;
  expiresAt?: string;
}

type SourcePayload =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; bytes: Uint8Array };
```

`payloadHash` 固定使用 `sha256-` 加小写 hex，并覆盖原始 payload bytes。签名输入使用固定字段顺序，
覆盖 document ID、revision、PageSpec version、codec ID/version/mediaType、cache policy、payload kind、
payload hash、时间字段与原始 payload bytes，避免攻击者在不改变页面可见内容的情况下替换 codec 或解释方式。Host 在 decode 前先验证 hash、签名与时效性；随后才选择**精确版本匹配**的已注册 codec、parse、normalize，并按 [0016](./0016-catalog-capability-contract.md) 的 registry 快照校验 Catalog/extension/capability。远程 envelope 默认要求宿主验签；只有显式开发策略可允许 unsigned。

本地文件不需要伪装成 envelope；Host 可直接构造同一条 parse → normalize → mount 路径。远程 payload 的原始形式必须保存，便于签名重验、离线回退、诊断回链与未来 codec 迁移。

## 7. 缓存与离线回退

缓存条目只保存：

- 完整 envelope 元数据、原始 payload、payload hash；
- 本地 `acceptedAt`（仅审计，绝不作为信任时钟）；
- 当前依赖 fingerprint（仅 provenance，不能跳过重校验）。

缓存命中重新验证 payload 完整性、签名、codec 精确版本与 remote normalizer；不会复用上一次的
PageSpec、source map 或执行计划。若本地应用升级导致某个 Catalog/extension 版本不再匹配，应使用原
payload 重新 normalize；若仍不兼容，丢弃缓存并由 Host 选择安全离线回退页面，而不是静默执行旧 IR。

可显示的缓存必须有签名覆盖的 `issuedAt` 与 `expiresAt`：fresh/stale 窗口以 `issuedAt + cache policy`
计算，并永不越过 `expiresAt`。这避免可篡改的持久化 `acceptedAt` 将旧页面永久钉住。已过期 raw envelope
不再渲染，但可保留为 revision watermark；较低 revision 与同 revision 不同 payload hash 不能覆盖它。
`PageEnvelopeStore` 对 `(namespace, documentId)` 必须提供原子 compare-and-swap：比较 revision/hash 与写入在
同一事务内完成，因而多个 client 或浏览器标签共享存储时也不能让低 revision 后写覆盖高 revision。

delivery 的 scope 是 `{ manifest, extension? }`。普通 host scope 明确对远程 PageSpec 可见；extension-owned
scope 必须标注 owner，且仅在该 extension 同时出现在 `requires.extensions` 和 `extensions` 配置中时参与验证。
PageHost 也执行相同的 owner 检查，不能以同名普通 scope 冒充 extension provider。

这样“服务端热更新”仍然只是更新可审计配置；它既不能绕开本地部署的能力边界，也不会因离线缓存遗失原文而失去可解释性。

## 8. 包边界与迁移

```text
@domily/next
  ├── codec 接口、SourcePayload、SourceMap、PageSpec normalizer、delivery envelope/cache 抽象
  ├── native DOM host / Catalog registry
  └── 不依赖任何具体 codec

@domily/next-codec-json
  └── JSON parse/stringify + source map

未来可选：@domily/next-codec-yaml / -toml / -toon / -bson
```

具体 codec 是独立安装/导入的实现；应用若只使用 JSON，不会因支持 YAML、TOON 或 BSON 带入额外解析器。对业务开发者而言，`@domily/next` 仍可以提供一键注册 JSON 的便捷入口；这只是发布体验，不使 core 对 `codec-json` 产生反向依赖。

迁移顺序：

1. 删除当前 JSON → 执行 AST codec；新的 JSON codec 仅保留通用 JSON parse/stringify 与 SourceMap（已完成）；
2. 在 core 建立 `SourceCodec`、通用 source map、`PageSpec` normalizer、envelope v2 与 cache 抽象；
3. 重写 JSON codec，使其只输出 `JsonValue + SourceMap + original payload`；
4. 用 JSON fixture 建立 PageSpec/manifest/extension/diagnostic 回归测试；
5. 再分别引入 YAML、TOON、TOML、BSON codec，每一个都复用同一 fixture；
6. 已迁移 delivery cache 的 memory/store contract，使原 payload 与依赖 fingerprint 成为一等数据；后续补持久化 adapter。

## 9. 验收标准

1. 同一 PageSpec fixture 经 JSON、YAML、TOML、TOON（若启用）解析后得到语义等价的规范化 PageSpec 和相同的 manifest 校验结果；差异只允许存在 source span。
2. codec 中不存在旧 `op`、`$ref`、`action`、renderer node 等执行语义映射；它只处理格式语法与通用 JSON-compatible 值。
3. delivery 同时返回 normalizer 的逻辑 issue path 与 codec SourceMap；在 path→origin 映射扩展前，不伪造跨格式精确诊断。
4. `.dmy.ts` 与 JSON 文档不能在运行时能力上分叉；静态提取失败时给出构建期错误。
5. 远程 envelope 签名覆盖原 payload 与 codec/version，缓存保留原文/原字节，且 remote document 永远无法加载未注册的 codec、Catalog、extension 或 capability。
6. TOON 保持 experimental，只有在同构 fixture、round-trip、解析器版本和 AI 评估均通过后才可提升；失败时安全回退 JSON。
