# 操作手冊

這份是「要做某件事時翻哪裡」的手冊，不解釋為什麼（為什麼在 [架構說明](ARCHITECTURE.md)）。每一節都是一個任務，指令可以直接複製。

- 系統有兩半：**`awd`**（workflow runtime，事件進來 → script / AI agent / gate / 等人 → 事件出去）和 **`awd-canvas`**（你和 agent 共用的白板）。
- 線上位址：白板 <https://canvas.example.com>、文件 <https://canvas.example.com/docs>、workflow webhook <https://awd.example.com>。
- 本機：白板 `http://localhost:4400`、範例 workflow `http://localhost:4311`、本 repo 自己的開發流程（§7）`http://localhost:4313`（不在 tunnel 後面）。

整體長這樣（深色、可匯出 PNG / PDF）：[系統全景圖](diagrams/system-architecture.html)。

---

## 1 · 啟動與停止

### 一次起兩個服務（開發用）

```bash
cd ~/Documents/agent-workflow-diagram
npm install && npm run build      # 第一次，或改了程式之後
npm start                         # canvas :4400 + 範例 workflow :4311，Ctrl-C 一起停
npm run demo                      # 建 6 個示範 board + 把 workflow.yaml 畫到白板
```

環境變數：`CANVAS_PORT`、`AWD_PORT`、`AWD_WORKER`（預設 `fake`，不呼叫模型）。

### 常駐（launchd + Cloudflare tunnel）

三個 plist 在 `deploy/`：`dev.unprose.awd-canvas`、`dev.unprose.awd-workflow`、`dev.unprose.cloudflared-awd`。**這一步要在你自己的終端跑**（Claude Code 的 shell 接不到 launchd 的 GUI domain）：

```bash
# 先停掉手動起的背景程序，避免 port 衝突
pkill -f 'canvas/dist/cli.js serve'; pkill -f 'bin/awd.js run'; pkill -f cloudflared-awd.yaml
for s in awd-canvas awd-workflow cloudflared-awd; do
  cp ~/Documents/agent-workflow-diagram/deploy/dev.unprose.$s.plist ~/Library/LaunchAgents/
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.unprose.$s.plist
done
launchctl list | grep you        # 三個都在就對了
```

| 動作 | 指令 |
|---|---|
| 看 log | `tail -f ~/Library/Logs/awd/{canvas,workflow,cloudflared}-std*.log` |
| 重啟一個 | `launchctl kickstart -k gui/$(id -u)/dev.unprose.awd-canvas` |
| 停掉一個 | `launchctl bootout gui/$(id -u)/dev.unprose.awd-canvas` |
| 改完程式重新上線 | `npm run build` 然後 kickstart 兩個 awd 服務（tunnel 不用動） |

Tunnel `awd` 的設定在 `deploy/cloudflared-awd.yaml`；加新 hostname：改那個檔 + `cloudflared tunnel route dns awd <name>.example.com` + kickstart tunnel。

> `canvas.example.com` 本身沒有登入機制。對外開之前請在 Cloudflare Zero Trust → Access 加一條只允許你 email 的 policy。

![部署：三個 launchd 服務、tunnel、herdr socket，與對外的兩個 hostname](diagrams/deployment.svg)

---

## 2 · 白板：和 agent 對齊想法

### 2.1 讓 Claude Code 畫圖給你看

這個 repo 的 `.mcp.json` 已註冊 `awd-canvas` MCP server（重開 Claude Code session 一次才會載入）。之後直接說：

> 把 card pipeline 的 Ready → In Progress 這段畫成 process-level 的 event storming，然後等我回饋。

agent 會：`canvas_create_board` 畫圖 → 自動開瀏覽器 → `canvas_wait` 等你。白板右上角會顯示 **Agent is watching**。

你改完後兩種方式把球丟回去：
- 停手 2.5 秒（agent 自動收到你改了什麼的摘要），或
- 按 **Hand to agent**（立刻回，適合改很多步的時候）。

