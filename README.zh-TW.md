# Unprose

**和你的 AI agent 在同一張 board 上討論設計，而不是來回貼一大段文字。**

[English](README.md) · 支援 Claude Code、Codex 和任何 MCP agent · Apache-2.0

![在 board 上針對某個項目提問，agent 在對話串回覆並更新圖](docs/images/demo.gif)

## 為什麼

- 長篇文字很難對齊：你沒辦法指著某一句說「就是這裡」。
- 在 board 上可以。選一個方塊、幾行檔案，或整張圖，直接問。
- Agent 負責修改 repo 裡的設計檔，要不要改由你決定。

## 5 分鐘試用

需要 **Node.js 20+**、**git**，以及 **Claude Code**（其他 agent 見下方）。

```bash
git clone https://github.com/river0825/unprose && cd unprose
node scripts/canvas.mjs       # board 會開在 http://localhost:4400（專案的 board 存在 <專案>/.unprose/boards）
```

讓它繼續跑著。在另一個終端機把 Claude Code 連到 board：

```bash
claude mcp add awd-canvas -e AWD_CANVAS_URL=http://localhost:4400 -- node "$PWD/scripts/mcp.mjs"
```

這樣就好了。在任何專案打開 Claude Code，照著下面的「第一次使用」做。

<details>
<summary><b>其他連接方式</b>（Claude Code plugin、Codex、其他 MCP client）</summary>

- **Claude Code plugin**（會一併加入 Unprose skill）：
  ```
  /plugin marketplace add river0825/unprose
  /plugin install unprose@unprose
  ```
  裝好就能用，而且會自己維護：每次開始 session 時，它會確認執行檔存在（安裝的副本裡沒有時，會從 GitHub release
  下載這個版本的），並確認 `http://localhost:4400` 有 canvas 在跑——沒有就幫你啟動，**`/plugin` 更新後會用新版本
  重啟**。你從別處（例如原始碼 checkout）自己啟動的 canvas，或遠端的 canvas（`AWD_CANVAS_URL`）一律不動，版本不同時只會提示一行。
  不想自動啟動，在 `/config` 關掉 plugin 選項 `canvas_autostart`（或設 `AWD_CANVAS_AUTOSTART=0`）；要連到別的 canvas，設 `canvas_url` 選項。
- **Codex**：加到 `~/.codex/config.toml`，並把 [AGENTS.md](AGENTS.md) 複製到你的專案：
  ```toml
  [mcp_servers.awd-canvas]
  command = "node"
  args = ["/path/to/unprose/scripts/mcp.mjs"]
  env = { AWD_CANVAS_URL = "http://localhost:4400" }
  ```
- **任何 MCP client**：stdio server，指令 `node`，參數 `/path/to/unprose/scripts/mcp.mjs`，
  環境變數 `AWD_CANVAS_URL=http://localhost:4400`。

細節與注意事項：[docs/agents-setup.md](docs/agents-setup.md)。
</details>

## 第一次使用

**1. 請 agent 畫一張圖。**

> 在 Unprose 上畫一張我們註冊流程的 EventStorming。

Agent 會在你的 repo 寫出 `design/signup.es.yaml`，並畫到 board 上。

**2. 打開 board。** 到 <http://localhost:4400>，選 agent 建立的那張 board。
Event、command、system、policy 依時間由左到右排列。

![註冊流程的 EventStorming board](docs/images/step2-board.png)

**3. 針對一個項目提問。** 點選一個方塊，打開 **Chat** 分頁，輸入問題，按 **Ask AI**。

![選取「Send verification email」並在 Chat 分頁提問](docs/images/step3-comment.png)

**4. Agent 回覆並修改檔案。** 回答會出現在同一個對話串。討論定案後，agent 會更新
`design/signup.es.yaml`，board 隨之重畫。這裡它加上了 **Resend email**。

![Agent 在對話串的回覆，以及 board 上新增的「Resend email」command](docs/images/step4-reply.png)

每則訊息都會顯示目前狀態：**Sent**、**Seen by agent**、**Agent is working…** 或 **Needs you**。

![一個問題下方顯示「Agent is working…」](docs/images/receipts.png)

## 支援的圖

每張圖是 `design/` 裡的一個檔案。多張圖可以放在同一張 board，彼此連結。

