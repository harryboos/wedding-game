# 游戏

一个游戏入口页，以及「山壁跳一跳」「天狗兽大作战」两个小游戏。无需数据库或登录，浏览器直接运行，适合婚礼现场扫码打开。

## 本地预览

电脑安装 Node.js 20 或更高版本后，在项目目录执行，无需安装依赖：

```sh
npm run dev
```

打开 http://127.0.0.1:4173 。改完源码后重新运行 `npm run build`，再刷新页面。

手机联调：在电脑运行 `npm run preview -- --host 0.0.0.0`，手机与电脑连接同一局域网，然后打开 `http://电脑局域网IP:4173`。此预览服务用于本地检查；正式部署用下面的 Nginx 或 Docker。

## 部署到现有服务器

### 静态目录部署（推荐已有网站服务时使用）

```sh
npm run build
```

把 **dist 里面的所有内容**上传到网站根目录，不能只上传入口 HTML。服务器只需要提供静态文件，且默认首页为 `index.html`。不需要 Node 常驻进程。

- 入口：`/`
- 跳一跳：`/jump-jump/`
- BOSS 战：`/vine-boss-shooter/`

页面链接均为相对路径，也支持放在 `/games/` 等子目录：例如入口 `/games/`、跳一跳 `/games/jump-jump/`。子目录访问应带结尾斜杠，Nginx 会自动补齐目录斜杠。请不要配置所有未找到文件均回退到首页的 SPA 重写规则。

Nginx 配置示例见 `deploy/nginx.conf`。在已有服务器中，把 `root` 改成实际上传目录，并按需要设置 `server_name`、监听端口和 HTTPS 证书。已有网站不要直接覆盖其配置。

### Docker 部署

服务器已安装 Docker Compose 时，在本项目目录运行：

```sh
docker compose up -d --build
```

打开 `http://服务器IP:8080`。可用 `PORT=8090 docker compose up -d --build` 修改对外端口；如已有 Nginx，可让它通过域名反向代理到该端口。更新代码后重新执行同一命令。停止服务用 `docker compose down`。

Docker 会自动生成部署目录，最终镜像只包含 Nginx 和网页文件。没有 npm 第三方依赖。构建仍需要联网拉取 Node/Nginx 基础镜像。

## 现场使用

1. 部署后，先用手机的移动网络打开入口地址，确认域名或服务器端口可访问。
2. 用最终入口地址制作二维码供宾客扫描；建议使用 HTTPS 域名。
3. 昵称可以留空；在大厅填写后，两个游戏会自动带入。
4. 游戏切到后台会自动暂停，回到页面点击继续；也可以手动暂停、开关音效。
5. 最高分保存在当前浏览器，不是全场排行榜。换手机、换浏览器或清理浏览器数据后不会同步。浏览器禁用存储时仍可玩，但不能可靠保留昵称和成绩。

## 文件结构

```text
public/                          网站源码与素材（可直接静态托管）
  index.html                     大厅页面
  styles.css / home.js            大厅样式与交互
  assets/                        公共图标
  shared/guest.js                 共享昵称与本机成绩
  jump-jump/                     跳一跳页面、逻辑、样式与素材
  vine-boss-shooter/              BOSS 战页面、逻辑、样式与素材
tests/                           两个游戏与共享存储的回归测试
scripts/                         构建与本地预览脚本
deploy/nginx.conf                Nginx 配置
Dockerfile / compose.yaml        Docker 部署
package.json                     开发、测试与构建命令
dist/                            自动生成的发布目录，不手工修改
```

所有网页文件统一维护在 `public/`，各游戏使用 `index.html`、`game.css`、`game.js` 和 `assets/`。新增网页资源无需修改构建文件清单；构建会把 `public/` 完整复制到 `dist/`，排除隐藏文件。测试、构建脚本和部署配置不会发布。

旧单文件页面、重复测试、截图、备份和临时压缩包已清理。两个游戏统一使用上方的目录地址访问。

## 检查

```sh
npm test
npm run build
```

测试覆盖真实游戏脚本中的蓄力、落地、计分、胜负、暂停和输入状态，以及共享昵称和成绩存储。手机浏览器、尤其微信内置浏览器的实际设备体验，建议在活动前使用最终域名再确认一次。
