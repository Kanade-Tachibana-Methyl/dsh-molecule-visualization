# 发布清单 / Release checklist

面向 GitHub 首发。按顺序执行即可；每一步都可回退。

## 0. 首发前的本地检查

```powershell
cd <path-to-repo>
node scripts/build.mjs
node scripts/verify.mjs <path-to-molecular-files>      # typecheck + 98 测试 + 探针，必须全绿
Select-String -Path README.md -Pattern "PandaAIDD/dsh-molecule-viewer"   # 上游署名必须仍在
```

确认三件事：

1. `git status` 里 `node_modules/`、`.npm-cache/`、`.plugin-backups/` 没有被跟踪（见 `.gitignore`）。
2. `lib/` **要提交**——`dsh plugin add` 直接跑这个包，没有 `prepare` 构建步骤。
3. 版本号：`package.json.version` 与下面的 tag 一致（首版 `0.3.0`）。

## 1. 创建 GitHub 仓库

```powershell
git init -b main
git add -A
git commit -m "feat: dsh-molecule-visualization 0.3.0 — derived from PandaAIDD/dsh-molecule-viewer

Fixes six reproduced rendering bugs and adds XYZ/Gaussian input:
- MOL rendered through the sdf parser (3Dmol.js has no mol parser)
- failures surface their reason on the card instead of a blank canvas
- ball-and-stick style, bond perception fallback for bond-less models
- bounded layout wait with a named cause and a retry button
- fixed-column PDB validation with repair of the one-column shift
  that made 3Dmol.js silently drop atoms
- XYZ (.xyz) and Gaussian input (.gjf/.com) support

Verified against 79 real molecular files: 0 rejected, 0 zero-atom renders,
0 host/render atom-count mismatches (74 of them rendered nothing before).

Upstream: https://github.com/PandaAIDD/dsh-molecule-viewer (MIT)"
```

然后建空仓库并推送（本地无凭据 / 无 `gh`，二选一）：

```powershell
# A. 网页建仓后手动关联
git remote add origin https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git
git push -u origin main

# B. 装了 GitHub CLI 的话
gh repo create Kanade-Tachibana-Methyl/dsh-molecule-visualization --public --source . --remote origin --push
```

## 2. 仓库元数据（决定可发现性）

- **Description**（GitHub 仓库描述）：
  `Interactive 3D molecular visualization for DeepSeek Harness — PDB/SDF/MOL/MOL2/XYZ/Gaussian, ball-and-stick, visible failure reasons. Based on PandaAIDD/dsh-molecule-viewer (MIT).`
- **Topics**：`dsh-plugin` `deepseek-harness` `dsh` `molecule-visualization` `molecular-visualization`
  `3dmol` `pdb` `sdf` `chemistry` `webgl`
- **About → Website**：留空或填 `https://github.com/PandaAIDD/dsh-molecule-viewer`（上游）。
- 填回 `package.json` 的 `repository` / `homepage`（当前刻意留空，避免指向上游造成误导）：

```json
"repository": { "type": "git", "url": "git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git" },
"homepage": "https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization#readme"
```

## 3. 首版 Release

```powershell
git tag -a v0.3.0 -m "0.3.0"
git push origin v0.3.0
```

Release 标题：`0.3.0 — 首发：修 6 个渲染问题 + XYZ/Gaussian`

Release 说明（可直接粘贴 `CHANGELOG.md` 的 0.3.0 段，并加一句安装方式）：

```markdown
安装：
dsh plugin --profile web add git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git

基于 PandaAIDD/dsh-molecule-viewer（MIT）改写，上游署名与许可完整保留。
改动见 NOTICE.md，验证记录见 docs/verification.md。
```

## 4. 本机 profile 的现状（已迁移）

