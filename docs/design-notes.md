# 设计笔记

## 许可登记（每引入一个依赖就记一条）

| 依赖 | 版本 | 许可 | 用途 | 可闭源分发 |
|---|---|---|---|---|
| pdfjs-dist | 5.7.284 | **Apache-2.0** | PDF 解析与渲染引擎 | ✅ |
| vite | 7.3.7 | MIT | 构建/开发服务器 | ✅ |
| typescript | 5.9.3 | Apache-2.0 | 语言 | ✅ |

**被排除**：MuPDF（AGPL-3.0，闭源需商业授权）、Poppler（GPL）、PDFium（BSD 但需 C++
工具链，本机无 cargo/MSVC 构建环境）、Tauri（需 Rust）。

---

## 随 pdf.js 一起分发的补充资产

放在 `public/` 下，由应用自身提供（都在 `node_modules/pdfjs-dist` 内，许可同 Apache-2.0）：

| 目录 | 文件数 | 大小 | 作用 |
|---|---:|---:|---|
| `cmaps/` | 169 | 1.1 MB | CJK 字符映射表 |
| `standard_fonts/` | 16 | 762 KB | 未内嵌基础字体 |
| `wasm/` | 13 | 1.4 MB | WASM 编解码器（JPEG 2000 / JBIG2）|
| `iccs/` | 2 | 15 KB | ICC 色彩配置 |

**配置要点**：不设这些路径时，中文 PDF 与部分扫描件会渲染错误。已在
`src/viewer/pdf-document.ts` 的 `ASSET_PARAMS` 中统一配置。

---

## 来自 REA 逆向 PDF-XChange Viewer 的设计输入

