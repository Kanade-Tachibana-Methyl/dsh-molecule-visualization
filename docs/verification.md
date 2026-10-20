# 验证报告 / Verification report

本文件是「先复现、再修、再验证」的记录：每一条上报问题都先独立实测，确认结论后才动手；
修复后用同一批真实文件跑端到端核对。**与上报不一致的地方照实写出**，不做美化。

## 环境与方法

- 平台：Windows 10/11，Node 24.15.0，DSH `0.2.0-rc.2`（profile `web`）
- 3Dmol.js：`vendor/3Dmol-min.cjs`（2.4.2，上游打包版本，未替换）
- 实测手段：
  1. **解析层探针** `probe/3dmol-probe.cjs`：在 Node 里用最小 DOM stub 载入 vendored 3Dmol，
     直接调用 `GLModel.addMolData(data, format, opts)`，统计原子数/键数与 `console` 输出。
     这等价于浏览器里 `viewer.addModel(...)` 的解析部分（不需要 WebGL）。
  2. **真实文件探针** `probe/real-files-probe.cjs`：对目录下所有分子文件，分别按「原样传声明格式」
     与「映射后的格式」解析，对比原子数——用于证明修复前后的差异。
  3. **端到端探针** `probe/verify-real-files.mjs`：走生产路径
     `parseMolecule()`（host 校验 + 渲染载荷）→ `addMolData(载荷, 载荷.format)`，
     要求「host 报的原子数 == 3Dmol 载入的原子数」。
  4. **单元测试** `test/run-all.ts`：98 个用例，覆盖解析器、格式映射、样式、渲染诊断、布局超时、载荷投影，
     以及在 jsdom 里挂载**构建产物**（`lib/client.js`）验证卡片真实渲染结果。
- 语料：作者本机 79 个真实分子文件（mol 14、gjf 62、pdb 2、sdf 1），含 Chem3D / Gaussian 的日常导出。
  其中 `probe/1CRN.pdb` 取自 RCSB PDB（公共领域），用于「无 CONECT 的蛋白质」对照。

## 一、6 个上报问题的核验

| # | 上报问题 | 实测方法 | 实测结果 | 结论 |
|---|---|---|---|---|
| 1 | `mol` 被静默丢弃 | 3Dmol 解析器注册表 + 14 个真实 `.mol` | 注册表 `{vasp,cube,xyz,sdf,json,mcif,cif,mol2,pdb,pdbqt,pqr,mmtf,prmtop,gro,lammps,bcif}` **没有 `mol`**；传 `mol` 时库打印 `Unknown format: mol` 并猜格式，14 个真实文件里 **12 个被猜成 `xyz` → 0 原子**（只有 2 个碰巧猜对） | **复现**（"静默"程度取决于猜测，12/14 空白） |
| 2 | 失败对用户不可见 | 代码路径 + 真实文件渲染 | 0 原子时 `addModel` 不抛异常，`zoomTo` 于空模型，卡片照常 `status='ready'` → 空白 canvas，错误只进 `console` | **复现** |
| 3 | 缺少球棍样式 | `reprSpec()` 源码 + 3Dmol 表示法 | 只有 `stick/line/sphere/cartoon`；3Dmol 没有 `ballstick` 形状（需 `stick`+`sphere` 叠加） | **确认缺失** |
| 4 | 无 CONECT 的 PDB 什么都不画 | 1CRN 去掉全部 CONECT 后解析 | **键数 334**（原文件 337），原子 327 —— 2.4.2 的 `parsePDB` 里 `assignBonds` 默认为真，会对非水原子按距离补键 | **未复现**（与描述不符） |
| 5 | 布局等待可能永久挂起 | `awaitLayoutBox()` 逻辑 + 假时钟单测 | 只有 `resolve`/`reject` 两条出口且取消只在 unmount 时触发，没有任何超时 | **复现**（结构性） |
| 6 | 格式校验太松 | 一份 Chem3D 导出的 PDB 与构造用例 | host 数到 **92 个原子**，3Dmol 只载入 **1 个**，全程无报错 | **复现** |

