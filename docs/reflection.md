# 反省也需要設計：signal → pattern → decision

原本的 pipeline 累積了 224 條「反省」，關掉 14 條。不是沒人在乎，是反省沒有形狀：一條卡片、一段散文，沒有出處、沒有計數、沒有下一步。這份文件說明 awd 怎麼把反省變成事件驅動的三層，讓「每次事故留下的是一個 golden、一個 gate、一條 lint 規則，而不是一段話」。

```
signal ──► pattern ──► decision
事件        投影         卡片（帶 guard 建議）
```

| 層 | 是什麼 | 住在哪 | 誰產生 |
|---|---|---|---|
| **signal** | 一件值得之後看的事，永遠帶著 `key`（哪張卡）與 `step` | event log：`reflection.noted`、以及每個 `<step>.failed` / `<step>.timeout` | agent（答案裡的 `reflect`）、script（JSON 裡的 `reflect`）、runtime（失敗自動算） |
| **pattern** | 同一件事發生了幾次、在哪些 key、從何時到何時 | 投影，不存檔：`awd reflect` 每次從 log 重算 | `patternsOf(events)` 純函數 |
| **decision** | 過門檻的 pattern → **一張** kanban 卡，內容是事實 + 例子 + 建議的 guard | canvas 的 Backlog 欄；卡片以 `data.pattern` 認自己 | `awd reflect --to-board`，或 `*.failed` 觸發的 step |

## 1. Signal：三個來源，一種事件

**agent**：任何 ai step 的答案都可以多一個 `reflect` 欄位（schema 自動允許，和 `remember` / `learn` 一樣，不會進 `vars`）：

```json
{ "outcome": "clean", "findings": [],
  "reflect": [ { "note": "The review input had no CI status link.", "kind": "friction", "tags": ["review", "ci"] } ] }
```

`kind` 四種：`friction`（卡了一下）、`bug`（看到壞掉的東西）、`idea`、`rule`（應該有一條規則）。runtime 把每條變成一個事件：

```
reflection.noted { source: "ai", agent: "reviewer", key: "c-happy", step: "review", note, kind, tags }
```

**script**：stdout 的 JSON 在 `outcome` / `data` 旁邊加 `reflect: [...]` 即可，同樣變成 `reflection.noted { source: "script" }`。

**失敗**：不用任何人寫。`<step>.failed` 與 `<step>.timeout` 本來就在 log 裡，`awd reflect` 直接把它們當 signal，原因會被分類（`exit non-zero`、`schema mismatch`、`agent_blocked`、`timeout`…），這樣同一種失敗不會因為錯誤訊息裡的數字不同而變成十種。

三個來源的共同點：**每條 signal 都有 key**。「哪張卡、哪一步、什麼時候」不是回憶，是事件本身。

## 2. Pattern：`awd reflect`

```bash
npx awd reflect examples/card-pipeline/workflow.yaml            # 全部
npx awd reflect examples/card-pipeline/workflow.yaml --since 7d # 每週看一次的那種
npx awd reflect … --json                                        # 給程式用
```

輸出是一張表：

```
n    kind      pattern                                           when         keys
3 ●  failure   build fails: exit non-zero                        09-20→09-22  c-flaky,c-9,c-12
2 ●  friction  [friction] ci, review — The review input had no…  09-21→09-22  c-happy,c-7
1    rule      [rule] never merge without the migration gate     09-22→09-22  c-9   ●
```

分組規則刻意簡單到可以解釋：失敗依 `step + 原因類別`；反省依 `kind + tags`（沒有 tags 才用句子本身）。每個 pattern 記次數、第一次、最後一次、出現過的 key、最多五個例子。

## 3. Decision：一張卡，不是一段話

```bash
npx awd reflect examples/card-pipeline/workflow.yaml --to-board "title:Card pipeline — Kanban" --column Backlog
```

門檻：出現 **≥ 2 次**，或任何 `rule`（`--threshold` 可調）。每個過門檻的 pattern 變成**一張**卡：

