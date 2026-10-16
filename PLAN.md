# 自有 PDF 阅读器 —— 项目计划

工作区：`D:\CodeX\REA\reconstruction\pdfreader`

---

## 0. 硬约束（先写在最前面）

| 约束 | 说明 |
|---|---|
| **只用自研代码 + 宽松许可组件** | 允许：MIT / Apache-2.0 / BSD。**禁止** GPL / AGPL（会传染）|
| **不使用被逆向目标的任何产出** | 不用 PDF-XChange Viewer 的素材、文案、图标、反编译产物 |
| **借鉴的是设计，不是代码** | 交互模型、分层结构、字段设计可以学；具体实现全部自己写 |
| **每阶段必须实际构建并运行验证** | 不接受"写完了但没跑过" |

---

## 1. 技术选型（含许可理由）

| 层 | 选择 | 许可 | 为什么 |
|---|---|---|---|
| PDF 引擎 | **pdf.js** (`pdfjs-dist`) | Apache-2.0 | 纯 JS、无原生依赖、许可可商用闭源分发 |
| 构建 | **Vite** | MIT | 快，原生 ESM，TS 开箱即用 |
| 语言 | **TypeScript** | Apache-2.0 | — |
| 桌面封装 | **Electron**（P2 之后引入） | MIT | 环境已有 Node/npm，无需 Rust 工具链 |
| 测试夹具 | **自造 PDF** | — | 不用任何第三方 PDF 作为仓库内夹具 |

### 被排除的选项（及原因）

| 选项 | 排除原因 |
|---|---|
| MuPDF | AGPL-3.0，闭源分发需买商业许可 |
| Poppler | GPL-2/3，传染 |
| PDFium | BSD 许可没问题，但需要 C++ 原生绑定 + 编译工具链；本机无 cargo/VS 构建环境。**若日后要极致性能/印刷级渲染，可再评估** |
| Tauri | 需要 Rust 工具链，本机未安装 |

---

## 2. 从逆向得到的 8 条设计输入

这是这份计划和"随便找个教程做阅读器"的区别——每条都来自实测发现。

| # | 逆向发现 | 对本项目的设计输入 |
|---|---|---|
| 1 | 过滤器全集：`Flate` `LZW` `ASCIIHex` `ASCII85` `RunLength` `CCITT` `JBIG2` `JPX` `DCT` + `Crypt` | **功能需求清单**。pdf.js 已覆盖大部分，但要知道边界在哪 |
| 2 | 该实现额外接受规范外缩写别名 `AHx` `A85` `LZW` `Fl` `RL` `CCF` `DCT` | **兼容性加成**。真实世界的 PDF 可能带这些别名，我们的容错层要认 |
| 3 | 过滤器分派：首字母 → 字节索引表 → 跳转表 → strcmp | 小规模注册表（<20 项）的成熟做法，我们照此实现解码器注册表 |
| 4 | 命令表记录：定长 84 字节，**命令 ID → 4 个字符串槽**（title/tooltip/status/short） | **P3 多语言 UI 的核心设计**：一个命令的四种呈现形式，相同串可共用槽位 |
| 5 | 语言包三段式：`commands`(2938) / `dialogs`(136 + 1147 控件) / `strings` | **P3 的分层结构**。对话框用 `id` + 子 `item id` 索引控件，与资源 ID 解耦 |
| 6 | 资源容器 FRVD：分层（头部/目录/名称索引/条目表/分组）+ 逐条 zlib + 名称 1-based 索引 | **P4 自有资源容器的结构参考**（格式与实现全自研，不复制其格式）|
| 7 | 架构清单：自研引擎 + SpiderMonkey(JS) + Tesseract(OCR) + XMP + LibTomCrypt + 完整色彩管理 + 完整图像解码栈 | **长期功能地图**，决定 P5+ 的取舍顺序 |
| 8 | 7 条逆向方法论（等宽对照带、反编译与文件互验等） | 用于本项目的**测试与验证策略** |

---

## 3. 阶段计划

### P0 — 最小可运行骨架 ✅ **已完成并验证**

