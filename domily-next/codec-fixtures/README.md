# Domily Next codec fixtures

此目录保存**格式无关的 PageSpec 语义基准**，不是一个可发布包，也不属于任何具体 codec。

每个新 codec 必须为这里的同名基准提供自己的源文件，并验证：

1. `parse()` 得到的 `value` 与基准 JSON 完全等价；
2. `payload` 保留原始文本或字节；
3. `SourceMap` 的 `codecId` 与该 codec 的 `id` 一致，并至少覆盖根值；
4. 若提供 `serialize()`，`parse(serialize(value))` 与基准值等价；
5. 解析后的值必须经同一个 `normalizePageSpec()`，不能由 codec 理解 Catalog、binding 或 capability 语义。

`page-v1/todo.json` 是第一个基准。它有意包含 requirements、嵌套 UI、样式对象、数组与 `$$` 转义字符串；后续为 TOON、YAML、TOML、BSON 增加 fixture 时，不得修改它来迁就某一种文本格式。

`@domily/next-codec-toon` 的对应源文件是
`../codec-toon/test/fixtures/todo.dmy.toon`。它由固定版本的官方 TOON encoder/decoder 验证，目前只提供
`toon:` 文档级 SourceMap node；不要将其误解为字段级诊断映射。

SourceMap node ID 是 codec 私有的，所以跨 codec 只比较语义值与范围契约，不比较 ID 字符串。
