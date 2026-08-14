# 0002：以 Document AST 为中心的多格式 Codec

- 状态：JSON codec 与来源追踪 MVP 已实现；其他格式 codec 待实现
- 日期：2026-08-12
- 关联：[0001-schema-driven-ui.md](./0001-schema-driven-ui.md)

## 1. 决策

Domily Next 的语言定义是 `Document AST`，不是 JSON Object。JSON、YAML、TOML、TOON 与 BSON 都是 AST 的输入/输出 codec。Runtime、校验器、表达式解释器、动作解释器和 renderer adapter 一律只接受已规范化的 `Document AST`。在 `0.x` 阶段，AST 公共 API 标记为 `experimental`，允许依据 MVP 实践进行破坏性调整。

这满足两类使用方式：

- 开发者可按项目偏好使用可读的文本格式；
- AI 默认使用 token 更紧凑的 TOON 生成同一语义文档；JSON 是服务端分发和缓存的基准格式。

## 2. 为什么不能只做“JSON 对象互转”

不同格式的原生数据能力不同：

| 格式 | 需要处理的差异 |
| --- | --- |
| JSON | 最适合作为服务端传输基准，但没有注释，所有数值均为 JSON number。 |
| YAML | 有标签、锚点、别名、日期/二进制等扩展；必须禁用或拒绝非协议类型。 |
| TOML | 没有 `null`，数组要求元素同质，并有日期时间等额外标量。 |
| TOON | 是 JSON 数据模型的文本编码，适合 AI 上下文，但官方规范仍是 Working Draft。 |
| BSON | 有 `Date`、`ObjectId`、`Binary`、整数宽度等 JSON 没有的类型。 |

因此，`JSON.parse(yaml.stringify(value))` 式的抽象会让格式暗中决定运行时值类型，破坏“同一协议语义”。Codec 必须直接实现“格式语法 ↔ AST”的显式映射。

## 3. 分层

```text
source bytes/text
  -> codec parser                  # JSON/YAML/TOML/TOON/BSON 的词法与语法；分配 SourceNodeId
  -> parsed Document AST           # 纯协议节点
  -> SourceMap + NodeOrigins       # 平行来源信息；不污染 AST
  -> normalizeDocument             # 填充规范默认值、对象排序无关化、冻结，并传播 NodeOrigins
  -> validateDocument              # AST、引用、组件、权限、资源限制
  -> migrateDocument               # 明确版本迁移，并传播/继承 NodeOrigins
  -> runtime
```

`normalizeDocument` 的输入只能是 AST，不能接受任意 JavaScript 对象。这样开发者本地的 YAML 与服务端的 JSON 会走同一条校验/运行路径。

## 4. AST 的最低要求

AST 是带鉴别字段的 TypeScript 数据结构，而不是 `Record<string, unknown>`。节点的源代码位置放在与 AST 平行的 `SourceMap` 中，不能作为 AST 节点字段，以保持 AST 在 JSON/TOON/BSON 下的稳定等价性：

```ts
type Literal = string | number | boolean | null;

type ValueNode =
  | { kind: "literal"; value: Literal }
  | { kind: "reference"; path: ReferencePath }
  | { kind: "expression"; op: ExpressionOperator; args: ValueNode[] };

type ActionNode =
  | { kind: "set"; path: StatePath; value: ValueNode }
  | { kind: "run"; action: ActionName }
  | { kind: "call"; capability: CapabilityName; args?: ValueNode }
  | { kind: "if"; condition: ValueNode; then: ActionNode[]; else?: ActionNode[] }
  | { kind: "try"; body: ActionNode[]; catch?: ActionNode[]; finally?: ActionNode[] };

interface Document {
  kind: "document";
  protocol: "domily-next";
  version: "0.1";
  meta: DocumentMeta;
  state: StateDeclaration;
  derived: Record<string, ValueNode>;
  actions: Record<string, ActionNode[]>;
  lifecycle: LifecycleDeclaration;
  view: ViewNode;
}
```

上述是方向性类型，并非最终 API。重点在于：每个节点的种类明确，普通对象不可能被误认为表达式或动作；解析器、校验器和 AI 都有可用的封闭 schema。

