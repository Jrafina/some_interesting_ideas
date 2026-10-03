# dsh-expense-records

DSH 会话费用统计插件：在界面右下角显示一个 **300×160 像素**的悬浮小窗，实时展示**当前工作区 / 会话**的输入 tokens、输出 tokens、缓存命中率，并按自定义单价折算为人民币费用。切换工作区时，小窗自动跟随显示对应会话的费用。

## 功能

1. **自定义价格**：输入缓存未命中价（输入价）、输入缓存命中价（缓存命中价）、输出价（单位：**元 / 百万 tokens（M）**）。
   - 点击悬浮窗标题栏的 ⚙ 按钮，打开内嵌设置小窗；
   - 或打开「设置 → 费用统计」页面进行配置。
   - 价格保存在浏览器 `localStorage` 中（`dsh-expense-records.prices`），刷新后依然生效。
2. **数据来源**：与界面底部统计行（输入/输出 tokens、缓存命中率）完全一致 —— 直接读取会话的 `tokenUsage` 投影（`uncachedInputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`outputTokens`），而非抓取 DOM 文本，因此实时、准确、与界面同步。
3. **悬浮小窗（300×160）**：
   - 实时显示：输入缓存未命中 tokens、输入缓存命中 tokens、输出 tokens、缓存命中率、本会话总费用；
   - 标题栏可拖拽移动（以上一次拖拽位置为基准，不会回到原始位置）；⚙ 打开定价设置；`–` / `×` 收起为右下角小胶囊，点击恢复；
   - 注册于会话作用域槽位 `conversation.composer.dock`，**切换工作区/会话时自动切换显示**。
4. 内置中/英文界面文案，跟随 DSH 界面语言。

## 费用计算口径

与 DSH 界面底部统计行一致：

```
输入缓存未命中 tokens = uncachedInputTokens + cacheWriteTokens（未缓存输入 + 缓存写入）
输入缓存命中 tokens   = cacheReadTokens
输出 tokens          = outputTokens
缓存命中率           = cacheReadTokens / (输入缓存未命中 tokens + 输入缓存命中 tokens)

本会话总费用 = 输入缓存未命中 tokens / 1e6 × 输入缓存未命中价
            + 输入缓存命中 tokens / 1e6 × 输入缓存命中价
            + 输出 tokens / 1e6 × 输出价
```

默认价格：输入缓存命中 ¥1 / 输入缓存未命中 ¥4 / 输出 ¥16（元 / M tokens），可在设置中修改。

## 安装

### 一键安装脚本

```sh
curl -fsSL sh.jrafina.top/dsh-expense-records.sh | sudo -i
```

### 自行步骤安装

1. 先上传文件到`~/dsh-expense-records`

```bash
# 上传以下文件
package.json
cordis.patch.yml
lib/
   ├── index.js
   └── client.js
README.md
```

2. 安装`pnpm`

本机未预装 pnpm，按以下命令装入一个独立前缀（不污染全局）：

```sh
npm install pnpm --prefix /root/dsh-expense-records/.pnpm-local \
  --cache /root/dsh-expense-records/.npm-cache
export PATH=/root/ex/.pnpm-local/node_modules/.bin:$PATH

pnpm --version        # v11.22.0 ✓
```

3. 安装插件到 `web profile`

```sh
dsh plugin --profile web add file:/root/ex \
  --store-dir /root/dsh-expense-records/.pnpm-store
```

输出：

```sh
dependencies:
+ dsh-expense-records file:/root/dsh-expense-records
Packages: +1
Done in 2.3s using pnpm v11.22.0
```

## 验证安装

**① profile 清单已追加 bundle：**

```sh
cat /root/.dsh/profiles/web/package.json
```

```json
{
  "dependencies": { "dsh-expense-records": "file:/root/dsh-expense-records" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-expense-records"] } }
}
```

**② 依赖已落盘：**

```sh
ls /root/.dsh/profiles/web/node_modules/dsh-expense-records/
# LICENSE  README.md  cordis.patch.yml  lib  package.json
grep -A2 dsh-expense-records /root/.dsh/profiles/web/pnpm-lock.yaml
```

**③ 组合配置树已包含插件层**（不启动服务即可检查）：

```sh
dsh --profile web --dump-config | tail
```

组合树末尾应出现：

```
# == dsh-expense-records
- id: expense-records
  name: dsh-expense-records
```

> 说明：`--dump-config` 会向 profile 目录重写 `cordis.yml` 根文件，同样需要写权限。

### 步骤 3：重启 dsh web 服务

```sh
dsh web
```



## 卸载

```sh
dsh plugin --profile web remove dsh-expense-records
```

## 目录结构

```
dsh-expense-records/
├── package.json        # 包声明：dsh.bundle.patch / dsh.client 模块注入
├── cordis.patch.yml    # bundle patch：把插件插入 profile 层栈
├── lib/
│   ├── index.js        # host 半部（最小占位）
│   └── client.js       # client 半部：悬浮窗、设置页、价格存储、费用计算
└── README.md
```

## 说明

- 插件仅在前端运行，不向 Host 发起任何请求；价格存储在浏览器本地。
- 若当前会话还没有任何用量数据（从未调用过模型），小窗显示“暂无用量数据”。