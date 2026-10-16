# ARPK 容器格式规范 v1

**ARPK** = Asset Resource PacK。本项目自有的资源容器，用于把图标、内置字体等界面资源
打进单个文件。

> **设计来源声明**：本格式借鉴了 REA 逆向阶段发现的**两个思路** —— 资源按类型**分层**、
> 通过**名称索引**而非文件偏移寻址。**字段布局、编码方式、每一行实现均为本项目原创**，
> 与被分析产品的容器格式没有任何字节级复用。

---

## 1. 总体布局

所有整数为**小端序**。文件由 32 字节头、段表、若干段组成。

```
+------------------+ 0
| 文件头 (32 B)     |
+------------------+ 32
| 段表 (n × 20 B)   |
+------------------+
| META 段          |
+------------------+
| INDX 段          |
+------------------+
| DATA 段          |
+------------------+
| (可选) 扩展段     |
+------------------+
```

## 2. 文件头（32 字节）

| 偏移 | 长度 | 字段 | 说明 |
|---:|---:|---|---|
| 0 | 4 | `magic` | ASCII `"ARP1"` |
| 4 | 2 | `version` | 当前为 `1` |
| 6 | 2 | `headerSize` | 固定 `32` |
| 8 | 4 | `flags` | 保留，写 `0` |
| 12 | 2 | `sectionCount` | 段表项数 |
| 14 | 2 | `reserved` | 写 `0` |
| 16 | 8 | `fileSize` | 文件总长度 |
| 24 | 4 | `headerCrc` | **前 24 字节**的 CRC32 |
| 28 | 4 | `reserved2` | 写 `0` |

`headerCrc` 覆盖前 24 字节，因此**必须最后写入**。

## 3. 段表项（每项 20 字节）

| 偏移 | 长度 | 字段 |
|---:|---:|---|
| 0 | 4 | `id` — 4 字节 ASCII |
| 4 | 8 | `offset` — 相对文件起始 |
| 12 | 8 | `size` |

### 已定义的段

| id | 必需 | 内容 |
|---|---|---|
| `META` | 是 | 名称/值字符串表 |
| `INDX` | 是 | 名称索引（资产目录） |
| `DATA` | 是 | 各资产载荷首尾相接 |

**未知段必须被忽略但保留**（记录其 id/offset/size），以便后续版本增量扩展而不破坏旧读取端。

## 4. META 段

重复以下记录，直到段结束：

```
u16 keyLen   | key   (UTF-8, keyLen 字节)
u16 valueLen | value (UTF-8, valueLen 字节)
```

约定键：

| 键 | 含义 |
|---|---|
| `pack.name` | 包名 |
| `pack.version` | 包版本 |
| `layer.<id>` | 图层 `id` 的可读名，如 `layer.0 = ui` |

## 5. INDX 段（名称索引）

重复以下记录，直到段结束。**固定部分 28 字节**，其后是变长名称。

| 偏移 | 长度 | 字段 | 说明 |
|---:|---:|---|---|
| 0 | 4 | `nameHash` | 名称 UTF-8 字节的 **FNV-1a 32** |
| 4 | 8 | `dataOffset` | 相对 **DATA 段**起点的偏移 |
| 12 | 4 | `storedLen` | 存储长度（压缩后） |
| 16 | 4 | `rawLen` | 原始长度（压缩前） |
| 20 | 4 | `rawCrc32` | **原始**字节的 CRC32 |
| 24 | 2 | `nameLen` | 名称字节数 |
| 26 | 1 | `flags` | bit0 = 载荷为 raw DEFLATE |
| 27 | 1 | `layer` | 图层 id |
| 28 | `nameLen` | `name` | UTF-8 |

### 查找规则

1. 按名称精确匹配索引
2. 未命中时用 `nameHash` 缩小范围，**再逐个比对名称**
3. 名称使 SHA 类碰撞不可能，但哈希仍可能碰撞，故第 2 步不可省略

### 图层（分层）

`layer` 是一个小整数，语义由 META 的 `layer.<id>` 给出。本项目的约定：

| id | 名称 | 内容 |
|---:|---|---|
| 0 | `ui` | 图标等界面图形 |
| 1 | `font` | 内置字体 |

图层是**约定而非格式约束** —— 读取端不需要知道任何具体图层号。

## 6. DATA 段

各载荷按 INDX 中出现的顺序首尾相接，**不填充**。载荷若 `flags` bit0 置位则为
**raw DEFLATE**（RFC 1951，无 zlib 头）。

每个资产**独立压缩**，因此读取一个资产只需解压该资产，无需触碰其余数据。

## 7. 完整性

三层校验，逐层收紧：

| 层 | 覆盖范围 | 能发现 |
|---|---|---|
| `headerCrc` | 文件头 24 字节 | 头字段被篡改 |
| `fileSize` | 全文件长度 | 截断或追加 |
| `rawCrc32`（逐资产） | 解压后的字节 | 载荷损坏、解压错误、索引错位 |

`rawLen` 与解压结果长度不符时报 `length-mismatch`；CRC 不符报 `crc-mismatch`。
**两者都不返回数据。**

## 8. 错误码

读取端返回带 `code` 的 `ArpkError`，每条失败路径都有名字：

| code | 触发条件 |
|---|---|
| `truncated` | 文件短于 32 字节，或段表/段体越界 |
| `bad-magic` | 魔数不是 `ARP1` |
| `unsupported-version` | `version != 1` |
| `bad-header-size` | `headerSize != 32` |
| `header-crc` | 头部校验和不符 |
| `size-mismatch` | 头中 `fileSize` 与实际不符 |
| `section-range` | 段的 offset/size 落在文件之外 |
| `duplicate-section` | 同一必需段出现两次 |
| `missing-section` | 缺 `META`/`INDX`/`DATA` |
| `dir-truncated` | 索引记录被截断 |
| `duplicate-name` | 同名资产出现两次 |
| `data-range` | 索引指向 DATA 段之外 |
| `decompress-failed` | DEFLATE 流损坏 |
| `length-mismatch` | 解压长度与 `rawLen` 不符 |
| `crc-mismatch` | 载荷校验和不符 |
| `not-found` | 资产不存在 |
| `bad-meta` | META 记录格式错误 |
| `bad-name` | 名称为空或过长 |

## 9. 实现位置

| 文件 | 作用 |
|---|---|
| `src/assets/arpk.mjs` | **唯一实现**。浏览器读取端与 Node 打包工具共用此文件 |
| `src/assets/arpk.d.mts` | 其 TypeScript 声明 |
| `tools/test-container.mjs` | 单元测试，含 12 条损坏输入路径 |
| `tools/pack-resources.mjs` | 打包 CLI |

把编解码器写成单个 `.mjs` 由两端共用，是为了**避免两份实现漂移** —— 格式一旦有两份
代码，迟早会在边界情况上产生分歧。

## 10. 一个真实教训

初版把名称索引段命名为 `'DIR'`（3 字节），而段 id 规定为 4 字节 ASCII —— 打包时
立即抛错。**规格与实现不一致要在第一处断言上就暴露**，所以 `buildContainer` 里对段 id
长度做了硬校验，而不是静默补齐。

同样地，`cmap` 表的 format 4 头部漏写 `rangeShift` 字段曾导致整个字体被浏览器拒绝
（详见 `docs/design-notes.md`）。**结构体的字段个数必须逐个对照规格书写。**
