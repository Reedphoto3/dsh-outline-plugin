# dsh-outline-plugin

为 DeepSeek Harness Web UI 增加右侧大纲面板，可在聊天时维护待办、笔记和图片附件。

## 安装

要求 DeepSeek Harness `0.1.0-rc.5` 或兼容版本。建议固定到已审核提交：

```sh
dsh plugin --profile web add github:Reedphoto3/dsh-outline-plugin#<commit-sha>
```

重启 `dsh --profile web` 后生效。仓库已提交浏览器构建产物，Git 安装不执行 `prepare` 脚本。

卸载：

```sh
dsh plugin --profile web remove dsh-outline-plugin
```

## 功能

- 会话页头的“笔记”按钮打开右侧面板。
- 待办、笔记、附件三种视角；支持嵌套、折叠、拖拽排序。
- 单击文本编辑；`Enter` 新建同级项；`Shift+Enter` 换行。
- `Tab` / `Shift+Tab` 缩进或减少缩进。
- `Cmd+↑/↓` 移动；Windows/Linux 使用 `Ctrl+↑/↓`。
- `Alt+Cmd+8/9` 将当前项切换为待办或笔记；Windows/Linux 使用 `Alt+Ctrl+8/9`。
- 粘贴图片时缩放并去重；移除图片后，下次保存会清理未引用数据。
- 可选 Markdown 同步导出；相对路径基于 DSH 文件系统工作目录。

## 重要限制

该插件占用 DSH 的单一 `details` 插槽，因此会替换内置工具调用详情面板。停用或卸载插件即可恢复内置详情面板。

Host RPC 仅允许本机回环页面调用，远程 LAN Web 客户端不能读写大纲。

## 数据与隐私

默认数据文件是工作区根目录的 `.dsh-outline.json`。它包含会话 ID、笔记文本和粘贴图片的 base64 数据，不应提交到 Git。请在使用插件的工作区忽略该文件：

```gitignore
.dsh-outline.json
```

Markdown 导出文件也可能包含内联 base64 图片；公开或同步前应单独检查。

若 `.dsh-outline.json` 损坏或不可读，插件会显示加载失败，不会把它当作空文件覆盖。

## 开发

```sh
pnpm install
pnpm test
pnpm run check
```

`src/client.js` 是浏览器源码；`pnpm run build` 生成并提交 `lib/client.js`。

## 许可证

MIT