### 关于第 4 条：为什么仍然要修

虽然 2.4.2 会自己补键，但这条路径依赖库内部的启发式（水分子/标准残基分组 + 距离阈值）；
真正会让「无 CONECT 结构一片空白」的是**原子被丢弃**，而这一点在真实文件里确实发生了，
原因不是缺 CONECT，而是第 6 条的列错位：

```
（某份 Chem3D 导出的 PDB）→ host 统计 92 个原子 / 3Dmol 载入 1 个（只剩 Cu 那一条记录）
```

因为该文件把残基名写在第 17-19 列，3Dmol 把第 17 列的 `L` 读成 `altLoc`，
按「只保留空白或 A 构象」的规则把 91 个原子全丢了。

所以第 4 条的修法不是"补一个距离成键"，而是：

- 载入后若键数为 0 → 调 `model.assignBonds()`（对 XYZ、空 bond 块的 MOL 有用）；
- 若仍为 0 → 自动降级为球状表示，并在卡片上说明「模型没有键，已改用球状显示以免画面空白」；
- 同时用第 6 条的列校验挡住"原子被静默丢弃"这个真实病因。

### 顺带发现的三类真实世界格式变体

校验器原本按教科书格式写，实测中被真实文件打回三次，这三点都已修复并有回归用例：

| 现象 | 真实文件 | 处理 |
|---|---|---|
| 三个 atom 数与 bond 数都是三位时**连写**（`210216  0 …` 表示 210 原子 / 216 键） | Chem3D 导出的 9 个 MOL 文件 | V2000 counts 改按**固定列** 1-3 / 4-6 解析 |
| 标题行为空 | 同上 | 块首的空白行不再被当作"多余空行"裁掉（否则 counts 行整体上移一行） |
| 只有两行文件头 | 少数工具导出 | 识别 `lines[2]` 是 counts 行，按两行头解析并给出警告 `mol-two-header-lines` |

## 二、验收清单实测结果

| 清单项 | 验证方式 | 结果 | 证据 |
|---|---|---|---|
| 121 原子含 Cu/I 的 MOL 显示正常 | 单测构造 121 原子 / 130 键 Cu+I 的 MOL（counts 连写 `121130`）+ 真实文件 | ✅ | `test/parser.test.ts`「reads a 121-atom Cu/I molfile…」；真实的 122 原子与 210 原子样本端到端一致 |
| 同内容 `.sdf` 显示正常 | 同内容分别按 `mol` / `sdf` 解析，比较 atomCount 与渲染载荷 | ✅ | `test/parser.test.ts`「accepts the same content declared as sdf」；同一内容按 mol / sdf 解析都是 92 原子 |
| 无 CONECT 的 PDB 显示（或明确提示） | 1CRN 去掉 CONECT；一份列错位 PDB | ✅ | 1CRN stripped：327 原子 / 334 键；列错位 PDB 修复后 92/92 并提示 `pdb-altloc-column-repaired`、`pdb-no-conect` |
| 故意损坏的文件 → 卡片显示具体错误 | 截断原子块、越界键、错列坐标、非数字坐标、缺 @<TRIPOS>、首行非原子数等 20+ 用例 | ✅ | `test/parser.test.ts`（失败用例都断言了**具体**文案，如「declares 2 atoms but the atom block has only 1 lines」「column 30 holds "-"」）；`test/dom.test.ts` 在 jsdom 里挂载**构建产物**，断言卡片文案 |
| 折叠容器内挂载 → 超时提示，不永久 Loading | 假时钟 + 假元素单测超时/取消/尺寸恢复三条路径；jsdom 里挂载真实 bundle | ✅（逻辑） | `test/layout.test.ts`；超时文案含原因与「重试」；`test/dom.test.ts` 断言卡片不会停在「正在加载 3D 视图…」 |
| `ballstick` 可切换且视觉正确 | 单测断言 `setStyle` 收到 `{stick:{radius:0.15}, sphere:{scale:0.25}}`；jsdom 里断言工具栏出现「Ball & stick」按钮 | ✅（模型层 + DOM）/ ⚠️（像素层需人眼） | `test/style.test.ts`、`test/render.test.ts`、`test/dom.test.ts`；画布像素无法在无头环境确认 |