**交付物**
- Vite + TS 工程，`npm run build` 通过
- 能打开一个 PDF 文件，在连续滚动容器里渲染全部页面
- 上一页 / 下一页 / 跳页 / 缩放（适应宽度、适应页面、百分比）/ 旋转
- 自造测试 PDF 夹具（24 页，`tools/make-fixture.mjs`）

**验收结果（全部通过）**

| 验收标准 | 结果 |
|---|---|
| `npm run build` 退出码 0，产出 `dist/` | ✅ exit 0，4.91 MB / 205 文件 |
| 无头浏览器打开后截图能看到渲染出的页面内容 | ✅ 见 `docs/p0-screenshot.png` |
| `id / 总页数`、缩放百分比、标题正确 | ✅ 标题 `Test Fixture - 24 pages`、`24 页` |
| 翻页可用 | ✅ 工具栏显示 `2 / 24`（截图 `p0-screenshot-page2-rotated.png`）|
| 旋转可用且 fit 重算正确 | ✅ 旋转 90° 后缩放 231% → 163% |
| 控制台 / 页面错误 | ✅ 均为 0 条 |
| 24 页文档滚动到底不崩 | ✅ 未出现异常 |

**运行方式**
```powershell
cd D:\CodeX\REA\reconstruction\pdfreader
npm run dev          # 开发，http://127.0.0.1:5173/
npm run build        # 构建
npm run preview      # 预览构建产物，http://127.0.0.1:4173/
```

---

### P1 — 阅读核心 ✅ **已完成并验证**

**交付物**
- **页面虚拟化**：视口 ±1.5 屏内才光栅化，其余保留尺寸正确的占位符
- **文本层**：`pdf.js TextLayer` + 自实现的定位契约 CSS，文字可选中可复制
- **大纲侧栏**：两级树、折叠展开、目标解析为页码、无目标条目禁用
- **缩略图侧栏**：按需生成、当前页高亮并自动滚入视野
- **进度记忆**：按内容指纹（非文件名）分文档存储页码/缩放/旋转

**验收结果（全部通过，均以无头 Edge 实测）**

| 验收标准 | 结果 |
|---|---|
| 页面虚拟化：24 页只光栅化视口附近 | ✅ DOM 实测：页 1–2 `canvas 540×764`，页 3–24 `width=0` + `class="unrendered"` |
| 200 页文档可打开并跳到末页 | ✅ `200 / 200`，渲染出 "Page 200"，**零控制台/页面错误** |
| 文本层与字形对齐 | ✅ `--scale-x` = 0.99988 / 1.00003 / 1.00041，宽度误差 < 0.05% |
| 大纲两级树 + 页码解析 | ✅ `Chapter 1→第1页`、`Section 1.1→第2页`、`Chapter 2→第10页`、`Chapter 3→第20页` |
| 大纲反例（无目标） | ✅ `disabled` + `title="此条目没有可跳转的目标"`，截图呈灰色 |
| 缩略图 | ✅ 24 个 `.thumb.rendered`，canvas 132×186，当前页带 `.current` |
| 进度保存 + 恢复 | ✅ 跳至第 5 页 → 重载 → 工具栏 `5 / 24`、正文 "Page 5"、状态栏 "已恢复上次阅读位置" |
| 多文档独立存储 | ✅ 两个文档产生不同哈希条目 |

**运行方式**
```powershell
cd D:\CodeX\REA\reconstruction\pdfreader
npm run dev          # 开发，http://127.0.0.1:5173/
npm run build        # 构建
npm run preview      # 预览构建产物，http://127.0.0.1:4173/
node tools/make-fixture.mjs 24 public/fixtures/test.pdf --outline   # 带大纲的夹具
node tools/make-fixture.mjs 200 public/fixtures/large.pdf           # 大文档夹具
```

---

### P2 — 交互层 ✅ **已完成并验证**

