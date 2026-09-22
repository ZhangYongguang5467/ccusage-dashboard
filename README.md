# ccusage-dashboard

[English](README.en.md) · 简体中文

本机 Claude Code 用量看板：按天、项目、模型、任务查看 token 消耗与估算费用。cron 每 5 分钟聚合 `~/.claude/projects` 里的会话记录，单个静态页面展示，中英双语、深浅色主题，数据不出本机。

![截图](docs/screenshot-zh.png)

<sub>截图为脱敏演示数据</sub>

## 快速开始

需要 Node.js ≥ 18。Linux 上有 nginx 就用 nginx，否则（含 macOS）用内置服务器。

```bash
git clone https://github.com/ZhangYongguang5467/ccusage-dashboard.git
cd ccusage-dashboard
bin/dash install      # 依赖 + 数据 + cron + 启动；只有 nginx 那一步需要 sudo
```

打开 <http://localhost:8090/>。端口被占或想换端口：`PORT=8091 bin/dash install`。

`ccusage` 装不上（如 npm 源返回 403）不影响安装，只有「计费窗口」面板不可用，装上后自动恢复。

## 命令

| 命令 | 作用 |
|---|---|
| `bin/dash status` | 服务、cron、数据新鲜度 |
| `bin/dash stop` / `start` / `restart` | 停止 / 启动服务与 cron，数据保留 |
| `bin/dash refresh` | 立即重新生成数据 |
| `bin/dash uninstall` | 停止并删除 data / logs / node_modules |

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8090` | 监听端口 |
| `SERVER` | 自动 | `nginx` 或 `node` |
| `HOST` | `127.0.0.1` | 内置服务器绑定地址 |

- 项目别名：`www/data/aliases.json`，如 `{ "-home-me-work-repo": "nicer name" }`，key 为 cwd 中 `/` 换成 `-`
- URL 参数：`?lang=en|zh`、`?theme=dark|light`
- 远程访问走 SSH 隧道（`ssh -L 8090:localhost:8090 <host>`），页面含项目路径与费用，不要对外开放端口

## 数据口径

- **费用**：token × LiteLLM 公开价格，input / output / cache 写 / cache 读分别计价。是估算值，订阅套餐不按此计费
- **去重**：与 ccusage 一致（`message.id + requestId`）
- **任务段**：一条用户提示到下一条之间的全部回合。实质任务 = ≥1 次工具调用或 ≥3 轮；重任务 = 压缩过上下文 / ≥20 次工具调用 / 上下文 ≥500K
- **计费窗口**：来自 ccusage blocks，含本机其他 agent（codex、kimi 等），合计会大于本页的 Claude Code 费用
- 日期按本机时区切分；页脚有与 ccusage 的对账

## 隐私

只读本机文件，不上传用量数据；唯一外网请求是每 24 小时拉一次 LiteLLM 价格表。`www/data/` 含项目路径与主机名，已 gitignore。

## License

MIT