| 圖 | 用來 | 檔案 | 預覽 |
|---|---|---|---|
| EventStorming | 一步步討論系統怎麼運作 | `design/<name>.es.yaml` | <img src="docs/images/thumb-es.png" width="260" alt="EventStorming"> |
| Story map | 決定先做什麼（release 切線） | `design/<name>.story-map.yaml` | <img src="docs/images/thumb-story-map.png" width="150" alt="Story map"> |
| Domain Storytelling | 用圖示句子講一個具體情境（可與 [Egon.io](https://egon.io) 匯入／匯出） | `design/<name>.domain-story.yaml` | <img src="docs/images/thumb-domain-story.png" width="260" alt="Domain Storytelling"> |
| Kanban | 追蹤工作進度 | `design/<name>.kanban.yaml` | <img src="docs/images/thumb-kanban.png" width="260" alt="Kanban"> |
| Wireframe | 畫出畫面草稿 | `design/<name>.wireframe.yaml` | <img src="docs/images/thumb-wireframe.png" width="260" alt="Wireframe"> |
| Workflow | 描述一條可以執行的 agent 流程 | `<name>.workflow.yaml` | <img src="docs/images/thumb-workflow.png" width="260" alt="Workflow"> |

同一套概念的其他畫面：

| | |
|---|---|
| ![Inspector](docs/images/inspector.png) | ![提案中的連線修改](docs/images/wire-proposal.png) |
| **Inspector**：一個步驟的所有資訊：誰負責、prompt、有哪些結果。 | **提案**：拖動一條線；agent 會先和你討論，再修改檔案。 |

![有語法高亮、在第 13–15 行留言的原始檔視窗](docs/images/source-dialog.png)
**在任何幾行留言**，不論是檔案還是 prompt，都能在有語法高亮的大視窗裡進行。

## 運作方式

```
  design/*.yaml  ──畫出──▶  board  ──你留言──▶  agent
        ▲                                         │
        └────────────── 修改檔案 ◀─────────────────┘
```

1. **檔案是唯一的真相。** Board 是從 repo 裡的檔案畫出來的，每次修改都是一般的 git diff。
2. **Agent 修改，你下指導棋。** 你提問、做決定，agent 負責動手。
3. **在 board 上的修改都是提案。** 拖動的線、改過的某幾行，都要等你同意。
4. **你的排版會保留。** 重畫時，你排好的位置不會被打亂。

## 名詞

| 名詞 | 意思 |
|---|---|
| **Board** | Canvas 上的一個頁面，可以放多張圖。 |
| **Diagram frame** | Board 上的一張圖，由一個檔案畫出來。 |
| **Trace** | 圖與圖之間的虛線連結，例如「這張 story 來自那個 command」。 |
| **Proposal（提案）** | 你在 board 上做的修改，還沒寫進檔案。 |
| **Studio** | 選用功能。讓每張 board 有自己的 agent session，一般留言也會有人回覆。見 [docs/studio.md](docs/studio.md)。 |
| **herdr** | Studio 用來在 pane 中執行 agent session 的終端機工作區。[herdr.dev](https://herdr.dev) |
| **awd** | 命令列工具：`node scripts/awd.mjs design draw …`、`lint`、`run`、`studio`。 |

## 目前狀態

仍在早期，變動很快。目前可用：EventStorming、story map、kanban、wireframe 和 workflow 都以檔案保存；
可以針對項目、選取範圍、某幾行或整張 board 聊天；提案；已讀狀態；Studio。
接下來：更多種類的圖、Trello / Jira / Linear 同步、共享 board 的登入、託管版本。

延伸閱讀（英文）：[diagrams](docs/diagrams.md) · [studio](docs/studio.md) · [canvas API](docs/canvas.md) ·
[workflow format](docs/workflow.md) · [architecture](docs/ARCHITECTURE.md)。

## 更新

canvas 左下角的版本號會提示有新版：出現 **update**，打開 release notes 就能看到新版內容和 **Upgrade** 按鈕。
Upgrade 會依你的安裝方式執行對應的指令（`claude plugin update unprose@unprose`、`git pull` 加 build，或下載新的
runtime），再用新版重新啟動 canvas，頁面會自動重新連線。只有在 canvas 所在的那台機器上開的頁面（`http://localhost…`）
才能按；透過 tunnel 開的頁面會改顯示要自己執行的指令。細節見 [docs/canvas.md → Updating](docs/canvas.md#updating)。

## 安全

Board **目前沒有登入機制**，任何連得到的人都能讀取和修改。請只在 `localhost` 使用，
或在分享前加上存取代理（access proxy）。

## 授權

[Apache-2.0](LICENSE)