`~/.dsh/profiles/web` 现在装的是 **`dsh-molecule-visualization`**（`file:<path-to-repo>`），
旧包 `@dsh-plugins/dsh-molecule-viewer` 已移除，`dsh.profile.bundles` 里也换成了新名字。
**重启 `dsh --profile web` 后生效**——host 半边（XYZ/GJF、列校验、列修复）在重启后才加载。

几个要记住的点：

- `file:` 依赖是**拷贝**进 profile 的，不是软链：改完源码要
  `node scripts/build.mjs` 后再 `dsh plugin --profile web add file:<path-to-repo>`
  重新导入，client-hmr 才会看到新 bundle。
- 别移动/删除 `<path-to-repo>`，否则下次 `pnpm install` 会失败。
- 发布后把 `file:` 依赖换成 git（一条命令，pnpm 会替换依赖项）：

```powershell
dsh plugin --profile web add git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git
```

- 回滚：把 `<backup-dir>\profile-config\{package.json,pnpm-lock.yaml}` 拷回
  `~/.dsh/profiles/web/`，再在该目录跑 `pnpm install`；插件本体在上游快照目录
  `<backup-dir>\dsh-molecule-viewer-0.2.0-upstream`。

若 `remove` 之后 `dsh.profile.bundles` 里还残留旧条目，手工从
`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组里删掉即可。

## 5. 发布后自检

```powershell
# 冷启动一次，确认工具列表里有 view_molecule 且没有重复注册
# 然后在本机验证文件上跑一轮：.mol（曾空白）、.pdb（列错位）、.gjf
```

- 插件清单里应显示 `assets/icon.svg` 的图标与 description。
- `docs/verification.md` 里的 6 条验收清单可逐条对照。

## 6. 可选：补一张截图

README 现在没有截图（上游那张 `assets/fig1.png` 未随源码发布，所以没沿用）。
补的话：截一张 3D 视图（建议 `ballstick`）+ 一张错误卡片，存成 `assets/screenshot.png`，
在 `README.md` 标题下加 `![3D 视图](assets/screenshot.png)`，并同步 `README.en.md`。
截图不要包含会话里的私人内容。

## 7. 网络受限时的认证选项（本机实测）

在这台机器上实测（`node probe/network-diagnostic.mjs`、`node probe/tls-path-probe.mjs`）：

| 路径 | 结果 |
|---|---|
| `github.com:443`（git HTTPS + `openssl` 后端） | 通，但**间歇性**断（同一分钟里时通时不通） |
| `api.github.com:443` | **不通**（TCP 超时）→ `gh auth login`、`gh repo edit`、`gh release create` 全部依赖它 |
| `ssh.github.com:443` | 通（SSH 握手成功） |
| Windows 默认 schannel | `SEC_E_NO_CREDENTIALS`，因此仓库里设了 `http.sslBackend=openssl` |
| 本机 `127.0.0.1:7897` 代理 | CONNECT 可建，但到 github 的 TLS 被 RST——**不要**给 git/gh 挂这个代理 |

因此按可行性排序：

1. **自己在终端里 `git push`**（Git Credential Manager 弹一次浏览器登录），不需要 token / key / gh。
2. **细粒度 PAT**（只此仓库、Contents: write、短期有效）：`git push` 时用
   `-c http.extraheader="AUTHORIZATION: basic <base64(:TOKEN)>"`，或临时写进 remote URL，用完撤销。
   注意别把 token 粘进聊天/日志。
3. **Deploy key（只写权限）**：`ssh -p 443` 推，完全不经过 api.github.com。
   公钥加到仓库 Settings → Deploy keys → 勾 "Allow write access"，私钥放在工作区
   （`.ssh-push/`，不加密，推完建议删除）。
4. 网页上传（会丢本地提交历史，仅剩一次 commit）。
5. `git bundle create repo.bundle --all` 换一台网络好的机器再推。

`gh` 只在前两条之外的场景才有价值——它需要 `api.github.com`，这台机器上不可用。
Topics 与 Release 走网页最稳。