agent 收到的是像這樣的摘要，不是截圖：

```
[7 user] event "PR marked ready" [es.event.pr-marked-ready-…]: moved from Worker → Coordinator
[8 user] added comment on command "Qualify card" [es.command.qualify-card-…]: "who decides the size when it is missing?"
```

它回覆時通常會在你的 comment 旁邊貼一張 comment（左側紫色條 = agent、綠色條 = 你）。

![對齊迴圈：agent 畫圖 → 你改 → 安靜 2.5 s 或 Hand to agent → agent 讀變更清單 → 回覆](diagrams/alignment-loop.svg)

### 2.2 agent 可用的 MCP 工具（你要它做什麼時可以直接點名）

| 工具 | 用途 |
|---|---|
| `canvas_create_board` | 從結構化內容畫一張新圖（七種：event-storming / user-story-map / user-journey / wireframe / workflow / kanban / freeform）並開瀏覽器 |
| `canvas_add_items` | 在既有 board 上再畫一塊；同樣內容重畫會原地更新，不會疊兩份 |
| `canvas_read_board` | 讀 board：`outline` 是精簡文字版（給模型看的），`json` 是原始項目 |
| `canvas_wait` | 等你改東西（安靜 2.5 s 或按 Hand to agent 才回）；預設只被「有意義」的改動叫醒（留言、新增、刪除、改名、連線），純搬動會摺成一行 `moved N items` 一起回 |
| `canvas_diff` | 列出某個 seq 之後的所有變更，一行一件；kanban 上拖卡片會是 `card "…" [id]: moved from A → B` |
| `canvas_apply` | 精準改單一項目（改字、改色、搬、刪） |
| `canvas_list_boards` / `canvas_open` | 列出、打開 |

不透過 Claude Code 也能用：`awd-canvas outline <boardId>`、`awd-canvas diff <boardId> <since>`，或直接打 HTTP API（見 [canvas.md](canvas.md)）。

### 2.3 白板操作

| 想做 | 怎麼做 |
|---|---|
| 加便利貼 | 空白處**雙擊**（游標處直接進入編輯）；或左側工具列 / `S` |
| 選顏色 | 左側第一個按鈕上的小方塊 → 十個顏色（event 橘、command 藍、actor 黃、policy 紫、read model 綠、external 粉、hotspot 紅…） |
| 改字 | 雙擊便利貼；`Enter` 存、`Shift Enter` 換行、`⌘ Enter` 存並在下面接一張、`Esc` 取消 |
| 搬 | 拖；拖進 lane / frame 就會歸屬到它。方向鍵微調 10 px（Shift 50 px） |
| 連線 | 從一張的邊拖到另一張 |
| 留言給 agent | 右鍵便利貼 → **Add comment**；或 **Ask agent**（留言 + 立刻 Hand to agent） |
| 複製 / 刪除 | `⌘ D` / `Delete`（可 `⌘ Z` 復原，所以不會問你確不確定） |
| 復原 / 重做 | `⌘ Z` / `⌘ ⇧ Z`（只復原你自己的改動；agent 之後改過的項目會跳過並提示） |
| 改 board 標題 | 點 header 的標題 |
| 看 agent 改了什麼 | 右側 **Changes**；篩 All / Agent / You；agent 的批次有 **locate** 可定位 |
| 看某個項目的討論 | 點選它 → 右側 **Selected**（有 Copy link，連結帶 `?focus=<id>` 可直接指到那張） |
| 快捷鍵表 | `?` |
| 整張看全 | `1` |

### 2.4 從 workflow.yaml 直接畫流程圖

```bash
npx awd graph examples/card-pipeline/workflow.yaml --canvas     # 建立或原地更新「<name> — workflow.yaml」這張 board，並記下 runtime 位址
npx awd graph examples/card-pipeline/workflow.yaml --canvas --runtime http://localhost:4311   # runtime 不在預設位址時
npx awd graph examples/card-pipeline/workflow.yaml              # 只要 mermaid 文字
```

