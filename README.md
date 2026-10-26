# dsh-molecule-visualization

[English](README.en.md) | 简体中文

> 本仓库基于 [PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer)（MIT 许可）改写，独立演进。
> 上游实现了 DSH 插槽接入、3Dmol.js 本地打包与基础查看器；在此基础上修掉了 6 个已复现的渲染问题，
> 并新增 XYZ / Gaussian 输入支持、球棍样式、卡片级错误原因与布局超时保护。
> 包名是 **`dsh-molecule-visualization`**（上游叫 `dsh-molecule-viewer`；工具名仍是 `view_molecule`）。
> **改动清单**见 [NOTICE.md](NOTICE.md)（逐项）与 [CHANGELOG.md](CHANGELOG.md)；上游版权声明与 MIT 许可完整保留，见 [LICENSE](LICENSE)。

DSH（DeepSeek Harness）分子可视化插件：传入分子文件路径或 PDB/SDF/MOL/MOL2/XYZ/GJF 格式数据，
在会话界面渲染**交互式 3D 分子查看器**（3Dmol.js，支持旋转/缩放/样式切换/着色）。

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/kanade-tachibana-methyl/dsh-molecule-visualization)
[![dsh.so install · dsh 0.2.1-rc.2](https://www.dsh.so/badge/install/dsh-molecule-visualization@0.2.1-rc.2.svg)](https://www.dsh.so/artifact/dsh-molecule-visualization/)

## 相对上游 0.2.0 修复的问题

| # | 问题 | 上游症状 | 本仓库的处理 |
|---|---|---|---|
| 1 | `mol` 格式被静默丢弃 | 工具声明支持 `mol`，但格式被原样传给 `addModel`。3Dmol.js 2.4.2 **没有** `mol` 解析器，会打印 `Unknown format: mol` 并按文本猜格式；真实 molfile 多数会被猜成 `xyz` → **解析出 0 个原子、外框正常、分子不显示、无报错**（实测 14 个真实 `.mol` 里 12 个渲染 0 原子） | 输入 `mol` 内部映射为 `sdf` 解析器；载荷里带 `renderFormat` 字段，客户端也会兜底映射（旧会话记录同样能修好） |
| 2 | 失败对用户不可见 | 解析失败/空模型只留下空白 canvas | 卡片上显示**具体原因 + 修复建议 + 重试按钮**：解析异常、0 原子、WebGL 不可用、容器不可见各有独立文案；渲染后还会核对「host 统计原子数 vs 3Dmol 实际载入数」 |
| 3 | 缺少球棍样式 | 只有 stick/line/sphere/cartoon | 新增 `ballstick`：`{ stick: { radius: 0.15 }, sphere: { scale: 0.25 } }` 两种表示叠加（3Dmol 没有原生球棍表示） |
| 4 | 无键模型什么都画不出来 | stick 靠键绘制；无键表（XYZ、空 bond 块）→ 空画面 | 载入后若键数为 0，先 `model.assignBonds()` 按距离推断；仍为 0 则降级为球状显示并在卡片上说明（不会空白） |
| 5 | 布局等待可能永久挂起 | `awaitLayoutBox()` 等待非零尺寸，祖先被折叠/隐藏时永不 resolve → 永远 "Loading 3D viewer…" | 加 10 秒超时，超时后显示「容器不可见」+ 原因（`display:none` / 0×0）+ 重试按钮 |
| 6 | 格式校验太松 | PDB 固定列错位仍被接受，3Dmol.js 静默丢原子（实测一份 Chem3D 导出的 PDB：host 数到 92 个原子，画面只有 1 个） | host 侧按 PDB 规范逐列校验（记录名 1-6、x 31-38、y 39-46、z 47-54、resName 18-20、第 30 列必须为空）；识别「整份文件统一 altLoc」这一列错位特征并**修复列 17**（修复会以警告写进卡片），也可用 `repairShiftedPdbAltLoc: false` 关闭改为直接报错 |

> 实测细节（含未复现项）见 [docs/verification.md](docs/verification.md)。简言之：问题 1、2、5、6 全部复现；
> 问题 3 是功能缺失（确认）；**问题 4 的描述与 2.4.2 的实际行为不符**——3Dmol.js 对无 CONECT 的 PDB
> 已按距离补键（1CRN 去掉 CONECT 仍有 334 根键）。因此本仓库仍做了「无键 → 推断 → 球状降级」的兜底，
> 但它是防御性的，而不是在修一个能复现的空白画面。

## 特性

- 🧬 **六种格式**：PDB、SDF、MOL、MOL2、XYZ，以及 Gaussian 输入（`.gjf` / `.com`，只取几何结构）
- 🧱 **PDB 列校验 + 自动修复**：错位/截断/非数字坐标直接给出「哪一行、哪一列」；整份文件统一的 altLoc 伪标记会被修复并提示
- 📁 **路径优先**：直接传文件路径，服务端读取——Windows（`D:\dir\x.pdb`）、WSL（`/mnt/d/dir/x.pdb`）与 `~/` 自动互转
- 🖱️ **交互式查看器**：旋转、缩放，实时切换 **ball & stick** / stick / line / sphere / cartoon，背景色与分子着色
- 🔄 **重启可恢复**：载荷随 `tool/result` 事件持久化（`presentationMeta`），重启后照常渲染，无需自定义事件类型
- ⚠️ **失败可见**：空白 canvas 不再可能——每类失败都有具体原因、建议与重试
- ⏱️ **超时保护**：容器不可见时 10 秒后给出提示，而不是永久 Loading
- ⤢ **可放大到整个窗口**：卡片内是紧凑视图（高度随窗口自适应，不再写死 400px），点右上角「放大」用浮层铺满窗口，Esc 或点遮罩收起
- 📦 **本地打包 3Dmol.js**：`vendor/3Dmol-min.cjs`（2.4.2）构建时打进 client bundle——无 CDN 运行时请求，可离线
- 🔍 **可验证**：`node scripts/verify.mjs` 一条命令跑完类型检查、98 个测试（含 3 个 jsdom 渲染测试）、
  3Dmol 解析探针、真实文件端到端探针与构建产物冒烟测试

## 安装

### 方式 A：从 GitHub 安装

```bash
dsh plugin --profile web add git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git
```

也可以直接用源码安装形式（不需要 npm 包）：

```bash
dsh plugin --profile web add github:Kanade-Tachibana-Methyl/dsh-molecule-visualization
```

> GitHub 访问不稳定时，可换成 SSH 形式：
> `dsh plugin --profile web add git+ssh://git@github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git`

### 方式 B：本地目录（开发/自用）

```bash
node scripts/build.mjs                                  # 产出 lib/index.js + lib/client.js
dsh plugin --profile web add file:<path-to-repo>
```

`dsh plugin` 是 pnpm 转发器：检测到 `dsh.bundle.patch` 会把它加入 `dsh.profile.bundles`。
若 profile 里已装过同功能插件（例如上游 `dsh-molecule-viewer`），先移除再用本包，
否则两个插件会各自注册一次 `view_molecule`。

### 方式 C：手工覆盖 profile 里的目录

```powershell
$dst = "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-molecule-visualization"
Copy-Item -Recurse -Force "<path-to-repo>\*" $dst   # 先备份
```

### 生效范围

- **client 半边**（渲染器）：DSH 的 `client-hmr` 每 500 ms 轮询 bundle 文件，检测到变化就推送新 rev 并热替换——
  **刷新页面即可，不必重启进程**。
- **host 半边**（`view_molecule` 工具注册、格式枚举、校验）：需要重启 DSH 进程：

```bash
dsh --profile web
```

## 使用

对话中描述需求即可，模型会自动调用：

> "帮我可视化这个分子：D:\project\Dock\data\3IPQ.pdb"

### 支持的格式

| 格式 | 扩展名 | 渲染用解析器 | 说明 |
|---|---|---|---|
| PDB | `.pdb` `.ent` | `pdb` | 蛋白质/大分子（ATOM/HETATM 记录）；`keepH` 保证氢原子不被丢弃 |
| SDF | `.sdf` `.sd` | `sdf` | 多分子结构（V2000/V3000）；多分子文件只渲染第一条并提示 |
| MOL | `.mol` | **`sdf`** | MDL MOL（V2000/V3000）——3Dmol.js 没有 `mol` 解析器 |
| MOL2 | `.mol2` | `mol2` | TRIPOS 格式 |
| XYZ | `.xyz` | `xyz` | 无键表，载入后按距离感知成键 |
| GJF | `.gjf` `.com` | **`xyz`** | Gaussian 输入文件，host 侧把几何块转成 XYZ（忽略路由段/Link1/ECP） |

> SMILES 不支持——必须有 3D 坐标（与上游一致）。
>
> 超过 2 MB 的分子内容不会内联进会话日志，查看器位置显示摘要卡片（原子数与格式仍可见）。

### 渲染样式

| 样式 | 参数 | 说明 |
|---|---|---|
| `ballstick` | 球棍 | 细棒 + 小球叠加（`stick.radius 0.15`、`sphere.scale 0.25`）——小分子推荐；默认仍是 `stick` |
| `stick` | 棒状 | 只有化学键 |
| `line` | 线框 | 最轻 |
| `sphere` | 空间填充 | 范德华半径 |
| `cartoon` | 飘带 | 蛋白二级结构；配体/小分子自动改用棒状以免看不见 |

### 工具参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 与 `data` 二选一（**优先**） | 分子文件路径，按你的原始写法传入（Windows/WSL 双向兼容，`~/` 自动展开） |
| `data` | `string` | 与 `path` 二选一 | 分子文件纯文本内容——仅用于磁盘上没有文件的情况，不要 base64 |
| `format` | `pdb \| sdf \| mol2 \| mol \| xyz \| gjf` | 传 `data` 时必填 | 传 `path` 时按扩展名推断，可省略 |
| `name` | `string` | 否 | 显示名称，作为查看器标题 |
| `style` | `stick \| ballstick \| line \| sphere \| cartoon` | 否 | 初始样式（默认 `stick`；蛋白质建议 `cartoon`） |

### 插件配置

```yaml
- id: molecule-visualization
  name: 'dsh-molecule-visualization'
  config:
    defaultStyle: stick              # 默认初始样式；小分子可改 ballstick
    repairShiftedPdbAltLoc: true     # PDB 列错位（统一 altLoc）自动修复；false = 直接报错
```

### 卡片上会看到什么

| 情况 | 卡片表现 |
|---|---|
| 正常 | 3D 视图 + 样式/背景/着色控件；有警告时底部显示 ⚠ 提示条 |
| host 校验失败（列错位、截断、格式不符） | 红色标题「无法显示这份 PDB 结构（文件名）：具体原因」+ 修复建议 + 校验警告 |
| 3Dmol.js 解析出 0 原子 | 「3Dmol.js 没有读出原子：…（host 侧统计到 N 个）」+ 建议 |
| host / 渲染原子数不符 | 视图照常渲染 + 提示「只载入了 45/92 个原子」 |
| 容器被折叠/隐藏 | 10 秒后「容器不可见，渲染超时：原因」+ 重试 |
| WebGL 不可用 | 「WebGL 不可用：…」+ 建议检查浏览器 GPU 设置 |
| 想细看 / 卡片太矮 | 点右上角「⤢ 放大」：浮层里用整个窗口渲染，Esc 或点遮罩关闭；会话里留一行「收起放大视图」的入口 |

## 仓库规范（dsh-plugin）

本仓库按 DSH 插件的公开约定组织，`dsh plugin` / 插件清单可以直接识别：

| 约定 | 本仓库的取值 |
|---|---|
| 仓库名 = 包名 | `dsh-molecule-visualization`（GitHub 仓库与 `package.json.name` 一致） |
| 工具名保持稳定 | 仍为 `view_molecule`（改名会破坏已有提示词与历史调用） |
| `dsh.manifestVersion` | `1` |
| `dsh.bundle.patch` | `./cordis.patch.yml`（一行 `insert`，id `molecule-visualization`） |
| `dsh.client.platform` | `web` |
| `dsh.client.inject` | `["@deepseek-ai/dsh-client-ui-tool"]`（`tool.call.toolview` 槽位的属主） |
| `icon` | `./assets/icon.svg`（插件清单里显示） |
| `engines` | `node >=22`、`dsh >=0.2.0-rc.2` |
| `keywords` | 含 `dsh-plugin`、`deepseek-harness`、`3dmol`、`molecule-visualization` 等 |
| GitHub topics | `dsh-plugin`、`deepseek-harness`、`dsh`、`molecule-visualization`、`molecular-visualization`、`3dmol`、`pdb`、`sdf`、`chemistry`、`webgl` |

发布流程、仓库元数据与 Release 文案见 [docs/release-checklist.md](docs/release-checklist.md)。

## 验证

```bash
node scripts/verify.mjs                # 类型检查 + 测试 + 探针
node scripts/verify.mjs <path-to-molecular-files>   # 额外对指定目录下的真实文件跑端到端探针
```

6 条验收清单的实测结果见 [docs/verification.md](docs/verification.md)。

## 开发

```bash
npm install                 # .npmrc 里 legacy-peer-deps=true（@deepseek-ai/* 不在 npm 上）
node scripts/build.mjs      # host: tsc → lib/，client: esbuild → lib/client.js
node scripts/typecheck.mjs  # 两个 tsconfig 都跑
node test/run-all.ts        # 单进程跑全部测试
node scripts/verify.mjs     # 全部验证
```

类型检查需要 DSH 的 `@deepseek-ai/*` 包（npm 上没有）：把它们链接进 `node_modules/@deepseek-ai`：

```powershell
New-Item -ItemType Junction -Path node_modules\@deepseek-ai `
  -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
```

运行时不需要这个链接——插件装进 profile 后从 profile 的 `node_modules` 解析。

## License 与归属

- **MIT**，见 [LICENSE](LICENSE)：上游版权声明 `Copyright (c) 2026 dsh-molecule-viewer contributors` 完整保留，
  并新增本仓库的版权行 `Copyright (c) 2026 dsh-molecule-visualization contributors`。
- 上游：[PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer)。
- 本仓库不是"从零实现"：插槽接入（`tool.call.toolview`）、`presentationMeta` 载荷设计、
  3Dmol.js 本地打包（`vendor/3Dmol-min.cjs`）与查看器 UI 骨架均来自上游；改动逐项列在
  [NOTICE.md](NOTICE.md)，版本差异见 [CHANGELOG.md](CHANGELOG.md)。
- 3Dmol.js 本身也是 MIT（其许可与版权见 [vendor/](vendor/) 与上游发行包）。
