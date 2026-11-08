# 匿名问答部署与维护

问答页面由 GitHub Pages 发布，问题、回复和登录由 Supabase 托管。Supabase 控制台负责应用 SQL、部署函数及保存密钥。Turnstile 通过 Cloudflare 控制台配置。日常回复在站内管理页完成。

## 首次配置

1. 在 [Supabase 控制台](https://supabase.com/dashboard/projects) 建立专用于问答的项目。在 **Authentication → Users** 建立站主的邮箱和密码账号并确认邮箱，复制用户的 UUID。到 **Authentication → Sign In / Providers** 关闭新用户注册，保留邮箱登录。站主在控制台输入并保管密码。
2. 在 [Cloudflare 控制台](https://dash.cloudflare.com/) 的 **Turnstile** 创建 Managed 组件，允许主机名 `ddduriannn.github.io`。组件的 site key 用于 GitHub Pages，secret key 用于 Supabase Edge Function。
3. 在 Supabase **SQL Editor** 执行 [建表和权限脚本](../supabase/migrations/20261108000000_qa.sql)。随后在 **Edge Functions → Secrets** 设置以下值。

   | 名称 | 值 |
   | --- | --- |
   | `QA_OWNER_ID` | 站主 Auth 用户的 UUID |
   | `QA_ALLOWED_ORIGIN` | `https://ddduriannn.github.io` |
   | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key |

4. 在 **Edge Functions → Deploy a new function → Via Editor** 创建 `qa`，使用 [函数入口](../supabase/functions/qa/index.ts) 和 [请求处理器](../supabase/functions/qa/handler.js) 两个文件。关闭该函数的 JWT 网关验证，使匿名路由可以到达函数。函数对每次管理请求另行验证登录令牌和站主 UUID。
5. 在 GitHub 仓库 **Settings → Environments → github-pages → Environment variables** 添加以下公开变量。保存后由 Pages 工作流注入前端构建。

   | 名称 | 值 |
   | --- | --- |
   | `VITE_QA_SUPABASE_URL` | Supabase 项目 HTTPS 地址，格式为 `https://<project-ref>.supabase.co` |
   | `VITE_QA_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key，以 `sb_publishable_` 开头 |
   | `VITE_QA_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key |

## 验收与使用

- 使用 `npm test`、`npm run build` 和 `npm run check:build` 运行本地模拟测试及静态检查。数据库权限和接口联调在 Supabase 云端进行。
- 在迁移完成、问答表为空且开放投稿前，以 `postgres` 在 Supabase SQL Editor 中运行 [回滚式验收脚本](../supabase/tests/qa-smoke.sql)，检查问答表权限、写入限额和状态转换。检查云函数公开列表、无效验证码拒绝，以及访客与非站主访问管理接口时被拒绝。控制台测试请求使用 `Origin: https://ddduriannn.github.io`。
- Pages 发布后，从首页进入匿名提问页。提交一条测试问题，在管理页用站主账号登录，确认问题进入待答列表。回复并发布，刷新公开问答确认可见，再撤回、归档，确认测试问题退出公开列表。
- 日常使用 [公开问答页](https://ddduriannn.github.io/weight-loss-project/questions/) 和 [站主管理页](https://ddduriannn.github.io/weight-loss-project/questions/admin/)。撤回后问题回到待答列表，保留原回复。归档后的问题可以恢复为待答。