改了 yaml 再跑一次，同一張 board 更新，你在上面加的 comment 都還在。這張 board 同時就是執行監控畫面（§3.6），最上方的 **Agents** frame 列出每個 agent（model · runner、負責的 step、委派虛線）。

### 2.5 Kanban：看板，也是事件來源

canvas 有一種 `kanban` board：直欄是 column（可設 WIP），卡片有 title / labels / size / assignee / description。它做兩件事：

- **看工作狀況**：每欄顯示 `已用/WIP`，超過會標 `over`；拖卡片就是換欄。
- **當事件來源**（取代 Trello）：你拖一張卡，change log 裡就多一筆 `card "<title>" [<id>]: moved from A → B`；workflow 用 `on: board` trigger 訂閱它（§3.7）。流程反過來推卡片時用 `author: agent`，不會再變成事件。

```bash
npx awd-canvas card add <boardId> Backlog "Fold comment threads" --size M --label canvas   # 新卡片（到欄底）
npx awd-canvas card move <boardId> <cardId> "In Progress"                                 # 搬（和你拖一樣會進 log）
npx awd-canvas card moves <boardId> [since]                                                # 列出 seq 之後的換欄
```

同樣的事也能用 MCP（`canvas_create_board kind: kanban`，內容 `{ columns: [{ name, wip? }], cards: [{ title, column, size?, labels? }] }`）或 HTTP（`GET /api/boards/:id/cards?since=N`、`POST /api/boards/:id/cards`、`POST /api/boards/:id/cards/:cardId/move`）做。慣例：**人只動三個欄位**（拖進 Planning / Ready / Done），其他換欄都由流程做——§7 就是這樣運作的。

---

## 3 · Workflow：寫一條流程

一個事件進來之後 runtime 做的事，就這一圈：

![一個 tick：trigger → event store → reducer（純函數）→ commands → script / AI / human / timer → 事件回到 store](diagrams/event-loop.svg)

### 3.1 最小可跑的例子

```yaml
name: hello
triggers:
  go: { on: cli, emit: ping }          # awd emit … ping
steps:
  greet:
    on: ping
    run: echo '{"outcome":"done","data":{"msg":"hi {{ event.data.name }}"}}'
    terminal: [done]
```

```bash
npx awd lint  hello.yaml
npx awd run   hello.yaml --store-dir /tmp/hello &
npx awd emit  hello.yaml ping --data '{"name":"river"}' --store-dir /tmp/hello
npx awd status hello.yaml --store-dir /tmp/hello
```

### 3.2 四種 step

| 種類 | 寫法 | 什麼時候用 |
|---|---|---|
| **script** | `run: python3 scripts/x.py --card {{ key }}` | 能用程式判斷的都用這個。stdin 收事件 JSON，stdout 最後一行 JSON `{ "outcome": "...", "data": {...} }`；exit ≠ 0 → `<step>.failed` |
| **ai** | `ai: { agent: planner, input: {...}, output: <JSON schema> }` | 需要判斷的。模型只看得到 `input`，一定要回符合 `output` schema 的 JSON，`outcome` 欄位決定走哪條線 |
| **gate** | `gate: { outcomes: { build: "vars.qualify.size in ['XS','S']", split: "..." }, default: split }` | 純條件分支，跑在 reducer 裡，不做 IO |
| **human** | `human: { resume_on: card.moved, outcomes: { approved: "event.data.to == 'Ready'" } , timeout: 7d }` | 等人。人的動作以事件進來（webhook、`awd emit`），符合條件就往下走 |

