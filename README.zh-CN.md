# PDF Looker Pro

**从零实现的桌面 PDF 阅读器：连续滚动、真正的批注、测量工具，以及一个可以自己定义的工具栏。**

简体中文 · [English](README.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#下载)
[![Electron](https://img.shields.io/badge/Electron-44-47848f.svg)](https://www.electronjs.org/)
[![pdf.js](https://img.shields.io/badge/pdf.js-5.7-orange.svg)](https://mozilla.github.io/pdf.js/)

![PDF Looker Pro](docs/screenshots/main.png)

---

## 这是什么

PDF Looker Pro 是一个界面完全自研的桌面 PDF 阅读器。渲染使用
[pdf.js](https://mozilla.github.io/pdf.js/)，外壳使用 [Electron](https://www.electronjs.org/)——
两者都是宽松许可的第三方库；而这之外的所有部分都是本项目自己的代码：视图层、批注引擎、
图标集、内置字体，以及把它们打包起来的资源容器格式。

它起初是一次逆向重建练习，后来长成了一个真正适合读论文和做标注的工具。

## 功能

### 阅读

- **连续滚动、单页、双页对开、全屏**四种视图模式
- **页面虚拟化**——只渲染视口附近的页面，200 页文档和 2 页文档打开速度相当
- **文本层**，可选中、可复制
- **查找**（`Ctrl+F`）并高亮命中项
- **缩放**：适应宽度、适应页面、自由缩放、`Ctrl` + 滚轮
- **旋转**，每次 90°
- **大纲、缩略图、批注列表**，侧栏可折叠
- **四套主题**：浅色、深色、护眼、高对比
- **中文与英文**，运行时可切换
- **多文档标签页**，各自保留滚动位置与缩放

### 批注

- **十种批注**：高亮、下划线、删除线、自由墨迹、便签、矩形、椭圆、箭头、文本框、标注气泡
- **不用切回选取工具**——任何工具下点击已有批注都会选中它，创建完自动回到选取态
- **拖动即可移动**，选中时有明显轮廓与右下角把手
- **就地编辑文字**——双击文本框直接打字，中间没有弹窗
- **框会适应文字**：点击生成的框收缩到文字包络；手动拖出大小的框保持你给的尺寸
- **颜色、线型、线宽、字号**可调，作用于选中的批注或下一个新建的批注
- **样式预设**：把当前组合命名保存，随时套用

### 测量

- **距离、周长、面积**，结果直接标在页面上
- 毫米、厘米、英寸、点
- 支持页面 `/UserUnit`，大幅面图纸也能量准

### 其他

- **工具栏可定制**——在「更多」菜单里勾选，命令就出现在主工具栏上
- **导出**：当前页为图像，批注为 JSON 或 `.arpk`
- **原生菜单、最近文件、窗口位置**，重启后恢复

## 下载

到 [最新 Release](https://github.com/dongfangxy/pdf-looker-pro/releases/latest) 下载
`PDFLookerPro-portable.exe`。绿色版，无需安装，双击即用。

> ### 关于体积
>
> 便携版大约 **108 MB**。这几乎全是 Electron 运行时，而不是本项目——应用自身的代码和资源
> 加起来远不到 1 MB。
>
> 这是第一个版本，**压缩体积是后续路线上的首要事项**。具体机会写在
> [1.0.0 发布说明](docs/RELEASE-1.0.0.md) 里；简要说，更轻的打包方式和裁剪过的运行时应能在
> 后续版本里显著降低这个数字。

## 开始使用

### 环境要求

- **Node.js 24+**
- 打包需要 **Windows**（应用本身是跨平台的 Electron 代码）

### 从源码运行

```bash
git clone https://github.com/dongfangxy/pdf-looker-pro.git
cd pdf-looker-pro
npm install
npm run fixtures     # 生成测试套件用的 PDF
npm run dev          # 渲染进程的 Vite 开发服务器
npm run desktop      # 带 Electron 外壳启动
```

### 构建

```bash
npm run build        # 类型检查并打包渲染进程到 dist/
npm run pack         # 产出 release/PDFLookerPro-portable.exe
```

## 验证

本项目的每一项功能都是通过**真正运行应用**来验证的，而不是对着 mock 断言。测试套件会驱动
无头浏览器和打包后的 Electron 产物：

```bash
npm test             # 全部浏览器端套件
npm run test:desktop # 打包产物
```

| 套件 | 覆盖范围 |
| --- | --- |
| `test-container` | `.arpk` 资源容器 |
| `test-font` | 内置字体 |
| `e2e` | 渲染、缩放、旋转、文本层 |
| `e2e-i18n` | 语言包与回退 |
| `e2e-resources` | 打包的图标与字体 |
| `e2e-p5` | 批注 |
| `e2e-settings` | 设置、主题、滚轮缩放 |
| `e2e-ux` | 工具栏、选中、就地编辑 |
| `e2e-tabs` | 多文档标签页 |
| `e2e-styles` | 样式预设 |
| `e2e-electron` | 打包后的桌面外壳 |
| `e2e-desktop` | 原生菜单、最近文件、窗口状态 |

**352 项断言，0 失败。**

## 目录结构

```
src/
  annotations/   批注模型、图层、边车文件、样式预设
  i18n/          语言包与命令描述表
  platform/      Electron 桥接
  resources/     .arpk 容器读取
  sidebar/       大纲、缩略图、批注列表
  tabs/          文档会话与标签栏
  tools/         工具状态、测量几何与单位换算
  ui/            对话框
  viewer/        渲染、虚拟化、缩放、文本层
electron/        主进程与 preload 桥
tools/           构建脚本与验证套件
docs/            格式文档与设计笔记
```

## 文档

- [`docs/format-arpk.md`](docs/format-arpk.md) — `.arpk` 资源容器格式
- [`docs/design-notes.md`](docs/design-notes.md) — 设计取舍、踩过的坑、bug 是怎么被找出来的
- [`docs/RELEASE-1.0.0.md`](docs/RELEASE-1.0.0.md) — 1.0.0 发布说明，含体积问题的讨论

## 已知限制

如实列出，因为一个隐瞒短板的阅读器很难让人信任：

- **批注不会写回 PDF 文件。** 本项目没有 PDF 写入器。批注保存在文档旁边的 `.arpk` 边车文件里，
  这意味着其他阅读器看不到它们。
- **只有 Windows 便携版。** 没有安装程序，产物未做代码签名。
- **测量只覆盖两点距离与矩形周长/面积。** 不规则多段折线测量尚未实现。
- **不支持表单、数字签名、OCR。**
- 内置字体只保证覆盖它包含的拉丁与中日韩范围，且没有 hinting 与 kerning。

## 参与贡献

欢迎提 Issue 和 Pull Request——见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请先跑通验证套件。

## 许可

[MIT](LICENSE) © Paolu

第三方组件遵循各自的许可：[pdf.js](https://mozilla.github.io/pdf.js/)（Apache-2.0）、
[Electron](https://www.electronjs.org/)（MIT）、[Vite](https://vite.dev/)（MIT）、
[TypeScript](https://www.typescriptlang.org/)（Apache-2.0）。
项目不包含任何第三方美术素材、字体或界面文案——图标与内置字体均为本项目自制。

## 联系

**Paolu** — dongfangxy@163.com · [github.com/dongfangxy](https://github.com/dongfangxy)
