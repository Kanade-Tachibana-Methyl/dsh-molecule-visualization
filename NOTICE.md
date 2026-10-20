# NOTICE

本仓库是 **[PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer)** 的衍生版本：
直接基于上游源码改写，**没有使用 GitHub 的 Fork 功能**，而是独立仓库演进。

This repository is a **derivative** of [PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer):
it builds directly on the upstream source and evolves as an independent repository (no GitHub fork was used).

## 上游 / Upstream

- Repository: <https://github.com/PandaAIDD/dsh-molecule-viewer>
- Upstream version this builds on: `0.2.0`
- License: MIT
- Copyright notice (retained verbatim in [LICENSE](LICENSE)): `Copyright (c) 2026 dsh-molecule-viewer contributors`

## 上游已有、未重写的部分 / Upstream work kept as-is

- `tool.call.toolview` 键控插槽接入方式与 `view_molecule` 工具的整体结构
  (`src/client/index.ts` 的注册方式、`src/index.ts` 的工具声明骨架)。
- `presentationMeta` 载荷设计：把 UI 数据挂在 `tool/result` 事件上随会话日志持久化，
  从而在重启后仍能渲染、且不引入自定义事件类型。
- `vendor/3Dmol-min.cjs`（3Dmol.js 2.4.2 的本地 UMD 打包）与 `src/client/threeDmol.ts` 加载器。
- 查看器 UI 骨架（工具栏、背景色预设、元素/彩虹/自选着色、内联样式方案）、
  `cartoon` 模式下配体改用棒状的思路。
- `src/invariant.ts`、`cordis.patch.yml`、package 的 `dsh` 清单结构、路径跨 OS 解析思路。

## 本仓库的改动 / Changes made here

按文件列出，便于逐项对比上游。

| 文件 | 改动 |
|---|---|
| `src/parser.ts` | 由「仅计数」重写为逐格式校验器：PDB 固定列校验（记录名 1-6、serial 7-11、resName 18-20、x/y/z 31-54、第 30 列必须为空）、统一 `altLoc` 列错位修复、MOL/SDF 的 V2000（含**连写的三字段 counts**，如 `210216`）与 V3000、MOL2、XYZ、GJF→XYZ 转换；新增 `renderFormatFor()` |
| `src/types.ts` | 格式枚举增加 `xyz`/`gjf`；样式增加 `ballstick`；载荷增加 `renderFormat`/`renderAtomCount`/`errorHint`/`warnings`（全部可选，向后兼容旧载荷） |
| `src/meta.ts` | **新增**：把 `presentationMeta` 投影抽成可单测的纯函数，投影时把载荷规范化为「渲染就绪」内容（mol→sdf、gjf→xyz） |
| `src/index.ts` | 工具描述/枚举/输出 schema 扩展；execute 使用校验器并回传 `errorHint`/`warnings`；新增配置项 `repairShiftedPdbAltLoc` |
| `src/client/format.ts` | **新增**：`mol`→`sdf`、`gjf`→`xyz` 映射 + 载荷 `renderFormat` 解析（旧载荷兜底） |
| `src/client/style.ts` | **新增**（自 `MoleculeView.tsx` 抽出并扩展）：`ballstick` 双表示叠加、无键时降级为球状、样式表 |
| `src/client/render.ts` | **新增**（自 `MoleculeView.tsx` 抽出并扩展）：`addModel` 使用映射后的解析器、PDB `keepH`、0 原子/0 键诊断、`assignBonds()` 距离成键兜底、原子数核对、可区分的 `MoleculeRenderError` |
| `src/client/layout.ts` | **新增**（自 `MoleculeView.tsx` 抽出并扩展）：`awaitLayoutBox` 增加超时、取消错误与「为什么不可见」描述 |
| `src/client/MoleculeView.tsx` | 新增 `ballstick` 按钮、错误卡片（原因/建议/重试）、警告条、诊断状态；样式变更不再重建 viewer |
| `src/client/index.ts` | 失败分支渲染具体原因 + 建议 + 警告；载荷透传新字段；中文提示统一 |
| `src/client/contract/types.ts` | 镜像新字段并放宽/收紧运行时守卫（`renderFormat` 可选、`warnings` 校验） |
| `test/**` | **新增** 95 个单元测试（解析器/格式映射/样式/渲染/布局/载荷投影） |
| `probe/**` | **新增** 3Dmol 行为探针、真实文件端到端探针、PDB 列错位诊断脚本 |
| `scripts/**` | **新增** 构建/类型检查/验证脚本（继承 stdio，兼容受限沙箱） |
| `tsconfig*.json` | **新增**（上游未随包发布）：host 与 client 两套编译配置 |
| `README*.md` `NOTICE.md` `CHANGELOG.md` `docs/verification.md` | 重写/新增：说明上游来源、改动、验证结果 |

未改动上游的核心约定：不新增自定义 session 事件类型、不改 DSH 的 slot 机制、不重写 3Dmol 集成。

## 许可 / License

MIT。上游版权声明保留在 [LICENSE](LICENSE) 中，并追加本仓库的版权行。
MIT 允许修改与再发布，但要求保留版权声明与许可文本——因此本仓库既保留上游声明，
也明确写出「基于上游改写」，不使用"原创/从零实现"的措辞。
