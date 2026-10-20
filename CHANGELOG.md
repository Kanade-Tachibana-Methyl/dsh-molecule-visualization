# Changelog

本文件记录本仓库相对上游的差异。上游版本线为 `0.2.0`，本仓库从 `0.3.0` 起编号。

## 0.3.0

### Fixed

- **`mol` 格式静默失败**：3Dmol.js 2.4.2 没有 `mol` 解析器，把 `mol` 原样传给
  `viewer.addModel` 会让库打印 `Unknown format: mol` 并猜格式；实测 14 个真实 `.mol` 文件中有
  12 个被猜成 `xyz` 解析器 → 解析出 0 个原子、画面空白且无报错。
  现在 `mol` 映射为 `sdf` 解析器，载荷带 `renderFormat` 字段，客户端另有一层兜底映射
  （因此旧会话里已记录的调用在重新加载后也能正确渲染）。
  实测：79 个真实文件全部通过「host 校验 → 3Dmol.js 解析」端到端核对（修复前 74 个渲染 0 原子）。
- **失败不可见**：解析异常、0 原子、无 WebGL、容器不可见现在都在卡片上给出**具体原因 + 建议 + 重试**；
  渲染后还会核对「host 统计原子数 vs 3Dmol 实际载入数」，不一致时给出提示（例如 `45/92`）。
- **缺少球棍样式**：新增 `ballstick`（`{stick:{radius:0.15}, sphere:{scale:0.25}}` 叠加）。
- **无键模型空白**：载入后键数为 0 时先 `model.assignBonds()` 按距离成键；仍为 0 则降级为球状显示并提示。
- **布局等待永久挂起**：`awaitLayoutBox()` 增加超时（默认 10 s）、取消错误与不可见原因描述；
  超时后卡片显示原因与重试按钮。
- **格式校验太松**：host 侧改为逐格式严格校验，报错指明行号与列范围：
  - PDB：记录名 1-6、serial 7-11、resName 18-20、x 31-38、y 39-46、z 47-54，
    第 30 列必须为空（x 错位一列的判别依据），坐标必须是数字；
  - MOL/SDF：V2000 counts 按**固定列**解析（支持 `210216` 这种三字段连写）、原子/键块行数与越界索引、V3000 `BEGIN ATOM`；
  - MOL2：`@<TRIPOS>` 段、原子行 6 列、坐标数字；
  - XYZ：首行原子数、注释行、逐行 `element x y z`；
  - GJF：路由段、charge/multiplicity 行、几何行。
- **PDB 列错位导致静默丢原子**（同属上一条，但值得单列）：当整份文件的第 17 列都被同一个字母占据
  （resName 被写在 17-19 而非 18-20 的特征），3Dmol.js 会把它当作 `altLoc` 并丢弃这些原子。
  现在默认**修复**该列并在卡片上警告，或用 `repairShiftedPdbAltLoc: false` 改为直接报错。
  实测一份 Chem3D 导出的 PDB：修复前 host 数到 92 个原子、画面 1 个；修复后 92/92。

### Added

- **XYZ 格式**（`.xyz`）：3Dmol.js 原生支持，载入后按距离感知成键。
- **Gaussian 输入**（`.gjf` / `.com`）：host 侧把几何块转换为 XYZ 再渲染（读取 charge/multiplicity 行之后的
  原子行，支持 `C(Fragment=1)` 写法，忽略 Link1 后续段与 ECP 段）。
- **`ballstick` 样式**，以及工具栏中的样式切换按钮（带 tooltip 说明）。
- **卡片警告条**：host 校验产生的非致命提示（无 CONECT、无键块、多分子文件只渲染第一条、GJF 已转换、
  列修复等）显示在视图下方。
- **配置项** `repairShiftedPdbAltLoc`（默认 `true`）。
- **测试与探针**：95 个单元测试；`probe/3dmol-probe.cjs`（3Dmol 解析行为）、
  `probe/verify-real-files.mjs`（真实文件端到端）、`probe/pdb-debug.cjs`（列错位诊断）。
- **构建脚本**：`scripts/build.mjs` / `scripts/typecheck.mjs` / `scripts/verify.mjs`
  （使用继承 stdio 启动 tsc 与原生 esbuild，可在受限沙箱内构建）。
- **文档**：README 重写（来源说明 + 改动 + 使用 + 验证）、`NOTICE.md`、`docs/verification.md`。

### Changed

- `src/parser.ts` 从"只数原子"变为"校验 + 产出渲染就绪载荷"；`atomCount` 语义扩展为
  `atomCount`（文件内原子总数）+ `renderAtomCount`（3Dmol 实际会载入的数量，多分子 SDF 时不同）。
- 载荷新增可选字段 `renderFormat` / `renderAtomCount` / `errorHint` / `warnings`：
  全部可选，旧载荷（无这些字段）仍能渲染。
- PDB 渲染改为 `keepH: true`，避免 3Dmol 默认丢氢导致「host 92 个原子 / 实际 45 个」的误报。
- 默认样式仍为 `stick`；README 建议小分子用 `ballstick`。
- 工具错误文本改成「原因（+ 建议）」，模型读到的 `render` 文本会附带 warning 摘要。

### Renamed

- 包名由上游的 `@dsh-plugins/dsh-molecule-viewer` 改为 **`dsh-molecule-visualization`**
  （仓库名、`package.json.name`、client bundle 的模块 id、`cordis.patch.yml` 的 row id 同步）。
  **工具名仍是 `view_molecule`**——改名会破坏已有提示词、历史调用与用户习惯。
- 若 profile 里装过上游包，升级前先 `dsh plugin --profile web remove @dsh-plugins/dsh-molecule-viewer`，
  否则两个插件会各自注册一次 `view_molecule`。
- 补齐 DSH 清单字段：`dsh.manifestVersion: 1`、`icon`（`assets/icon.svg`）、`engines.node`/`engines.dsh`；
  `exports["./client"]` 去掉指向不存在的 client 类型声明的 `types` 字段。
- 上游署名与 MIT 许可未变：`LICENSE` 保留上游版权行，`NOTICE.md` 逐文件列出改动。

### Unchanged (upstream behavior kept)

- 不引入自定义 session 事件类型：载荷仍走 `tool/result` 的 `presentationMeta`。
- 不改 DSH slot 机制、不重写 3Dmol 集成、不做 SMILES。
- 最大文件 50 MB、载荷内联上限 2 MB（超出显示摘要卡）。