- 標題就是 pattern（`build fails: exit non-zero`）
- 描述：發生幾次、哪些 key、例子、然後一行 **Suggested guard**——
  - 失敗 → 「加一個 `tests/<step>-<reason>.golden.yaml` 重現它（事件進、預期 outcome 出），修到綠為止」
  - `rule` → 「變成 lint 規則或 gate step；只活在 prompt 裡的規則是建議，不是規則」
  - `bug` → 「先加 golden 重現再碰程式」；`friction` → 「用 script step 或一行文件消掉，不是加長 prompt」
- 卡片以 `data.pattern` 記住自己是哪個 pattern：再跑一次 `--to-board` 是**更新次數與描述**，不會長出第二張

這就是「decision 要少、要可量測」：卡片數 = 過門檻的 pattern 數，每張都有一個可以驗證做完的 guard。

## 4. 自動化：`*.failed`

一個 step 可以聽「任何 step 的失敗」：

```yaml
reflect-failure:
  on: "*.failed"          # 也有 "*.timeout"；只有這兩種萬用字元
  run: bash scripts/reflect_to_board.sh {{ key }} {{ event.type }}
  terminal: [done, skipped]
```

reducer 會把 `*.failed` 配對到任何**其他** step 的 `.failed`（自己的不算，否則會迴圈）；lint 只接受 `*.failed` / `*.timeout`；圖上畫成一個「any step / failed」節點。`examples/card-pipeline/scripts/reflect_to_board.sh` 在 `AWD_CANVAS_URL` 可達時呼叫 `awd reflect --to-board`，不可達就回 `skipped`——所以 golden 是密封的，真跑時才碰 canvas。

每週的 pattern 回顧就是一個 cron trigger：

```yaml
triggers:
  weekly-reflection: { on: cron, every: 7d, emit: reflect.tick }
steps:
  weekly-reflect:
    on: reflect.tick
    run: npx awd reflect workflow.yaml --since 7d --to-board "title:<your kanban>"
    terminal: true
```

## 5. 為什麼 224 → 14 在這裡不會重演

| 以前 | 現在 |
|---|---|
| 反省是一張卡上的一段話，沒有出處 | 每條 signal 是一個事件，帶 key、step、時間、來源 |
| 同一件事寫了五次，分散五處 | pattern 有計數；五次是「n=5」，不是五張卡 |
| 「應該加一條規則」→ 加進 SKILL.md | `rule` 反省的 guard 是「變成 lint 或 gate」——會被執行的東西 |
| 事故 → 補一段流程說明 | 事故 → 一張卡要求一個 golden；golden 綠了卡才能關 |
| 關卡片靠記憶 | 卡片 = pattern；pattern 不再出現，`awd reflect --since 7d` 就看不到它 |

## 6. 檔案地圖

| 檔案 | 內容 |
|---|---|
| `packages/core/src/reflection.ts` | `reflect` 欄位的 schema、`reflectNotesOf`、萬用字元比對 `listenerMatches` |
| `packages/runtime/src/application/reflection.ts` | `signalsOf` / `patternsOf` / `decisionsOf` / `cardForPattern` / `renderPatterns`（純函數） |
| `packages/runtime/src/adapters/canvas/cards.ts` | `canvasCards().upsertCards`：找 board、建卡或原地更新 |
| `packages/cli/src/index.ts` | `awd reflect` |
| `examples/card-pipeline/scripts/reflect_to_board.sh` | `*.failed` step 用的腳本 |
| `examples/card-pipeline/tests/14-*, 15-*` | 萬用字元觸發、agent 的 `reflect` 進 log |

**原本以為**：反省是文化問題——多寫、常回顧就會改善。**實際上**：反省是資料問題。沒有 key 的反省沒人能驗證，沒有計數的反省分不出輕重，沒有 guard 的反省關不掉。把它做成事件 → 投影 → 卡片之後，「回顧」只是一個指令，「關掉」只是一個 golden 變綠。