每個 step 用 `on:` 接事件（trigger 的 `emit`、或 `<step>.<outcome>`、`<step>.failed`、`<step>.timeout`），可加 `if:`。`on: "*.failed"` / `"*.timeout"` 是萬用字元：任何**其他** step 失敗都會觸發（§4.5 的反省就靠它）。`retry: { max: 2, backoff: 5m }`、`timeout: 2h` 都在 step 上。

模板與條件式只認 `event`、`vars.<step>`、`key`、`env`、`now`（trigger 裡另有 `body / query / headers`）；沒有 shell 變數，沒有 eval。

### 3.3 一張卡一條線：`key`

```yaml
key: "{{ event.data.card }}"     # 同一張卡的事件進同一個 run
concurrency: 1                   # 一張卡同時只有一個 step 在跑（要平行就調大）
```

### 3.4 常用指令

```bash
npx awd lint    wf.yaml                    # 死引用、沒人接的 outcome、不合法 id、agent 設定…
npx awd test    wf.yaml                    # 跑 tests/*.golden.yaml，不呼叫模型
npx awd run     wf.yaml --worker fake      # fake：AI 回 fixtures/ai/<agent>.json；換 claude-code 就真跑
npx awd emit    wf.yaml <event.type> --data '{...}' [--key K]
npx awd status  wf.yaml [key] [--json]     # 每個 run 走到哪、卡在誰
npx awd replay  wf.yaml                    # 把 event log 餵回 reducer，印每個事件產生的 command
npx awd agents  wf.yaml                    # 誰負責哪些 step、用什麼 runner / model / tools
npx awd memory  wf.yaml [agent] [--forget <id>]   # agent 學到的長期記憶（memory.learned 事件的投影）
npx awd reflect wf.yaml [--since 7d] [--to-board "title:<kanban>"]   # 失敗 + 反省訊號 → pattern → 卡片
npx awd run     wf.yaml --store memory     # event log 只放 RAM（demo / 測試）；預設 file → <store-dir>/events.ndjson
```

事件記錄在 `<store-dir>/events.ndjson`（預設 `.awd/`），是唯一的真相；`status` 和 `replay` 都從它算出來。

`awd status` 印出來的狀態就是這台狀態機的位置（每個 key 一台）：

![一個 run 的狀態：idle → running → waiting（等人）→ done / failed；retry 與 concurrency 排隊都在圖上](diagrams/run-states.svg)

### 3.5 Golden test：不叫模型就能驗證流程

```yaml
# tests/02-xl-split.golden.yaml（範例，實際檔案的 expect 略有不同）
mode: run                       # run = 真的跑 engine（script 真跑、AI 用 fixtures）；replay = 只跑 reducer
key: c-xl
events:
  - { type: card.moved, data: { card: c-xl, from: Backlog, to: Ready } }
expect:
  status: done
  outcomes: [qualify.pick, size-gate.split, split.done]
  vars: { qualify: { size: XL } }
  commands:
    - { kind: run_script, step: qualify }
```

`outcomes` 是順序比對的子序列；字串前面加 `~` 表示「包含」。fixtures 放 `fixtures/ai/<agent>.json`（或 `<agent>/<key>.json`；陣列會依序消耗，適合「第一次回 findings、第二次回 clean」）。

**每次出事故，加的是一個 golden、一個 gate 或一條 lint 規則，不是一段散文。**

---

### 3.6 看 run 在跑（像 n8n 那樣）

`awd run` 起來後，打開 `awd graph --canvas` 畫出來的 workflow board，就會看到執行狀態疊在流程圖上（不會改到 board 本身）：

| 看到 | 意思 |
|---|---|
| step 卡片右上角 `● running` | 有 run 正在跑這個 step（藍色閃爍） |
| `⧗ waiting for a person` | human step 在等人（橘色） |
| `✓ done` / `✕ failed` | 這個 step 最近一次的結果 |
| `×3` | 三個 run 同時停在這一步 |
| agent 卡片 `● planner · c-arch · plan` | 這個 agent 正在替哪個 run 做哪一步；`○ idle` 沒事 |

