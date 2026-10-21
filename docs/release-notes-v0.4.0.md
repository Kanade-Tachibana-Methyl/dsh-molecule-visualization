卡片里的 3D 视图不再写死 400px，并支持放大到整个窗口。

**安装**

```bash
dsh plugin --profile web add git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git
```

从 0.3.0 升级用同一条命令（pnpm 会重新解析这个 git 依赖；如果它没刷新，先 `dsh plugin --profile web remove dsh-molecule-visualization` 再 add）。本次只动了 client 半边，重启或不重启都行——刷新页面即可。

**改了什么**

- 内嵌卡片高度改为 `clamp(240px, 34vh, 420px)`，header / 工具栏更紧凑——常见窗口高度下一屏放得下，不用为了看全分子反复滚动
- 新增「⤢ 放大」：把同一个 viewer 用 portal 铺满整个窗口，Esc / 点遮罩 / 「收起」关闭；聊天里保留一行入口，不会像调用消失了
- 展开与折叠之间切换时 viewer 重建（3Dmol 的 canvas 尺寸在建时绑定 DOM 节点），并在卸载时释放 WebGL 上下文
- 其余不变：仍是在工具调用行里渲染，非卡片内不再有固定高度

**没有改**：滚轮仍是缩放（3Dmol 给 canvas 绑了 `preventDefault`），要滚页面请把指针移出画布。

**验证**：100 个测试全部通过（含 5 个 jsdom 渲染测试，覆盖浮层开合与 Esc 关闭），79 个真实分子文件端到端仍全绿。明细见 [`docs/verification.md`](https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization/blob/main/docs/verification.md)。
