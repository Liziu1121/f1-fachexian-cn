# F1 发车线镜像

发布工作流从原站拉取页面、资源和公开数据，再把「比赛实况」接入生成的网站。实况源码在 `live/`，构建脚本在 `scripts/`。

## 本地预览

需要 Python 3.10+ 和 Node.js 22+。在仓库根目录运行：

```sh
python scripts/build-mirror.py
node scripts/build-live.mjs
python -m http.server 4175 --bind 127.0.0.1 --directory public
```

打开 [比赛实况](http://127.0.0.1:4175/#/live)。重新构建时先运行镜像脚本，刷新原站文件后再接入实况页。

## 实况数据

- TELOS 在浏览器里更新计时、分段、估算车位和赛会提示。Formuradar 提供排位差距和淘汰区，Paddock Live 提供公开电台转写入口。
- 新闻、FIA 公告及 OpenF1 历史计时、电台与赛会消息以静态 JSON 随网站发布。构建沿用现有的四小时调度。OpenF1 暂停匿名访问时，使用镜像已有赛程和上次成功缓存的近期档案。
- GitHub Pages 部署由 `main` 的发布流程负责。实况页使用相对路径，支持仓库子路径下访问。