以下是从逆向规格（`D:\CodeX\REA\evidence\PDFXCview\`）提炼的**设计参考**，
本项目只借鉴结构与思路，**代码与资源全部自研**。

| 逆向发现 | 本项目对应 | 落在哪 |
|---|---|---|
| 九种 PDF 过滤器：`Flate` `LZW` `ASCIIHex` `ASCII85` `RunLength` `CCITT` `JBIG2` `JPX` `DCT` + `Crypt` | 功能需求清单；pdf.js 已覆盖，`cmaps/`/`wasm/`/`image_decoders` 与这些过滤器一一对应 | 本文件 |
| 额外接受规范外缩写别名 `AHx` `A85` `LZW` `Fl` `RL` `CCF` `DCT` | 兼容性检查待办（见下方"待验证"）| — |
| 命令表记录：定长 84 字节，**命令 ID → 4 个字符串槽**（title/tooltip/status/short）| **P3** 多语言 UI 的核心数据结构 | 待实现 |
| 语言包三段式：`commands` / `dialogs`(+ 控件 `item id`) / `strings` | **P3** 的分层结构 | 待实现 |
| 资源容器 FRVD：分层 + 名称索引 + 逐条 zlib + 1-based 名称索引 | **P4** 自有资源容器的结构参考（格式全自研）| 待实现 |
| 架构清单：自研引擎 + SpiderMonkey + Tesseract + XMP + LibTomCrypt + 完整色彩管理 | 长期功能地图（P5+ 取舍依据）| PLAN.md |
| 方法论：落点统计必须用等宽对照带；反编译给算法、文件给字段偏移 | 本项目的测试与验证策略 | 本文件 |

**明确不使用**：目标程序的任何素材（字体/ICC/图章 PDF/logo）、界面文案、反编译产物。

---

## 实施中踩到的坑（已验证的结论）

### 1. pdf.js v5 的 `render()` 参数变了

`RenderParameters.canvas` 是**必填**，`canvasContext` 已降级为兼容选项。
传 `canvasContext` 而不传 `canvas` 会直接类型错误。

```ts
await page.render({ canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
```

### 2. `isEvalSupported` 已从 `DocumentInitParameters` 移除

v5 里没有这个字段，传了会类型报错。

### 3. `DocumentInitParameters` 没从主入口导出

`import * as pdfjsLib from 'pdfjs-dist'` 拿不到该类型。改用结构化推断
（一个 `const ASSET_PARAMS = {...}` 展开进参数），不要用 `as` 断言。

### 4. Vite 的 `localhost` 只绑到 IPv6 `::1`

Node 17+ 解析 `localhost` 优先 `::1`，导致 `127.0.0.1` 连不上——无头浏览器校验会
直接导航失败。已在 `vite.config.ts` 显式 `host: '127.0.0.1'`。

### 5. fit-width 必须在滚动条出现后重算

初次 `load()` 时纵向滚动条还没出现，`clientWidth` 偏大，算出的 fit-width 会让页面
略微超出视口。改用 `ResizeObserver` 观察滚动容器，并加 0.5% 阈值防止
"重算 → 滚动条变化 → 再重算"的反馈循环。

### 6. 旋转后 fit 要基于旋转后的尺寸

`displaySize()` 在 90°/270° 时交换宽高。实测：A4 未旋转 fit-width = 231%，
旋转 90° 后 = 163%（1388 / 842），符合预期。

---

### 7. pdf.js 的文字层需要四个 CSS 变量，且都不由库设置

`TextLayer` 只在容器上写 `--min-font-size`，然后调用
`setLayerDimensions(container, viewport)` —— 而后者**只读** `--total-scale-factor`
与 `--scale-round-x/y`，本身不设置它们。`--scale-factor` 在库产物里出现 **0 次**。

必须在祖先元素上照抄官方 `.pdfViewer .page` 的四条声明，缺一不可：

```css
--user-unit: 1;
--total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
--scale-round-x: 1px;
--scale-round-y: 1px;
```
并由渲染层在页面元素上写 `--scale-factor`。

漏掉 `--scale-round-x/y` 会让 `round(down, …, var(--scale-round-x))` 整条失效。

### 8. 调试时把 span 显色会看到"假错位"

文字层 span 用 `font-family: sans-serif`（系统字体），画布用 pdf.js 加载的字体。
**总宽度由 `--scale-x` 校正到一致（实测误差 < 0.05%），但字形内部分布不同。**
若为了调试给 span 上色（`?debug=text`），会看到重影，**这是调试样式的产物，正常模式下
span 是 `color: transparent`，用户看不到**。判断对齐要看 `--scale-x`，不要看调试截图。

### 9. 窄窗口下工具栏按钮会折行

按钮有固定 `height: 28px`，文字换行会被裁切。修法：`.btn { white-space: nowrap }` +
工具栏 `overflow-x: auto`，让控件横向滚动而不是压缩换行。

---

### 10. 高亮 span 必须带 `appended` 类

`.textLayer :is(span, br)` 把所有 span 设为 `position: absolute`。高亮是在 span 内部
插入 `<span>`，若不带 `appended` 就会脱离文档流，**后面的文字会错位**。
官方 CSS 里对应 `.appended:is(.textLayer .highlight) { position: initial; }`。
排查方法：断言 `getComputedStyle(highlight).position !== 'absolute'`。

### 11. 查找索引与文字层的逐项结构可以不相等

索引构建时丢掉了空串，而 `TextLayer.textContentItemsStr` 保留它们。第一版用"逐项比较"
做一致性校验，导致**搜索正常但高亮全被跳过**。正确做法是只比较**拼接后的字符串**——
因为偏移量在绘制时是通过 `locate(实时的 items, 偏移)` 映射的，索引的逐项结构并不参与。

### 12. Electron 在 `file://` 下无法启动 pdf.js worker

Chromium 拒绝从 `file://` 脚本构造 Worker（页面 origin 为 `null`）。解法是注册一个
**特权标准协议**并用 `protocol.handle` 提供 `dist`：

```js
protocol.registerSchemesAsPrivileged([{ scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// 之后 win.loadURL('app://bundle/index.html')
```
这样 origin 变成 `app://bundle`（非 null），worker 正常。已验证。

### 13. `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化成纯 Node

本环境（DSH 宿主）注入了该变量。症状：`electron.exe --version` 打印的是**内嵌 Node 版本**
（v24.22.0）而非 Electron 版本（44.8.0）；主进程里 `require('electron')` 返回 npm 垫片，
`protocol` / `app` 全是 `undefined`，报 `Cannot read properties of undefined`。
**排查口诀：`--version` 版本号不对，就是它。** E2E 脚本会主动清除。

### 14. 拖拽类 E2E 的两个陷阱

1. 选区坐标若取自**已滚出视口**的页面，`y` 会是负数，鼠标事件落到工具栏而非文档。
   必须挑"视口内可见高度足够"的页面。
2. **fit-width 下 A4 页面高约 1359px，没有任何整页能装进 800px 视口**。
   拖拽测试应先用 fit-page。

这两条都是 `capture_browser_scenario`（只有 click/fill/press，没有拖拽）无法覆盖的，
所以本项目引入了 Playwright 做真实鼠标验证。

---

### 15. 语言包不要靠"故意留缺口"来验证回退

第一版让 `en` 包故意缺 4 项，好让回退被真实语言走到。截图立刻暴露问题：
**英文界面里残留一个中文按钮**。发布出去的语言包不该带用户能看见的缺口。

正确做法是两条腿分开：**发布的语言包保持完整**，回退机制改由测试
**运行时注入一个残缺包**来验证。现在 `en` 缺失 0 项，而回退链的三个粒度
（整条命令 / 单槽 / 单键）仍被 12 项断言覆盖。

### 16. 命令槽位的分工要能被观测

四槽只写在类型里没用，必须每一槽都有可验证的落点，否则它迟早退化成四个同义词：

| 槽 | 落点 | 验证方式 |
|---|---|---|
| `short` | 按钮文字 | 断言 `textContent === resolved.short` |
| `tooltip` | 元素的 `title` 属性 | 断言 `getAttribute('title') === resolved.tooltip` |
| `status` | 悬停/聚焦时写入状态栏 | `hover()` 后断言状态栏文本 |
| `title` | 有空间处（查找框占位符） | 断言 `placeholder === title + '…'` |

### 17. 工具层不应硬编码用户可见文案

`tool-manager.ts` 原先直接拼中文提示，切换语言时只能靠正则替换——既脆弱又把
本地化泄漏进逻辑层。改为注入一个 `ToolMessages` 接口（含
`snapshotExported(w,h)` / `snapshotFailed(reason)` 与三个原因串），
由 `main.ts` 从语言包构造。工具层现在**零用户可见文案**。

---

### 18. TrueType 的 `cmap` format 4 头部是**七个** uint16

漏写 `rangeShift` 会让整个子表错位 2 字节，且**声明的 `length` 比实际写出的多 2 字节**，
浏览器直接拒绝整个字体（`FontFace.status === 'error'`，无任何细节）。

**为什么校验器没抓到**：它拿声明的 `length` 与「由 segCount 反推的期望长度」相比 —— 两边
都用同一个错误的 segCount，恰好相等，于是检查通过而数据是错的。
**教训：自洽的期望值不等于正确的期望值**，字段个数必须逐个对照规格数。

### 19. 轮廓环绕方向必须一致

TrueType 用**非零环绕规则**填充。两个**反向**轮廓的重叠区环绕数为 0，会**被挖空**。

笔画字体里每个关节点画一个圆盘、每段画一个矩形：矩形（顺时针）与圆盘（逆时针）
方向相反，交叠处全成了洞 —— 渲染出来是横向条纹和"串珠"质感。

修法不是在生成处小心方向，而是在展开后**统一归一化**：

```js
const area = signedArea(contour);
return area > 0 ? contour.slice().reverse() : contour;
```

### 20. 表目录的 `length` 是真实长度，不含补齐

表数据要补齐到 4 字节倍数才能算校验和，但目录里的 `length` 必须写**未补齐**的长度。
`head` 是 54 字节，写 56 会被严格的校验器判错。

### 21. 其他几个一次就踩到的字段陷阱

| 项 | 正确 | 我写错的 |
|---|---|---|
| `OS/2` v4 `panose` | **10 字节** | 10 个 uint16（多 10 字节） |
| `OS/2` v4 总长 | **96 字节** | 134 |
| `maxp` v1.0 | **32 字节**（14 个 uint16） | 30 |
| `hhea` | **36 字节** | 34（数错了，实测才发现） |

**不要靠数代码里的调用行来确认长度** —— 写个断言把每张表的实际长度与规格值比一遍。

### 22. 不要用 PowerShell 做字节算术

`[byte]1 -shl 16` 会被**截断回 byte**，导致 `0x00010000` 读成 `0`；
`[uint32]` 转换对负的 int32 会抛异常，一次循环刷了几百行错误。
**二进制运算放在 Node 里做**（`tools/validate-font.mjs` 就是这么来的）。

### 23. TypeScript 5.7+ 的 TypedArray 按 buffer 类型参数化

`Uint8Array` 默认是 `Uint8Array<ArrayBufferLike>`，不能直接传给 `Blob` / `FontFace`。
声明文件里收窄为 `Uint8Array<ArrayBuffer>` 即可，不要在调用处强转。

---

## 待验证 / 已知不足

| 项 | 状态 |
|---|---|
| 规范外过滤器别名（`AHx`/`A85`/…）的容错 | 未实现——pdf.js 是否接受未验证 |
| **绝对内存占用数字** | 未测量。可用工具只能验证"只光栅化视口附近"这一比例，无法读出进程 RSS |
| 查找的变音符号/连字归一化 | 未实现（仅大小写折叠）。已如实标注，未声称支持 |
| 应用图标（exe 图标） | 打包仍用 Electron 默认图标。容器里已有自研 `app.svg`，但**尚未接到 electron-builder 的图标配置**（需要 .ico 转换） |
| 内置字体的字形质量 | 自研笔画字体，字形为几何风格。**已覆盖 ASCII 可打印字符集（101 码位）**，但无 hinting、无字距调整（kerning） |
| 语言包外部加载（从磁盘读 JSON） | 加载器与校验器已能接受任意对象，但**尚未接文件/网络来源**。容器已有 `locale` 图层的设计位，未使用 |
| 跨页拖选、签署、表单 | 属 P5+ |