**交付物**
- **四种工具模式**：手形（拖拽平移）/ 选择（文字选取）/ 放大镜（点击缩放，Alt+点击缩小）/ 快照（框选导出 PNG）
- **查找**：全文索引、逐页高亮、上一个/下一个、区分大小写、全词匹配、命中计数
- **快照导出**：按页面 2× 超采样重渲染后裁剪，导出真实 PNG
- **快捷键**：Ctrl+F 查找、F3/Shift+F3 上下条、Ctrl+±/Ctrl+0 缩放、Home/End、H/V/Z/S 切工具
- **Electron 外壳**：自定义 `app://` 协议提供 `dist`，可打包为免安装 exe
- **E2E 验证框架**：Playwright 驱动真实鼠标拖拽（click-only 工具做不到）

**验收结果（全部通过）**

| 验收标准 | 结果 |
|---|---|
| 浏览器 E2E（含真实拖拽） | ✅ **45 通过 / 0 失败** |
| Electron 源码运行 | ✅ **16 通过 / 0 失败** |
| Electron 打包产物运行 | ✅ **16 通过 / 0 失败**（走 asar）|
| portable exe 启动 | ✅ 4 个进程，主进程 147 MB |
| 查找：24 处命中 + 高亮 | ✅ 高亮 70 ms 内绘制，`position=static`（在流内） |
| 手形平移 | ✅ 拖动 `scrollTop 0 → 280` |
| 放大镜 | ✅ 点击 `161%→202%`，Alt+点击 `202%→161%` |
| 快照 | ✅ 选框出现 → 下载有效 PNG `714×252` |
| `app://` 下 worker 可用 | ✅ origin = `app://bundle`（非 null），页面正常光栅化 |
| 控制台 / 页面错误 | ✅ 全部为 0 |

**打包产物**
```
release\PDFReader-portable.exe   108.1 MB   免安装
release\win-unpacked\            443 MB     解包目录（app.asar 38.6 MB）
```

**运行方式**
```powershell
npm run dev        # 浏览器开发
npm run e2e        # 浏览器端 E2E（需 npm run preview 在跑）
npm run electron   # Electron 源码运行
node tools/e2e-electron.mjs                                  # 验证源码运行
node tools/e2e-electron.mjs "--exe=release\win-unpacked\PDF Reader.exe"  # 验证打包产物
npm run package    # 打包为免安装 exe
```

> **注意**：若环境里存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成纯 Node 运行
> （`require('electron')` 拿不到内置 API）。E2E 脚本会自动清除该变量；手工运行前请先
> `Remove-Item Env:\ELECTRON_RUN_AS_NODE`。

---

### P3 — 三段式多语言 UI ✅ **已完成并验证**

**设计来源**：`commands` / `dialogs` / `strings` 三段分层，以及命令记录的
四槽 `title` / `tooltip` / `status` / `short`，是逆向阶段发现的**结构设计**。
类型定义、加载器、校验器与全部语言内容均为本项目自研，与被分析产品无任何
代码或文案往来（见 `docs/design-notes.md` 的许可登记）。

**为什么值得单独做一阶段**：这是逆向里最有复用价值的设计——**用命令 ID 而非界面位置做索引**，
让 UI 文字完全外置、可增删语言、且与代码解耦。

**交付物**
- **`commands` 段**：数字命令 ID（23 条）→ 四槽记录
  - `short` → 按钮文字　`tooltip` → 悬停 title 属性
  - `status` → 悬停/聚焦时写入状态栏　`title` → 有空间处（如查找框占位符）
- **`dialogs` 段**：对话框标题 + 控件按 **(对话框 id, 控件 id)** 二元寻址，与布局解耦；
  约定 `id=1` 为确认控件（与平台 IDOK 惯例一致）
- **`strings` 段**：占位符、空状态、瞬时提示（28 项）
- **回退链**：当前语言 → 默认语言 → 调用方兜底；**整条命令 / 单槽 / 单键三个粒度都回退**
- **运行时切换**：不重载页面即可整体换语言，`<html lang>` 同步
- **校验器**：语言包视为不可信输入，逐字段给路径报错，而非首错即抛

**验收结果（47 通过 / 0 失败）**

