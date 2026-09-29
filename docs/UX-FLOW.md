# 操作流暢度研究 — 從「agent 畫圖」到「人改完、agent 反應」

目標：讓「對齊想法」這件事本身順，而不是只有畫面漂亮。下面走一遍真實旅程，標出每個摩擦點，並排出實作順序。核對過的準則來自 ui-ux-pro-max 的 UX guideline 庫（Undo/Confirmation、Keyboard Navigation、Progress Indicators、Empty States、Active States、Content Jumping、Dragging Movements）。

## 旅程（現況）

```
1. 你在 Claude Code 說「把 card pipeline 畫成 event storm」
2. agent → canvas_create_board(content)         ← template 算版面
3. agent 貼 URL；你點開瀏覽器                    ← 需要切視窗
4. agent → canvas_wait(since)                    ← 阻塞等你
5. 你拖第一張便利貼                              ✗ wait 在「第一個變更」就 resolve
6. agent 讀 diff，開始反應                        ✗ 你才改到一半
7. agent 補便利貼 / 回 comment；toast「agent updated N items」
8. 你想撤銷剛才的移動                             ✗ 沒有 undo
9. 你想在空白處快速加一張                          ✗ 只能走工具列
10. 你想問「這一段為什麼卡住」                     △ 要先進 comment mode 再點目標
11. agent 再 canvas_wait …                        △ 你不知道 agent 現在有沒有在看
```

## 摩擦點與對策（依影響 × 成本排序）

| # | 摩擦 | 對策 | 落點 |
|---|---|---|---|
| 1 | **wait 在第一個變更就 resolve**，agent 對半成品反應 | `waitFor` 改成「安靜視窗」：第一個變更後再等 `quietMs`（預設 2500ms）沒有新變更才回；另外提供**「交給 agent」按鈕**（送出一個 `note: 'handoff'` 的空 change）立即 resolve。MCP `canvas_wait` 加 `quietSec` 參數。 | server `store.ts` / `mcp.ts` / UI header |
| 2 | **你不知道 agent 是否在看** | server 記錄每個 board 目前有沒有 pending 的 wait；WS 廣播 `presence {author:'agent', at, watching:true|false}`；UI header 顯示「agent 正在看 / agent 離開了」文字 + 點。 | server / UI |
| 3 | **沒有 undo** | 本地 undo stack：每個自己送出的 change 都帶 `before`，反向產生 ops；`⌘Z` / `⌘⇧Z`；跨 agent 變更時只撤自己的 ops（若項目已被 agent 改過就跳過並提示）。刪除多個項目改用 undo 取代確認對話框（準則：可逆操作不需要 confirm）。 | UI `store.ts` |
| 4 | **加東西太多步** | 空白紙面**雙擊 → 在游標處加便利貼並進入編輯**；`⌘D` 複製選取；Enter 在編輯完後於下方新增同色便利貼（連續輸入）；拖拉框選。 | UI `BoardPage` |
| 5 | **問 agent 一句話要繞路** | 右鍵 / 長按項目 → 選單：「加註解」「問 agent」「改顏色」「刪除」；「問 agent」= 建 comment + 立即 handoff。 | UI |
| 6 | **切視窗才看得到圖** | `canvas_create_board` 回傳後 agent 直接 `canvas_open`（MCP 描述改成預設開啟）；board URL 支援 `?focus=<itemId>`，agent 回覆 comment 時給帶 focus 的連結。 | MCP / UI |
| 7 | **從 workflow.yaml 到 canvas 要兩步** | `awd graph workflow.yaml --canvas [url]` 一步建立/更新 workflow board（deterministic id → 重跑即更新）。 | CLI |
| 8 | **啟動要記三個指令** | root `npm start` 同時起 canvas + workflow runtime（`concurrently` 或簡單 node script）；常駐見 ARCHITECTURE.md §5 自架。 | root |
| 9 | **change feed 混在一起** | feed 可切「只看 agent / 只看你」；點一筆 → 定位並閃一下（已有）。 | UI |
| 10 | **Board 標題不能改** | header 標題可點編輯 → `PUT /api/boards/:id`。 | UI |
| 11 | **鍵盤操作不完整**（Dragging Movements 準則） | 方向鍵移動選取（10px / Shift 50px）、Tab 在項目間移動焦點、`?` 顯示快捷鍵表。 | UI |
| 12 | **agent 一次改很多，畫面跳動**（Content Jumping） | agent 變更到達時不自動 fit view；只以 marker-soft wash 標示 200ms，feed 顯示「agent 改了 N 項 — 點此定位」。 | UI |

