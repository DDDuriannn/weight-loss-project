# loser 减肥大业

zwh(loser) 的 28 天体重、饮食与运动记录。计划从 **2026-11-04** 到 **2026-12-01**，日期与时钟均采用北京时间 `Asia/Shanghai`。

页面保留日期条、列表／日历切换、日期定位、明暗主题和时钟。列表仅显示已有记录的日期，并默认展开；日历包含完整的 28 天，没有记录的日期显示空状态。只有体重、没有饮食或运动条目的日期也会显示。目前第 1 天记录了 **101 kg** 和 3 条饮食／运动内容。

这是使用 Vite 和原生 HTML/CSS/JavaScript 的静态网站，不需要登录、数据库、环境密钥或后端服务。页面没有第三方资源请求或外链，通过 GitHub Pages 发布。

## 本地运行

使用 Node.js 24 和 npm，在项目根目录运行：

```powershell
npm ci
npm run dev
```

在浏览器打开终端显示的本地地址，通常是 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。若端口已被占用，以终端输出为准。请通过本地服务器访问页面。

## 维护每日记录

编辑 `src/data/challenge.json`。顶层配置为 `title`、`owner`、`startDate`、`endDate`、`timeZone`、`intro` 和 `records`；`records` 只填写已记录的日期，无需为剩余 27 天预建空记录。

文字修改入口：

| 要修改的内容 | 位置 |
| --- | --- |
| 项目名称、个人名称、简介 | `src/data/challenge.json` 的 `title`、`owner`、`intro` |
| 每日饮食／运动内容 | 对应日期的 `records[].entries[].text` |
| 每日体重（kg） | 对应日期的 `records[].weightKg` |
| 固定说明、按钮名称、页脚等页面文案 | `src/page.html` |
| “饮食”“运动”类别徽章文字 | `src/challenge-model.js` 的 `CATEGORY_LABELS` |

改类别徽章时保留数据中的 `diet`、`exercise` 键名，仅修改对应的中文标签。计划起止日期和时区也由 JSON 的 `startDate`、`endDate`、`timeZone` 控制。

以下为结构示例，示例文字不会自动加入网站：

```json
{
  "title": "loser 减肥大业",
  "owner": "zwh(loser)",
  "startDate": "2026-11-04",
  "endDate": "2026-12-01",
  "timeZone": "Asia/Shanghai",
  "intro": "记录这 28 天的饮食与运动。",
  "records": [
    {
      "date": "2026-11-04",
      "weightKg": 101,
      "entries": [
        { "id": "2026-11-04-diet-1", "category": "diet", "text": "在这里填写饮食记录" },
        { "id": "2026-11-04-exercise-1", "category": "exercise", "text": "在这里填写运动记录" }
      ]
    }
  ]
}
```

新增一天时，向 `records` 追加一个日期对象；为同一天补充内容时，向对应的 `entries` 追加条目。`date` 使用 `YYYY-MM-DD` 并保持在计划日期内；每条 `id` 保持唯一，`category` 使用 `diet`（饮食）或 `exercise`（运动），`text` 为普通文本。构建时会根据配置生成完整日期条、日历与记录列表，标题不会变成链接。

`weightKg` 使用以 kg 为单位的**正数**，允许小数，例如 `101` 或 `100.6`。没有称重的日期省略此字段，不填 `0`；页面也不会沿用前一天的体重。当天只有体重时，`entries` 可以省略或写为 `[]`，例如：

```json
{ "date": "2026-11-05", "weightKg": 100.6 }
```

此日期仍会显示在列表与日历中；这只是维护示例，不代表已记录第二天的体重。

## 检查与构建

```powershell
npm test
npm run build
npm run check:build
npm run preview
```

`npm test` 运行内容与交互检查；`npm run build` 生成 `dist/`；`npm run preview` 预览构建后的页面，通常使用 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。`vite preview` 仅用于本地验收。

`npm run check:build` 应在构建后运行。它将 `dist/` 挂载到临时 Node HTTP 服务器的 `/replica/` 子路径，实际请求首页、脚本、样式和四个字体，检查 HTTP 状态、资源类型、字体签名、相对资源路径和记录结构；同时检查没有遗留占位符、旧站功能、外链或第三方加载。预期记录数量由源数据计算，追加每日记录后无需手动修改检查脚本。检查结束会自动关闭服务器，不启动浏览器，也不访问外网。

页面标题、描述、计划日期和日历均从同一份配置生成。人工检查还应覆盖桌面与手机布局、明暗主题、列表折叠展开、日历的空日期、`#day-1` 等日期直达，以及北京时间的日期与进度。体重还应检查整数／小数显示、未称重日期和只有体重的日期；HTTP 构建检查不能代替视觉验收。

2026-11-04 本地验收：21 项自动化测试、构建和子路径检查通过，实际核验了桌面、390／320 px 手机明暗主题，以及体重在卡片折叠后和日历详情中的显示。行为测试使用独立示例数据，修改实际文字和新增每日记录不会受到固定条数限制。

## 主要文件

- `src/data/challenge.json`：项目配置和每日体重、饮食／运动记录。
- `src/render-page.js`、`src/page.html`：构建时的页面渲染和页面外壳。
- `src/styles.css`：配色、排版与响应式布局。
- `public/fonts/`：随网站提供的四个本地字体；头像使用 emoji。
- `scripts/check-build.js`：GitHub Pages 仓库子路径验收。
- `.reference/`：本地参考和验收材料，已忽略，不随网站发布。

页面视觉样式与字体沿用初版参考资源，个人记录由 zwh(loser) 维护。本项目不对第三方字体另行声明许可。

## GitHub Pages 发布

仓库为 [DDDuriannn/weight-loss-project](https://github.com/DDDuriannn/weight-loss-project)，Pages 访问地址为 [ddduriannn.github.io/weight-loss-project](https://ddduriannn.github.io/weight-loss-project/)。每次发布的状态以仓库 Actions 中对应提交的工作流结果为准。

已准备 `.github/workflows/pages.yml`，使用 Node.js 24，依次安装依赖、运行测试、构建、检查仓库子路径资源并部署 `dist/`。仅在本地保存这份配置不会发布网站。

1. 本地验收后，将源码和 `package-lock.json` 提交并推送到目标仓库的 `main`。无需提交 `node_modules/`、`dist/` 或 `.reference/`。
2. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
3. 在 **Actions** 中运行 **Deploy to GitHub Pages**，或再次向 `main` 推送提交。
4. 等待部署完成，使用工作流 `github-pages` 环境或 **Settings → Pages** 显示的正式网址验收。

项目采用 `base: './'`，兼容 `https://<用户名>.github.io/<仓库名>/` 形式的项目地址。新增本地资源时继续使用相对路径；页面日期定位使用 `#day-N`，不依赖服务器路由重写。工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需保存个人访问令牌。

参考：[Vite 静态部署文档](https://vite.dev/guide/static-deploy.html)、[GitHub Pages 自定义工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