## 三、真实文件端到端结果（修复前 / 修复后）

同一批 79 个文件，同一份 vendored 3Dmol：

| | 修复前（上游行为） | 修复后（本仓库） |
|---|---|---|
| 渲染出 0 个原子 | **74 / 79**（12 个 `.mol` + 62 个 `.gjf`） | **0 / 79** |
| 原子数与 host 统计不一致 | 1 个 PDB（92 → 1） | 0 / 79 |
| host 误拒合法文件 | — | 0 / 79（修掉了 9 个 Chem3D 变体的误拒） |

修复后汇总行（`node scripts/verify.mjs <path-to-molecular-files>`）：

```
files=79  rejected-by-host=0  rendered-0-atoms=0  count-mismatch=0
verdict: PASS
```

## 四、复现命令

```bash
# 1) 3Dmol 解析行为本身（证明 mol 没有解析器、gz/guess 路径）
node probe/3dmol-probe.cjs

# 2) 同一批真实文件：原样传格式 vs 映射后格式
node probe/real-files-probe.cjs <path-to-molecular-files>

# 3) 生产路径端到端（host 校验 → 渲染载荷 → 3Dmol 解析）
node probe/verify-real-files.mjs <path-to-molecular-files>

# 4) 单元测试（95 个）
node test/run-all.ts

# 5) 一条命令全跑
node scripts/verify.mjs <path-to-molecular-files>
```

## 五、边界与未覆盖

1. **画布像素没有被机器验证。** 无头环境没有 WebGL，我验证的是模型层（解析出的原子/键、
   传给 3Dmol 的样式 spec、错误分支），不是"屏幕上确实好看"。`ballstick` 的视觉比例
   （半径 0.15 / 缩放 0.25）沿用 3Dmol 社区惯例，最终请人眼确认一次。
2. **host 半边需要重启 DSH 进程**才生效（工具枚举、校验逻辑在 host 进程内注册）。
   client 半边（渲染器/错误卡片/超时提示）由 DSH 的 `client-hmr`（500 ms 轮询 bundle）热替换，
   刷新页面即可。

   本次交付已把构建产物装进 profile（`~/.dsh/profiles/web/node_modules/dsh-molecule-visualization`，
   上游 0.2.0 备份在 `<backup-dir>\dsh-molecule-visualization-0.2.0-upstream`）。
   安装后：
   - 已生效（热替换）：渲染器的格式映射、`ballstick` 按钮、错误卡片、警告条、原子数核对提示。
   - 待重启（`dsh --profile web`）：`xyz`/`gjf` 两个格式、host 侧列校验与修复、
     `errorHint`/`warnings` 载荷字段、`repairShiftedPdbAltLoc` 配置项。
   - 无法在本次自动化里确认的一项：运行中的 web 服务需要 `dsh web` 打印的鉴权 token，
     我没有该 token，因此没有直接抓取 `/plugins/...` 的 bundle 字节来核对 rev。
     替代证据：`probe/built-artifacts-probe.mjs`（产物可被模块表加载并注册渲染器）与
     `test/dom.test.ts`（产物在 jsdom 里真实渲染出卡片文案）。
3. **修复 PDB 第 17 列是"有据可依的自动修复"**，不是万能的列对齐还原：判据是「≥90% 的原子记录
   共享同一个非空白 altLoc 字母」，这在不规范的导出里几乎只可能来自错位。
   想严格模式可设 `repairShiftedPdbAltLoc: false`，此时直接报错并提示重新导出。
4. **GJF 只取几何结构**：路由段、`--Link1--` 后续段、ECP/gen 段都忽略；多段文件只渲染第一段几何。
5. 未支持（沿用上游非目标）：SMILES、CIF/MMTF、轨迹/多帧动画、力场/电荷着色。