| 验收标准 | 结果 |
|---|---|
| 三段式结构完整 | ✅ zh-CN `commands=23 dialogs=1 strings=28`；en 缺失 **0** 项 |
| 四槽各有用途且可观测 | ✅ `short`→按钮文字、`tooltip`→title 属性、`status`→悬停进状态栏 |
| 运行时切换不重载 | ✅ 导航令牌存活，按钮 `打开`→`Open`，占位符 `Find…` |
| 整条命令缺失回退 | ✅ 注入包缺 `Rotate` → 全部槽回退，界面照常显示 |
| 单槽缺失逐槽回退 | ✅ title/short 取自注入包，tooltip/status 取自默认语言 |
| strings 缺键回退 | ✅ 缺键回退到默认语言值 |
| dialogs 段驱动对话框 | ✅ 标题与 item 2/3 取自语言包，确认键取 item 1 及其 tooltip |
| 校验器拒绝非法包 | ✅ 9 个反例：非对象/缺段/非法 meta/非数字 id/缺 title/id 重复/非字符串/未知段 |

**验证方式上的一个决定（值得记下）**：回退机制**不靠发布残缺语言**来验证。
`en` 包是完整的——发布出去的语言不该带用户能看见的缺口。回退改由测试
**运行时注入一个残缺包**来验证，两者都覆盖到，产品也不留残缺。
先前版本曾让 `en` 故意缺 4 项，截图显示英文界面里残留一个中文按钮，
那是真实产品缺陷，已修正。

**运行方式**
```powershell
node tools/e2e-i18n.mjs    # 需 npm run preview 在跑
```
调试接缝：`?debug=i18n` 在 `window` 上暴露 `__i18n` / `__validatePack` / `__cmd`，
供验证脚本断言回退解析与校验行为（仅在该参数下挂载）。

（截图：`docs/p3-i18n-en.png`）

---

### P4 — 自有资源容器 ✅ **已完成并验证**

**设计来源**：借鉴 REA 逆向阶段发现的**分层**与**名称索引**两个思路。
**格式规范、字段布局、编码方式、每一行实现与全部资源内容均为本项目自研**
（见 `docs/format-arpk.md` 开头的来源声明）。

**交付物**

| 件 | 说明 |
|---|---|
| `docs/format-arpk.md` | 完整格式规范：布局、字段表、错误码、校验层次 |
| `src/assets/arpk.mjs` | **唯一实现**，浏览器读取端与 Node 打包工具共用（避免两份实现漂移） |
| `src/assets/arpk.d.mts` | TypeScript 声明 |
| `src/assets/registry.ts` | 应用侧加载：注册字体、生成图标 URL |
| `tools/make-font.mjs` | **自研 TrueType 生成器**：笔画定义 → 轮廓展开 → 10 张表 |
| `tools/pack-resources.mjs` | 打包 CLI（含图标自研 SVG 与回读自检） |
| `tools/test-container.mjs` | 单元测试，含 12 条损坏输入路径 |
| `tools/validate-font.mjs` | TTF 结构校验器（逐表对规格核长、校验和、cmap、loca/glyf 走查） |

**容器格式要点**
- 32 字节头 + 段表 + 三段：`META`（名称/值）/ `INDX`（名称索引）/ `DATA`（载荷）
- 名称索引每项含 **FNV-1a 32 哈希 + 完整名称**（哈希可能碰撞，必须再比名称）
- 每资产**独立 raw DEFLATE**，读一个资产不必触碰其余
- 三层完整性：头部 CRC → 全文件长度 → 逐资产原始字节 CRC
- **未知段保留不解析**，后续版本可增量扩展

**自研字体**
- 许可约束下不能用任何第三方字体（Liberation 是 OFL，不在 Apache/BSD/MIT 白名单）
- 实现方式：字形用**笔画**（折线 + 圆弧）定义，展开为「每段一个矩形 + 每关节一个圆盘」
  的轮廓；TrueType 非零环绕规则让重叠轮廓自然取并集，**无需布尔几何**
- 覆盖 **ASCII 可打印字符集（101 码位）**，10 张表，unitsPerEm 1000
- 158,908 字节，deflate 后 13,341 字节

**验收结果**