下方抽屜：**Runs**（每個 key 的狀態、目前 step、agent、多久前；點一列只看它）、**Events**（即時事件流，點一筆看 data）。標題列顯示 `live · N runs` 或 `runtime offline`。

資料來源是 runtime 的 `GET /api/stream`（SSE）；連不上會退回每 2 秒輪詢 `/api/status`。board 網址加 `?run=http://別的主機:4311` 可以指到另一個 runtime。

想看它動：
```bash
npx awd run  examples/card-pipeline/workflow.yaml --worker fake --port 4311 &
npx awd graph examples/card-pipeline/workflow.yaml --canvas
npx awd emit examples/card-pipeline/workflow.yaml card.moved --data '{"card":"demo1","name":"Demo","from":"Backlog","to":"Ready"}'
```

### 3.7 用 Kanban 取代 Trello 當事件來源

`workflow.yaml` 裡有一段註解掉的 `kanban:` trigger（`on: board`）。canvas 上有一張 kanban board 時（`npm run demo` 會建一張「Card pipeline — Kanban」），把它打開：

```yaml
kanban:
  on: board
  board: "title:Card pipeline — Kanban"     # 或 board id
  canvas: http://localhost:4400             # 預設 AWD_CANVAS_URL
  author: user                              # 只算人拖的；agent | all 也可以
  emit: card.moved
  data: { card: "{{ card.id }}", name: "{{ card.title }}", from: "{{ from }}", to: "{{ to }}" }
```

`data:` 的模板只認 `card`（`{ id, title, labels, size, assignee, description }`）、`from`、`to`、`author`、`seq`、`env`、`now`。runtime 記住最後看到的 board `seq`，重啟不會把舊的拖動重播一次。

你在 board 上把卡片拖到 Ready，`awd status` 就會多一個 run。反方向——step 做完把卡片推到下一欄——用 `scripts/board_move.sh <boardId> <cardId> "<column>"` 當一個 script step。agent 自己推的卡不會再變成事件（`author: user` 是預設）。

## 4 · 多個 AI agent 各管一個階段

### 4.1 定義 agent

```yaml
agents:
  planner:
    description: 把卡片變成 build worker 不用問就能做的計畫
    file: roles/planner.md          # 或 system: |  直接寫
    model: opus                     # opus | sonnet | haiku | 完整 model id
    effort: high
    tools: [Read, Grep, Glob]
  reviewer:
    file: roles/reviewer.md
    model: sonnet
    delegates: [architect]          # 它可以把工作交給誰（lint 會檢查）
    memory: { recall: 10 }          # 預設 true：短期（這個 run）+ 長期（這個專案）都開；false 全關
  builder:
    file: agents/builder.md
    claudeCode:                     # 只有 runner claude-code 認得
      permissionMode: acceptEdits   # default | plan | acceptEdits | bypassPermissions
      cwd: "{{ vars.worktree.path }}"   # 可用模板；agent 在這裡跑 `claude -p`
      addDirs: [../shared]          # --add-dir
```

也可以放 `agents/<name>.md`（frontmatter + 正文），格式和 Claude Code 的 `.claude/agents/*.md` 一樣，可以直接搬過來。

step 用 `ai: { agent: planner, ... }` 指名。**委派是事件**：reviewer 回 `outcome: needs-architect`，`architect-review` step 用 `on: review.needs-architect` 接手——圖上看得到，也能寫 golden。

### 4.2 讓不同工具跑不同階段（runner）

| runner | 設定 | 說明 |
|---|---|---|
| `claude-code`（預設） | 不用設 | `claude -p --json-schema`，用你的 Claude 登入 |
| `anthropic` | 需要 `ANTHROPIC_API_KEY` | 純 API，structured output |
| `cli` | `cli: { preset: codex }` 或 `cli: { command: "my-agent --model {{ model }} -", stdin: true }` | 任何有 headless 模式的 CLI；stdout 抓最後一個 JSON |
| `herdr` | `herdr: { kind: codex \| opencode \| claude \| gemini \| agy …, name?: awd-qa, timeoutMs: 15m }` | 互動式 agent 住在 herdr pane 裡；**不需要 A2A** |
| `fake` | `--worker fake` 強制全部 | 測試、demo |

