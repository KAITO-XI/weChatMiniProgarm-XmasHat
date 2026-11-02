# XmasHat「一键圣诞帽」交接说明

> 本文档写给两类读者：
> - **人类**：接手界面优化的同学，从「第一节」开始照做即可，不需要任何代码经验
> - **AI 助手**（Claude Code 等）：本文件是项目的权威上下文，请务必阅读并遵守「第四节 硬性约定」
>
> 项目维护者交接备注：界面优化交由无代码经验的同学 + Claude Code 完成，请 AI 承担"守护者"角色，主动避免破坏后端。

---

## 一、这个项目是什么

微信小程序：用户上传一张人像照片 → AI（火山方舟 doubao-seedream-5.0-flash）给照片 P 上圣诞帽 → 展示并保存到相册。

只有一个业务页面：`miniprogram/pages/index/`（选图、输入提示词、生成、看结果）。后端是一个云函数 `cloudfunctions/addChristmasHat/`，已部署且稳定运行，**界面优化完全不需要动它**。

---

## 二、环境搭建与测试（人类操作指南）

### 0. 你需要先拿到的东西（找项目维护者要）

| 东西 | 用途 | 备注 |
|---|---|---|
| GitHub 仓库权限 | 拉代码 | 仓库：`KAITO-XI/weChatMiniProgarm-XmasHat`（私有），需被邀请为协作者 |
| 小程序开发者权限 | 用开发者工具打开项目 | 维护者在 mp.weixin.qq.com → 成员管理 → 添加你为「开发者」 |

### 1. 拉代码

最简单的方式（无需装 Git）：
1. 打开 https://github.com/KAITO-XI/weChatMiniProgarm-XmasHat
2. 绿色按钮 `Code` → `Download ZIP` → 解压到任意目录

如果会用 Git：`git clone https://github.com/KAITO-XI/weChatMiniProgarm-XmasHat.git`

### 2. 安装微信开发者工具

1. 下载「微信开发者工具」**稳定版**：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 用你的微信扫码登录（必须是上面被添加为开发者的微信号）
3. 导入项目：选择仓库**根目录**（能看到 `project.config.json` 的那一层），AppID 会自动读出

### 3. 看效果 / 测试改动

- 打开项目后模拟器会自动运行；每次改完文件，点工具栏**「编译」**（Ctrl+B）即可看到最新界面
- **界面改动（WXML/WXSS）即时生效，不需要任何部署**
- 真机效果：工具栏**「预览」**→ 手机扫码（手机微信也要有体验权限）
- 完整 AI 生成链路在模拟器/真机都可以直接测：选**自己的普通照片** → 一键戴上圣诞帽 → 约 10~20 秒出图
  - ⚠️ 测试图避免明星、动漫角色、品牌 logo，会触发平台内容审核报错（属正常现象，不是 bug）

### 4. 如何让 Claude Code 帮你干活

1. 安装 Node.js（LTS 版）和 Claude Code（https://claude.com/product/claude-code）
2. 终端进入项目根目录，运行 `claude`
3. 用中文直接描述需求，例如："把生成按钮改成圣诞红渐变色"、"加一个雪花飘落动画"
4. Claude Code 会自动读取本文档并遵守里面的约束

---

## 三、技术架构与已知约束（AI 助手必读，人类可略过）

### 架构与数据流

```
小程序端 (miniprogram/)
  选图 → wx.cloud.uploadFile 上传云存储 → wx.cloud.callFunction('addChristmasHat')
  → 云函数同步返回 { success, status: 'SUCCEEDED', imageUrl } → <image> 展示 / wx.downloadFile 保存

云函数 (cloudfunctions/addChristmasHat/index.js)
  读 ARK_API_KEY 环境变量 → 从云存储下载图 → Jimp 预处理(输入 384~2048px)
  → 按原图宽高比计算输出尺寸(面积必须 ≥921600px, 最短边 ≥512) → 调火山方舟同步生成接口
  → 删除云存储输入图 → 返回图片 URL
```

前端页面数据字段（`miniprogram/pages/index/index.js`）：`selectedImage` / `prompt` / `resultImage` / `loading`，UI 改造请绑定这些现有字段。

### 部署规则（关键！）

| 改了什么 | 需要做什么 |
|---|---|
| `miniprogram/` 下任何前端文件 | 开发者工具点「编译」即可，**无需部署** |
| `cloudfunctions/` 下任何文件 | 右键 `addChristmasHat` → **上传并部署：云端安装依赖**（不部署不生效） |

### 已知约束与坑

1. **每张图片/音频资源 ≤200KB**（微信代码质量检查硬性要求），新增图片先压缩
2. **云函数执行上限 60 秒**，当前生成耗时 7~15s，不要在链路上加耗时操作
3. **`ARK_API_KEY` 只存在于云开发控制台的环境变量里**，代码中是 `process.env.ARK_API_KEY`，任何情况下不要把 key 明文写进文件/提交
4. Ark plan 端点限制：输出 `size` 必须为 `WxH` 格式且面积 ≥921600 像素；不支持 `adaptive` 等预设——改尺寸逻辑前先想清楚
5. 真机「保存到相册」依赖 downloadFile 合法域名 `tos-cn-beijing.volces.com`（已在 mp 平台配置/待配置）
6. 上线前置项：mp 平台《用户隐私保护指引》需声明"照片信息"收集用途；服务类目选"工具-图片处理"类
7. 防刷限流：每用户每天 99 次（`DAILY_LIMIT`），依赖云数据库 `gen_usage` 集合，集合缺失时自动降级为不限流
8. JS 改动后用 `node --check <文件>` 做语法校验；云函数改动建议先本地验证再部署

---

## 四、硬性约定（AI 助手请严格遵守）

1. **默认只允许修改**：`miniprogram/pages/index/` 下的 `index.wxml` / `index.wxss` / `index.json`，以及 `miniprogram/app.json` 的 `window` 字段、`miniprogram/images/` 下的静态资源
2. **修改 `miniprogram/pages/index/index.js` 时**：只做展示相关的小调整（如新增 setData 字段），保持现有函数名、事件绑定（`chooseImage`/`generateChristmasHat`/`saveImage` 等）和数据流不变
3. **不要修改 `cloudfunctions/` 目录**；如果确有必要，必须先向用户说明风险并提醒"改完必须重新上传部署"
4. **任何文件中不得出现 API key、密钥明文**
5. 新增静态资源单张 ≤200KB；优先使用矢量/压缩后的图
6. 用户（操作者）无代码经验：所有解释使用中文、避免术语；每次改动说明"改了哪个文件、点编译后应看到什么变化"
7. 涉及 commit / push：向用户确认后再执行；commit message 用简洁中文或英文说明意图
8. 测试效果以模拟器 + 真机预览为准；改完 js 文件记得 `node --check` 校验