协议可提供 JSON 写法的作者便利语法，例如 `{ "$ref": "state.name" }`，但 JSON codec 必须把它解析为 `{ kind: "reference", path: "state.name" }`。Runtime 绝不读取 `$ref` 这类格式符号。

## 5. Codec 契约

```ts
type CodecIssue = {
  code: string;
  message: string;
  location?: { line: number; column: number; offset?: number };
};

type CodecResult<T> =
  | { ok: true; value: T; issues: CodecIssue[] }
  | { ok: false; issues: CodecIssue[] };

interface DocumentCodec<Input = string> {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  parse(input: Input): CodecResult<Document>;
  serialize(document: Document): CodecResult<Input>;
}

interface CodecRegistry {
  register(codec: DocumentCodec): void;
  byExtension(extension: string): DocumentCodec | undefined;
  byMediaType(mediaType: string): DocumentCodec | undefined;
}
```

Codec 可以提供更丰富的 `parseWithSourceMap` API，但通用接口不能泄露任何格式库的 AST 或数据类型。`parse` 成功的唯一含义是“语法和语法级映射成功”；文档合法性仍由后续 `validateDocument` 决定。

### 5.1 来源节点 ID 与迁移后的诊断

`SourceNodeId` **必须在 parse 阶段分配**。它是一个只在单个原始 payload 内有效的、不透明来源节点标识，而不是 `Document AST` 的语义节点 ID：

```ts
type SourceNodeId = string;

interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

interface SourceMap {
  codecId: string;
  nodes: Record<SourceNodeId, SourceRange>;
}

// 与 AST 对象并行保存；不序列化、不参与 hash 或签名。
type NodeOrigins = WeakMap<object, readonly SourceNodeId[]>;
```

Codec 应按源格式中的结构路径确定性地分配 ID，例如 `json:/view/children/2/props/title`。不得以字节偏移或节点内容 hash 作为 ID：前者在编辑后不稳定，后者会使重复内容冲突。`SourceRange` 才保存实际的 start/end 偏移、行和列。

`normalizeDocument` 与每个 `migrateDocument` 实现都必须接受并返回同一份平行的 `NodeOrigins` 语义：

- 原样保留的 AST 节点保留原来的来源 ID；
- 合并多个节点时，结果节点合并所有来源 ID；拆分一个节点时，所有派生节点继承该来源 ID；
- 迁移新增、没有直接来源的节点继承最接近的触发/父节点来源；确实无合理来源时关联 document root，并在诊断中标记为“迁移生成”；
- 任何诊断在规范化或迁移后都先通过 `NodeOrigins` 查到 `SourceNodeId`，再通过 `SourceMap` 回链至用户的原始文本位置。

因此 `SourceMap` 和 `NodeOrigins` 不属于可签名、可缓存的 `Document` 值。离线缓存保留 raw payload；当需要重新显示带来源位置的诊断时，使用原 codec 重新 parse raw payload 并重建这两份边车数据。

## 6. 规范化和等价性

每个 codec 需要通过同一组 fixture：

```text
fixtures/todo.json
fixtures/todo.yaml
fixtures/todo.toml
fixtures/todo.toon
fixtures/todo.bson
       │
       ▼
all normalize to the same Document AST
```

等价性按 AST 结构比较，不按原始文本、键顺序、注释、来源 ID、`SourceMap`、`NodeOrigins` 或 BSON 二进制表示比较。Codec 不必保留格式无关的信息（JSON 无注释），除非以后另建 editor/CST 层。

加载器可同时保存原始 payload 和规范化 AST：原始 payload 用于重新诊断、格式化回写、审计与未来 codec 升级；已验证 AST 用于离线快速 mount。两者通过 `documentId + revision + contentHash + codecId` 关联，不能只凭 URL 或文件名关联。

## 7. 各格式的 v0 规则

### JSON — MVP 必选

- `.domily.json` 与 `application/vnd.domily+json`；
- 服务端下发、离线缓存与测试 fixture 的标准载体；
- 无扩展，严格 JSON；
- 作者便利语法由 JSON codec 解析为 AST。