`awd run --worker X` 是預設 runner，每個 agent 的 `runner:` 可以各自覆蓋；`--worker fake` 蓋過所有。

### 4.3 herdr runner 實際會發生什麼

1. `herdr agent list` 找同名 agent（預設 `awd-<agent>`）；沒有就在你目前 pane 右邊 split 一個新 pane、`herdr agent start`，等它 `interactive_ready`。
2. 把 system prompt、input、schema 寫進 `<store>/mail/<cmd>.in.json`。
3. 送**一行** prompt：「讀那個檔、做事、把答案寫進 `<cmd>.out.json`、回 DONE」。
4. 每 0.5 s 看 `.out.json`；一出現、通過 schema 就收（不等 TUI 說 done）。
5. agent 跳核准框（`blocked`）→ **awd 不代答**，`<step>.failed reason=agent_blocked`。你到那個 pane 處理完，run 的 retry 會重送。

![herdr 信箱協定：一個 prompt、兩個 JSON 檔；答案檔是合約，TUI 狀態只是提示](diagrams/herdr-mailbox.svg)

pane 會留著，這是刻意的：你看得到 agent 在幹嘛，也能直接插手。試一次：

```bash
npx awd run  examples/herdr-smoke/workflow.yaml --worker claude-code --store-dir /tmp/awd-herdr &
npx awd emit examples/herdr-smoke/workflow.yaml ping --data '{"q":"What is 6*7? Reply with just the number."}' --store-dir /tmp/awd-herdr
npx awd status examples/herdr-smoke/workflow.yaml --store-dir /tmp/awd-herdr     # ask(codex) → check(opencode)
```

### 4.4 記憶：短期在 run 裡，長期在專案裡

agent 回答時可以多帶兩個欄位（schema 不用宣告）：`remember: {…}` 只在**這張卡的 run** 裡記得（進 `state.memory.short`，replay 會重現），`learn: [{ note, tags }]` 變成 **`memory.learned` 事件**，下次同一個 agent 被叫到時 runtime 先召回（同 key 優先、再新到舊，`memory.recall` 條）放進 system prompt。細節與召回規則在 [agents.md §7](agents.md)。

```bash
npx awd memory dev/workflow.yaml --store-dir .awd-dev            # 每個 agent 學過什麼
npx awd memory dev/workflow.yaml planner --forget <id>           # 不再召回（事件留在 log）
```

### 4.5 反省：失敗與 `reflect` 變成卡片

三種 signal 自動進 log：任何 `<step>.failed` / `<step>.timeout`、agent 答案裡的 `reflect: [{ note, kind: friction|bug|idea|rule, tags }]`、script JSON 裡的 `reflect`。`awd reflect` 把它們投影成 pattern（同一步同一類原因算一組），`--to-board` 每個過門檻（≥2 次或任何 `rule`）的 pattern 開**一張** kanban 卡，帶「建議的 guard」（加哪個 golden、變哪條 lint），重跑只更新不重複。全文在 [reflection.md](reflection.md)。

```bash
npx awd reflect examples/card-pipeline/workflow.yaml --since 7d
npx awd reflect examples/card-pipeline/workflow.yaml --to-board "title:Card pipeline — Kanban" --column Backlog
```

要自動化就加一個聽 `*.failed` 的 script step 去呼叫它（範例的 `reflect-failure` step、`scripts/reflect_to_board.sh`）。

---

## 5 · 接真的外部系統

### Trello（或任何 webhook）