## 完成狀態（2026-09-22）

| # | 狀態 | 落在哪 |
|---|---|---|
| 1 quiet window + Hand to agent | ✅ | `GET /wait?quiet=&wake=`、MCP `canvas_wait { quietSec, wake }`、header 按鈕 |
| 2 agent 在不在看 | ✅ | WS `presence`、header「Agent is watching / away」 |
| 3 undo / redo | ✅ | `⌘Z` / `⌘⇧Z`，從 change 的 `before` 反推；agent 改過的項目跳過 |
| 4 雙擊新增、`⌘D`、`⌘Enter` 接著加 | ✅ | BoardPage |
| 5 右鍵選單、Ask agent | ✅ | ContextMenu |
| 6 自動開瀏覽器、`?focus=<id>`、Copy link | ✅ | MCP `canvas_create_board` 會 `open`；Selected 面板 |
| 7 `awd graph --canvas` | ✅ | 並記下 runtime 位址（`meta.workflow.statusUrl`） |
| 8 `npm start` | ✅ | `scripts/start.mjs` |
| 9 feed 篩選 + locate | ✅ | All / Agent / You |
| 10 標題可改 | ✅ | `PUT /api/boards/:id` |
| 11 方向鍵、`?` 快捷鍵表 | ✅（Tab 在項目間移動未做） | |
| 12 不自動跳視窗 | ✅ | |
| workflow 端「流程圖同時是儀表板」 | ✅ | runtime `/api/stream`（SSE）+ RunOverlay：step / agent 徽章、Runs / Events 抽屜（docs/workflow.md §7） |
| `canvas_focus_url` 工具 | ✗ 未做 | Copy link 已能產生同樣的連結，需求消失 |

## 下一輪（從 dogfooding 的 backlog 與實測來的）

- comment thread 摺疊與已讀狀態（`data.seenBy` 已存在，UI 還沒用）
- 選取項目可編輯文字 / 連線可改標籤、改端點（backlog #2、#4）
- 項目與文字可 resize（backlog #5）
- Kanban board 在 `on: board` trigger 訂閱時 header 常駐「Agent is watching」——presence 應該分辨「runtime 在訂閱」與「agent 在等你」
- Kanban 卡片 id 被 slug 化（`dev.x` → `kb.card.dev-x`）：建卡時傳的 id 應原樣保留
- 手機版：不做（使用者決定）


## 對 agent 端（MCP 描述）的調整

- 工具說明改寫成「先畫 → 立刻 `canvas_open` → 再 `canvas_wait`」；`canvas_wait` 說明加上「回傳表示使用者已停手 2.5 秒或按了『交給 agent』」。
- `canvas_diff` 的摘要行加上項目 id（`[i_ab12]`），agent 回覆時能精準 target。
- 新工具 `canvas_focus_url({id, itemId})`：產生帶 focus 的連結，方便 agent 在對話中指向某張便利貼。

## 對 workflow 端

- `awd run` 的 `/api/status` 已有；下一步把 run 狀態投影到 workflow board（step 卡片上色：running / waiting / done / failed），這樣「流程圖」同時是「儀表板」。這是第二階段。

## 實作順序

1. #1 #2（server + MCP）— 對齊迴圈的正確性。
2. #3 #4 #5 #10 #11（UI）— 白板基本手感。
3. #6 #7 #8（CLI / MCP）— 少切視窗、少記指令。
4. #9 #12 — 打磨。