| 验收标准 | 结果 |
|---|---|
| 容器编解码单元测试（含损坏输入） | ✅ **38 通过 / 0 失败**，12 条损坏路径全有具名错误码 |
| 字体结构校验 | ✅ 10 张表全部对规格核长、校验和、cmap、loca/glyf 走查通过 |
| 字体浏览器渲染 | ✅ **11 通过 / 0 失败**，`FontFace.status = 'loaded'` |
| 应用层资源验证 | ✅ **28 通过 / 0 失败** |
| **干净环境：无外部文件** | ✅ 请求追踪证明**没有单独请求任何 `.ttf`/`.svg`**，全部来自容器 |
| 打包产物 | ✅ Electron 打包后 **24 通过 / 0 失败**，容器从 asar 内经 `app://` 提供 |
| 压缩效果 | ✅ 158 KB 字体 + 7 图标 → **15,401 字节容器（节省 90.5%）** |

**运行方式**
```powershell
npm run font        # 生成自研字体
npm run font:check  # 结构校验 + 浏览器渲染验证
npm run resources   # 打包成 public/assets/ui.arpk
npm run assets      # font + resources
npm run test:container
npm run e2e:all     # 全部浏览器端验证
```

（截图：`docs/p4-font-sample.png`、`docs/p4-resources.png`）

---

### P5 — 桌面软件化 + 批注 ✅ **已完成并验证**

**A. 独立桌面软件（不再需要浏览器）**

| 交付 | 说明 |
|---|---|
| 原生菜单栏 | 由**命令 ID 表**驱动，17 个快捷键；**切换语言时菜单栏同步重贴标签** |
| 自研应用图标 | `tools/make-icon.mjs` 用自研 SVG 在浏览器里栅格化 7 个尺寸，自行拼装 `.ico` |
| 原生文件对话框 | 打开/保存走 `dialog.showOpenDialog` / `showSaveDialog`，渲染进程拿不到 fs |
| 窗口几何记忆 | 尺寸/位置/最大化写入 `userData/settings.json`，恢复前校验目标仍在已连接显示器上 |
| 单实例 + 文件关联 | 第二次启动聚焦已有窗口并转发文件；`fileAssociations` 注册 `.pdf` |
| 「用...打开」/ 命令行 | 主进程解析 argv 与 `open-file`，渲染端就绪后**主动取**待打开文件 |
| 关闭握手 | 有未保存批注时先询问渲染进程再关窗 |
| 安全边界 | contextIsolation 开、nodeIntegration 关；**只有用户选过的路径可读写**（选 PDF 时同时授权同名 `.arpk` 边车） |

**B. P5 批注**

- **六种批注**：高亮 / 下划线 / 删除线 / 自由墨迹 / 便签 / 矩形框，含颜色选择
- **存储坐标系**：批注一律存在**未旋转的页面空间（scale 1）**，屏幕坐标是导出结果、不是存储内容 —— 所以缩放和旋转都不需要重画
- **批注侧栏**：按页分组、点击跳转、单条删除、数量摘要
- **持久化**：复用 P4 的 **ARPK 容器**做边车（`<文件>.pdf.arpk`），不是第二套格式
- **单一变更入口**：所有增删改（手势 / 面板 / 菜单 / 边车加载）都汇入一处 `onChange`，覆盖层、面板、标题不可能互相不一致

**已知边界（如实标注）**：批注**不写回 PDF**。编辑 PDF 需要 PDF 写入器，本项目没有；声称"保存进文档"会是假话。边车是明确的替代方案。

**验收结果**

| 验收标准 | 结果 |
|---|---|
| 浏览器端 P5 | ✅ **41 通过 / 0 失败**（含真实拖拽建批注、缩放任随之放大、ARPK 边车往返） |
| 桌面外壳 | ✅ **13 通过 / 0 失败**（源码与打包产物各一次） |
| 菜单由命令表驱动 | ✅ 6 个顶级菜单 / 17 个快捷键 / 批注菜单 6 项，切语言后 `File, View, Tools, Annotate, Help` |
| 图标嵌入 exe | ✅ 提取到 32×32 关联图标 |
| 窗口几何记忆 | ✅ 重启后恢复到 1024×700 附近 |
| 文件关联路径 | ✅ `electron . <file.pdf>` 直接打开该文档 |

### P5+ — 按需（不做承诺）

注释回复 · 表单（需 JS 引擎）· 数字签名 · OCR · 色彩管理 · 印刷级输出