trigger 已經寫好：`POST https://awd.example.com/hooks/trello`。到 Trello 註冊 webhook 指向它即可；`if:` 會把不是「換欄位」的動作丟掉，`data:` 把 payload 正規化成 `{ card, name, from, to }`。測試不用 Trello：

```bash
curl -s -X POST localhost:4311/hooks/trello -H 'content-type: application/json' \
  -d '{"action":{"type":"updateCard","data":{"card":{"shortLink":"abc1","name":"Upload contacts"},"listBefore":{"name":"Backlog"},"listAfter":{"name":"Ready"}}}}'
curl -s localhost:4311/api/status
```

### 換掉某個東西時改哪裡

![Clean architecture：driving adapters → application → domain（零 IO）← ports ← driven adapters；箭頭永遠指向內](diagrams/ports-adapters.svg)

| 要換 | 改哪裡 |
|---|---|
| 看板 Trello → Linear / Jira | 只改 trigger 的 `data:` 和 script step 的腳本，程式碼不動 |
| 模型 / 工具（Claude → codex） | agent 的 `runner:` |
| agent 溝通通道（herdr → tmux） | `packages/runtime/src/adapters/channels/` 加一個 `AgentChannel` adapter |
| 事件儲存（檔案 → sqlite） | `packages/runtime/src/adapters/store/` 加一個 `EventStore` adapter |
| 白板儲存 | `packages/canvas/src/adapters/boards/` 加一個 `BoardRepository` adapter |
| 長期記憶（檔案 → 向量庫） | `packages/runtime/src/adapters/memory/` 加一個 `MemoryStore` adapter |
| 事件來源（Kanban → Linear） | `packages/runtime/src/adapters/triggers/` 加一個 `TriggerSource`（canvasTrigger.ts 是範本） |

完整清單在 [架構說明 §4](ARCHITECTURE.md)。

---

## 6 · 出問題時

| 現象 | 看哪裡 / 怎麼辦 |
|---|---|
| Claude Code 沒有 `canvas_*` 工具 | 重開 session；`.mcp.json` 要在 repo 根目錄；canvas server 要先在跑（`AWD_CANVAS_URL`，預設 :4400） |
| 白板顯示 offline | server 沒起：`lsof -i :4400`；log 在 `~/Library/Logs/awd/canvas-stderr.log` |
| agent 對半成品反應 | 它用的是舊版 `canvas_wait`；確認 `quietSec` 沒被設成 0 |
| `awd run` 起不來 | 先 `awd lint`；`--store-dir` 目錄要可寫 |
| AI step 一直 `failed` | `awd status <key>` 看 reason：schema 不符（模型沒回 `outcome`）、`agent_blocked`（去 pane 按核准）、`agent_busy`（上一輪還在跑） |
| herdr runner 卡住 | `herdr agent list` 看那個 agent 的狀態；`herdr agent read awd-<agent>` 看它畫面；信箱在 `<store>/mail/` |
| 想從頭來 | 刪 `<store-dir>/events.ndjson`（那就是全部狀態）；白板刪 `boards/<id>.json` + `.changes.ndjson` |
| 看流程有沒有走錯 | `awd replay wf.yaml --key <key>` 一步一步印出每個事件產生的 command |
| Kanban header 一直顯示「Agent is watching」 | 不是 bug：`on: board` trigger 用 long-poll 訂閱那張 board，server 因此把 runtime 算成 watcher。要知道真的 agent 在不在看，看 workflow board 的 overlay |
| `merge.sh` 拒絕合併 | 主 checkout 有未 commit 的**已追蹤**變更；先 commit（未追蹤檔不算），或手動 merge |
| `awd reflect --to-board` 什麼都沒建 | 沒有 pattern 過門檻（預設 ≥2 次，`rule` 一次即可）；`--threshold 1` 可降；先不帶 `--to-board` 看表 |
| 卡片 id 變成 `kb.card.dev-…` | template 會把 `dev.<slug>` 這種 id slug 化；run 的 key 與 branch（`card/<key>`）跟著用這個 id，正常 |
| workflow board 顯示 `runtime offline` | `awd graph --canvas --runtime <url>` 記的位址連不上；board 網址加 `?run=http://localhost:4313` 可以臨時改 |
| 全部測試 | `npm test`（架構相依規則也在裡面）+ `npx awd test examples/card-pipeline/workflow.yaml` + `dev/scripts/goldens.sh` |