### YAML — 后续 codec

- 只接受 JSON-compatible YAML 子集；
- 禁止自定义 tag、锚点/别名、日期、二进制、NaN/Infinity 及隐式类型歧义；
- 推荐 `.domily.yaml`，用于开发者手写配置；
- 允许注释作为源码编辑体验，不纳入运行时 AST。

### TOML — 后续 codec，采用显式 AST 表示

TOML 不能自然表示 `null`、异构数组和部分深层节点。因此不能把任意 JSON 文档自动导出为“自然 TOML”。它应该使用 Domily TOML 映射：

```toml
[document]
protocol = "domily-next"
version = "0.1"

[document.state]
newTitle = ""
error = { kind = "literal", valueType = "null" }

[[document.view.children]]
kind = "view"
component = "Text"
[document.view.children.props.value]
kind = "reference"
path = "state.newTitle"
```

这不是“任意 JSON 的 TOML 转换”，而是受 AST 类型约束的文档格式。TOML codec 必须在不能无歧义表示时报告错误，不得静默转换字符串或丢失类型。

### TOON — 后续 AI 首选 codec

- 解析 TOON 对 JSON 数据模型的编码后，走与 JSON 相同的 AST 映射；
- 对外应记录所支持的 TOON 规范版本；
- 作为 AI 生成的首选输入/输出表示；JSON 仍是运行时分发基准；
- 生成侧须在实际模型上以 fixture 验证，而不是假定 token 更少就一定生成更准确；
- 官方规范将 TOON 定义为 JSON 数据模型的行式、缩进式编码，目前状态为 Working Draft。[TOON 规范](https://github.com/toon-format/spec)

### BSON — 后续传输 codec

- BSON 的作用是高效二进制传输或本地存储，不是人类作者格式；
- 只接受能规范化为协议 `Literal` 和 AST 节点的值；
- `Date`、`ObjectId`、`Binary`、`RegExp`、`Decimal128`、`undefined` 等值默认拒绝；若以后确实需要，必须为协议新增明确的 tagged AST node，而非隐式强转。

## 8. 包结构与依赖方向

```text
domily-next/ast           # 纯 TypeScript 类型、构造器、规范化、无 I/O
domily-next/codec-core    # DocumentCodec、registry、诊断协议
domily-next/codec-json    # 仅 JSON；MVP 必选
domily-next/codec-yaml    # 可选；依赖 YAML parser
domily-next/codec-toml    # 可选；依赖 TOML parser
domily-next/codec-toon    # 可选；依赖 TOON parser
domily-next/codec-bson    # 可选；依赖 BSON library
domily-next/validator     # 只依赖 ast
domily-next/runtime       # 依赖 ast + validator，不依赖任何 codec
domily-next/dom           # runtime 到现有 Domily 的 renderer adapter
```

这条依赖方向避免了 YAML/TOML/TOON/BSON 依赖、解析错误和格式特性进入 runtime。MVP 只新引入 JSON codec，不增加 YAML/TOML/TOON/BSON 的第三方依赖。

## 9. MVP 验收

1. ✅ JSON codec 能解析、序列化并在 parse-serialize-parse 后产生等价 AST；
2. 任何 runtime API 都不能接收原始 JSON object 或 JSON 文本；
3. AST fixture 覆盖引用、表达式、动作、生命周期和组件节点；
4. ✅ JSON codec 诊断能报告至少文件/行/列，并能以 `SourceNodeId` 回链至原始 JSON 范围；
5. `CodecRegistry` 可注册一个测试 codec，证明 runtime 不绑定 JSON；
6. TOML/YAML/TOON/BSON 不进入 MVP 依赖树，但类型和 registry 边界允许其独立上线。

## 10. 已确认与未决细节

已确认：AST 公共 API 在 `0.x` 为 `experimental`；source span 放在平行 `SourceMap`；`SourceNodeId` 在 parse 阶段按 codec 的结构路径确定性分配，`normalizeDocument` 与 `migrateDocument` 通过平行 `NodeOrigins` 传播来源；AI 默认生成 TOON，JSON 用于服务端分发与缓存；缓存同时保存 raw payload 和已验证 AST。