### 验证总量

| 套件 | 断言 |
|---|---:|
| 容器编解码 + 损坏输入 | 38 |
| 自研字体 | 11 |
| 浏览器 P0–P2 | 45 |
| 三段式多语言 P3 | 47 |
| 资源容器 P4 | 28 |
| 批注 P5 | 41 |
| Electron 外壳 | 24 |
| 桌面特性 | 13 |
| **合计** | **247，0 失败** |

注释 · 表单（需要 JS 引擎，对应逆向发现的 SpiderMonkey）· 数字签名 · OCR（对应 Tesseract）·
色彩管理（对应 557 KB CMYK ICC）· 印刷级输出

---

## 4. 明确不做的事

| 不做 | 原因 |
|---|---|
| 自研 PDF 解析/渲染引擎 | 几年工作量，且 pdf.js 已 Apache-2.0 |
| 抄 PDF-XChange 的界面布局/图标/文案 | 侵权 |
| 逆向它来"补全"引擎细节 | 我们用 pdf.js，不需要；且已有产出足够做需求清单 |
| 支持 DRM/加密破解 | 超出范围 |

---

## 5. 目录结构

```
pdfreader/
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ index.html
├─ public/
│   └─ fixtures/test.pdf          自造测试夹具
├─ src/
│   ├─ main.ts                    入口
│   ├─ viewer/
│   │   ├─ pdf-document.ts        文档加载与生命周期
│   │   ├─ page-renderer.ts       单页渲染（含缩放/旋转）
│   │   └─ layout.ts              连续滚动与虚拟化（P1）
│   ├─ tools/                     工具模式（P2）
│   ├─ i18n/                      三段式多语言（P3）
│   └─ styles/
└─ docs/
    └─ design-notes.md            设计决策记录（含逆向输入的引用）
```

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| pdfjs-dist 的 worker 在 Vite 下路径配置易错 | P0 就用 `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` 显式指定；构建后必须实际打开验证 |
| 大文档全量渲染导致内存爆掉 | 这是 P1 的核心任务；P0 先用"只渲染当前页"的简化策略保证不崩 |
| C 盘只剩 12.8 GB | npm 缓存已在 D 盘；Electron 装到项目本地而非全局 |
| 依赖许可被污染 | 每个依赖引入时记许可到 `docs/design-notes.md` |

---

## 7. 进度

| 阶段 | 状态 | 验证 |
|---|---|---|
| P0 最小骨架 | ✅ 完成 | 见 P0 段验收表 |
| P1 阅读核心 | ✅ 完成 | 浏览器 E2E |
| P2 交互层 + Electron | ✅ 完成 | 浏览器 45 + Electron 源码 16 + 打包 24 |
| P3 三段式多语言 | ✅ 完成 | i18n 专项 47 |
| P4 自有资源容器 | ✅ 完成 | 容器单元 38 + 字体 11 + 资源 28 + 打包 24 |
| P5+ | ⏳ 按需，不做承诺 | — |

**当前验证总量：193 项断言，0 失败**

| 套件 | 断言 |
|---|---:|
| `tools/test-container.mjs` — 容器编解码 + 损坏输入 | 38 |
| `tools/test-font.mjs` + `validate-font.mjs` — 自研字体 | 11 |
| `tools/e2e.mjs` — 浏览器（含真实鼠标拖拽） | 45 |
| `tools/e2e-i18n.mjs` — 三段式多语言 | 47 |
| `tools/e2e-resources.mjs` — 资源容器 | 28 |
| `tools/e2e-electron.mjs` — Electron 打包产物 | 24 |

**交付工件**
| 工件 | 位置 |
|---|---|
| 浏览器构建 | `dist/`（JS 472 kB / gzip 142 kB，worker 1,232 kB，CSS 10 kB） |
| 资源容器 | `dist/assets/ui.arpk`（15,401 字节） |
| 免安装桌面程序 | `release/PDFReader-portable.exe`（108 MB） |
| 自研源码 | 3,000+ 行 TS + 430+ 行 CSS + 100 行 Electron + 1,900+ 行工具脚本 |
| 格式文档 | `docs/format-arpk.md` |