---

## 7 · 用 awd 跑 awd 自己（dogfooding）

`dev/` 是這個 repo 自己的開發流程。事件來源是 canvas 上的 Kanban「agent-workflow-diagram — dev」；你只在三個 gate 動手，其餘由流程推動。詳細檔案表在 [`dev/README.md`](../dev/README.md)。

![Dogfooding 迴圈：人搬卡片（三個 gate）→ plan → build → test & review → merge → reflect → 新卡片；每一站都寫回 event log 與記憶](diagrams/dogfooding-loop.svg)

```
Backlog ─[你]→ Planning ─[planner]→ Planned ─[你]→ Ready
  → worktree → In Progress → builder → npm test → reviewer（≤3 輪 fix、可問 architect）
  → Human Review ─[你]→ Done（merge --no-ff、移除 worktree）
```

### 啟動

```bash
node dev/scripts/seed_board.mjs                                            # 從 dev/board.json 建立/更新 Kanban（冪等，不會動你搬過的卡）
npx awd run dev/workflow.yaml --worker claude-code --port 4313 --store-dir .awd-dev &
npx awd graph dev/workflow.yaml --canvas --runtime http://localhost:4313    # workflow board + 即時 overlay
```

### 你要做的三件事

| 拖卡片到 | 意思 | 之後會發生 |
|---|---|---|
| **Planning** | 決定做這張 | `card_info.sh` 讀卡片 → planner 寫計畫與驗收清單（或回 `needs-human` 附問題）→ 卡片自己到 **Planned** |
| **Ready** | 計畫可以 | 開 `.worktrees/<card>` + branch `card/<card>` → 卡片到 **In Progress** → builder 在 worktree 裡做（`--permission-mode acceptEdits`）→ `npm test` 當 gate → reviewer 看 diff 對照驗收清單 → 乾淨就到 **Human Review** |
| **Done** | 授權 merge | `git merge --no-ff`、移除 worktree、刪 branch → 卡片到 **Done** |

拖回 **Backlog**（從 Planned）= 不做；拖回 **In Progress**（從 Human Review）= 退回 builder。測試失敗、builder 說 blocked、三輪 fix 還不乾淨、merge 失敗 → 卡片回 **Ready**，原因在 run 上（`awd status`）。

### 看它在跑

- workflow board：step 卡片亮 running / waiting / done / failed；底部抽屜有 Runs 與 Events（點 `call_ai` 看 input/output）。
- `npx awd status dev/workflow.yaml --store-dir .awd-dev`、`npx awd memory dev/workflow.yaml --store-dir .awd-dev`（planner 學到的東西）。
- 第一次實跑（2026-09-22）：拖「Edit the selected item」進 Planning → 73 ms 讀卡 → planner（Opus via `claude -p`）78 s 回 `ready`、學到 2 條長期記憶 → 卡片到 Planned → 等 `confirm`。worktree → builder → test → review 這段目前只在 golden（fake worker）下跑過，拖到 Ready 就是第一次真跑。
- 失敗會回到 Kanban：加 `*.failed` 的反省 step（§4.5）後，重複的失敗自動變成 Backlog 卡。

### 測試與安全

`dev/scripts/goldens.sh` 跑四個 golden（happy → Human Review、confirm 拒絕、測試失敗 → park、一輪 findings → clean）；`AWD_DRY_RUN=1` 讓所有 script 只印 JSON、不碰 git / board / npm。`merge.sh` 在主 checkout 有未 commit 的變更時會拒絕。
