# ccusage-dashboard

[English](README.en.md) · 简体中文

本机 Claude Code 用量看板：按天、项目、模型、任务查看 token 消耗与估算费用。单个静态页面 + cron，没有后端进程。

![截图](docs/screenshot-zh.png)

<sub>截图为脱敏演示数据</sub>

## 特性

- 8 项 KPI（费用、token、请求、会话、计费窗口、任务复杂度等），全部跟随 `1D / 7D / 30D / 90D / ALL` 切换
- 每日费用（按模型）、项目排行、计费窗口历史、活跃热力图、项目与会话明细
- 任务级分析：按用户提示切分任务段，统计轮次、工具调用、上下文、耗时
- 中 / 英双语，深 / 浅色主题，一键切换
- 只读本机文件，不上传任何数据

## 快速开始

需要 Node.js ≥ 18、nginx、cron，以及本机的 Claude Code 会话记录（`~/.claude/projects`）。

```bash
git clone https://github.com/ZhangYongguang5467/ccusage-dashboard.git
cd ccusage-dashboard
bin/dash install      # 依赖 + 数据 + cron + nginx 站点；仅 nginx 一步需要 sudo
```

打开 <http://localhost:8090/>。换端口：`PORT=8091 bin/dash install`。

远程机器请走 SSH 隧道（`ssh -L 8090:localhost:8090 <host>`）。页面含项目路径与费用，不建议对外开放端口。

## 命令

| 命令 | 作用 |
|---|---|
| `bin/dash status` | 查看站点、cron、数据新鲜度 |
| `bin/dash stop` / `start` / `restart` | 停用 / 启用站点与 cron，数据保留 |
| `bin/dash refresh` | 立即重新生成数据 |
| `bin/dash uninstall` | 停用并删除 data / logs / node_modules |

## 工作原理

cron 每 5 分钟运行 `bin/refresh.sh`：先用 ccusage 导出 JSON，再由 `bin/aggregate.mjs` 扫描 `~/.claude/projects/**/*.jsonl` 聚合为 `www/data/*.json`。nginx 直接服务 `www/`；页面用 Chart.js 渲染，每 2 分钟自动重拉。

```
bin/dash              入口：install / start / stop / status / refresh / uninstall
bin/refresh.sh        cron 任务
bin/aggregate.mjs     聚合 + 任务段切分
nginx/*.template      站点模板，安装时按仓库路径渲染
www/index.html        页面，单文件，无构建
www/data/             生成数据，不入库
```

## 数据口径

- **费用**：token × LiteLLM 公开价格；input、output、cache 写（5m / 1h）、cache 读分别计价。为估算值，订阅套餐不按此计费
- **去重**：与 ccusage 一致（`message.id + requestId`），跳过 `<synthetic>`
- **任务段**：一条用户提示到下一条之间的全部回合。实质任务 = ≥1 次工具调用或 ≥3 轮；重任务 = 发生过上下文压缩 / ≥20 次工具调用 / 上下文 ≥500K
- **计费窗口**：来自 ccusage blocks，含本机其他 agent（codex、kimi 等），因此合计大于本页的 Claude Code 费用
- 日期按本机时区切分；页脚有与 ccusage 的对账

## 配置

- 端口：`PORT=8091 bin/dash install`
- 项目别名：`www/data/aliases.json`（不入库），如 `{ "-home-me-work-repo": "nicer name" }`；key 为 cwd 中 `/` 替换为 `-`
- URL 参数：`?lang=en|zh`、`?theme=dark|light`

## 隐私

只读本机文件，不上传用量数据。唯一的外网请求是每 24 小时获取一次 LiteLLM 价格表，失败则用缓存。`www/data/` 含项目路径与主机名，已 gitignore，请勿提交。

## License

MIT
