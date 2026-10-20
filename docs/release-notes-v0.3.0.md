基于 [PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer)（MIT）改写，修掉 6 个已复现的渲染问题。

**安装**

```bash
dsh plugin --profile web add git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git
```

装过上游插件的先 `dsh plugin --profile web remove @dsh-plugins/dsh-molecule-viewer`，装完重启 `dsh --profile web`。

**修了什么**

- `.mol` 不再空白——3Dmol.js 没有 `mol` 解析器，改为走 `sdf`。实测 14 个真实 `.mol` 里 12 个原先渲染出 0 个原子
- 失败有原因——解析异常 / 0 原子 / 无 WebGL / 容器不可见，卡片上给原因 + 建议 + 重试，不再是空白 canvas
- 新增球棍样式 `ballstick`；无键模型先按距离成键，仍无键则降级为球状显示
- 布局等待 10 秒超时，不再永久停在 "Loading"
- PDB 固定列校验 + 列错位自动修复（原先一份 92 原子的文件只显示出 1 个）

**新增**：XYZ（`.xyz`）与 Gaussian 输入（`.gjf` / `.com`，只取几何结构）

**验证**：79 个真实分子文件跑「host 校验 → 3Dmol 解析」，0 个被误拒、0 个渲染空白、0 个原子数不一致——修复前这 79 个里有 74 个什么都画不出来；98 个测试。明细见 [`docs/verification.md`](https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization/blob/main/docs/verification.md)。

上游署名与 MIT 许可完整保留；逐文件改动见 `NOTICE.md`。
