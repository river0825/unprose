# Design system — awd canvas & docs

The subject is a **workshop wall**: a long roll of paper, sticky notes in the EventStorming colours, one marker, and two people (one of them an agent) standing in front of it trying to agree. Everything in the UI serves that picture. The paper and the stickies are the memorable thing; the chrome is an instrument tray that stays out of the way.

## Point of view

- **The board is paper, the chrome is graphite.** The canvas surface reads as plotter paper (near-white, faint dot grid) in light mode and as deep slate in dark mode — never cream, never near-black. Chrome (header, rails, panel) is a cool neutral graphite with hairline rules, no card kits, no soft grey shadows on everything.
- **Stickies keep their saturation.** They are the only fully saturated colour on screen. Roles are told by colour *and* by a small text label (never colour alone).
- **One accent: marker blue.** Used for focus, selection, primary action, links. Agent and user identities are a *rule*, not a chip: a 3px left rule in violet (agent) or green (user) on feed entries and comments.
- **One family: IBM Plex.** Plex Sans for everything, Plex Mono for ids/seq/keys only. No caps-tracked eyebrow labels, no middle-dot meta strings, no arrows appended to links.
- **Motion answers the person.** Nothing moves on load. Selection, opening a panel, an agent change arriving: 160–220 ms ease-out, disabled under reduced motion.

## Tokens (`:root`; dark under `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` **and** `:root[data-theme='dark']`)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#fbfbf9` | `#1b2027` | board surface (explicit `body` background too) |
| `--paper-dot` | `#d8d9d4` | `#2b323b` | dot grid |
| `--chrome` | `#f0f1f0` | `#12161b` | header / rails / panel background |
| `--chrome-2` | `#e6e8e6` | `#1a1f26` | hover / secondary surface |
| `--ink` | `#161a1f` | `#e8eaec` | text |
| `--ink-2` | `#444b53` | `#b7bcc3` | secondary text (≥ 4.5:1 on chrome) |
| `--ink-3` | `#6b727a` | `#8a9099` | tertiary / placeholders (≥ 4.5:1 on chrome for ≥ 14 px only) |
| `--rule` | `#cfd3d6` | `#2e353d` | hairline |
| `--rule-2` | `#aeb4b9` | `#414a54` | stronger hairline |
| `--marker` | `#1f56d6` | `#7ea2ff` | accent: focus, selection, primary, links |
| `--marker-ink` | `#ffffff` | `#0b1a3d` | text on marker |
| `--marker-soft` | `#e3ebfb` | `#1d2a45` | selection wash |
| `--agent` | `#6e3fc4` | `#b899f2` | agent identity rule |
| `--user` | `#1b7f5a` | `#67cfa3` | user identity rule |
| `--danger` | `#b8342a` | `#f08a7e` | destructive |
| `--shadow-lift` | `0 2px 6px rgba(22,26,31,.10)` | `0 2px 8px rgba(0,0,0,.45)` | only on dragged nodes and the open panel |

Sticky colours (light / dark — dark keeps hue, drops lightness; ink on sticky is `--sticky-ink` `#17130f` / `#100d0a`):

| Token | Light | Dark | EventStorming role |
|---|---|---|---|
| `--c-orange` | `#ffb648` | `#d9922e` | event |
| `--c-blue` | `#7dbdff` | `#4f8fd8` | command |
| `--c-yellow` | `#ffe14a` | `#d6ba22` | actor (small) |
| `--c-pale-yellow` | `#fff3b0` | `#c9bd76` | aggregate |
| `--c-lilac` | `#d4b4ff` | `#a07bd9` | policy |
| `--c-green` | `#9fe39a` | `#66b664` | read model / opportunity |
| `--c-pink` | `#ffb0cf` | `#d67aa2` | external system |
| `--c-red` | `#ff7a7a` | `#d85a5a` | hotspot (rotated −3°) |
| `--c-grey` | `#dedcd6` | `#6c6b67` | wireframe primitives |
| `--c-white` | `#ffffff` | `#d9d7d0` | plain text / title |

## Type scale (Plex Sans; base 16 / line-height 1.5)

| Use | Size / weight / tracking |
|---|---|
| Page title (docs H1, board list heading) | 28 / 600 / −0.01em |
| Board title in header | 15 / 600 |
| Section (docs H2) | 22 / 600 |
| Body | 16 / 400 |
| UI text (buttons, panel) | 13.5 / 500 |
| Meta (ids, seq, timestamps) | 12.5 / Plex Mono 400 |
| Sticky text | 13 / 500, line-height 1.3, max 6 lines with fade |

Radius: 4 px on controls, 2 px on stickies (a sticky is a square of paper, not a pill). Spacing scale 4/8/12/16/24/32/48.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ‹ Boards   Card pipeline — Event Storming   [process]  seq 42 ● │  header 44px, hairline below
├──┬───────────────────────────────────────────────────┬─────────┤
│▮ │                                                   │ Changes │
│▮ │              paper + dot grid                     │ ─────── │
│▮ │      (stickies, lanes, arrows, comments)          │ ▎agent  │
│▮ │                                                   │ ▎user   │
│▮ │                                                   │         │
│  │                                                   │ Selected│
└──┴───────────────────────────────────────────────────┴─────────┘
 left rail 48px: marker tray            right panel 320px, collapsible
 (sticky swatches as tiny squares,       (tabs: Changes / Selected)
  text, frame, comment, connect)
```

- **Left rail** is the marker tray: vertical, 48 px wide, icon buttons ≥ 44 px, each with a visible tooltip label and keyboard shortcut. Sticky colours shown as 12 px paper squares, not circles.
- **Right panel** slides in (transform, not width). On phones it becomes a bottom sheet.
- **Board list** is a wall of boards: each board card shows an **SVG thumbnail** of its items (server-rendered `GET /api/boards/:id/thumb.svg`), the title, the kind as plain text, and "updated 3 min ago". Left-aligned grid, 280 px min columns, hairline borders, no shadows.
- **Docs** share the tokens: 72 ch measure, Plex Sans body, Plex Mono code, sticky left sidebar with the doc list, Mermaid themed from the tokens (`themeVariables`), tables with hairlines, headings anchored.

## Accessibility floor

- Every interactive control has a visible 2 px `--marker` focus ring with 2 px offset.
- Dragging has a single-pointer/keyboard alternative: arrow keys nudge the selection by 10 px (Shift = 50 px); "Move to lane…" in the Selected tab.
- Icon buttons carry `aria-label`; sticky role is text as well as colour; connection status is text ("live"/"offline") plus dot.
- Touch targets ≥ 44 px; `prefers-reduced-motion` disables all transitions; no horizontal page scroll at 375 px.
