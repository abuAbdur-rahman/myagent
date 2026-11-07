---
name: myagent
description: Local-first BYOK Windows chat client
colors:
  sunken: "#1a1917"
  canvas: "#232220"
  raised: "#2b2a27"
  overlay: "#32312d"
  line: "rgba(255,248,235,0.12)"
  line-subtle: "rgba(255,248,235,0.07)"
  line-strong: "rgba(255,248,235,0.22)"
  text: "#ebe8e2"
  text-2: "#b4afa6"
  text-3: "#a19c93"
  text-off: "#6a665f"
  accent: "oklch(0.55 0.14 38)"
  accent-text: "oklch(0.78 0.12 38)"
  accent-soft: "oklch(0.70 0.14 38 / 0.16)"
  on-accent: "#ffffff"
  danger: "#f0757c"
  success: "#6cc48a"
  warning: "#e6b055"
  info: "#7db1f0"
typography:
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  chat:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  greeting:
    fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.2
  title:
    fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "28px"
    fontWeight: 400
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  small:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "13px"
rounded:
  chip: "6px"
  field: "8px"
  card: "12px"
  composer: "16px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "32px"
  button-default:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "rgba(255,248,235,0.035)"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "0 10px"
    height: "32px"
  message-bubble:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.composer}"
    padding: "10px 16px"
  composer:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.composer}"
    padding: "8px 10px"
---

# Design System: MyAgent

## Overview

**Creative North Star: "The Local Vault"**

The interface is a Windows desktop room the user controls: a 36px title bar with
real caption buttons, a quiet sidebar, a centered reading column, and an
artifact pane that opens beside the chat. Nothing glows for attention. Surfaces
are warm charcoal steps (`sunken → canvas → raised → overlay`) separated by
alpha hairlines; a single accent hue marks the few things that act — Send, one
primary button per view, selection tint, focus rings.

The system ships in two themes (light and dark) that share the same structure;
dark is the default and the reference. Type is the system UI stack everywhere
except two places: page titles and the welcome greeting, set in Georgia serif at
weight 400, and code, set in Cascadia Code monospace.

**Key Characteristics:**
- Windows-native shell: custom title bar, 900px minimum width, Ctrl-first shortcuts.
- Warm tonal ladder, alpha hairlines, one accent hue with per-preset contrast.
- 32px controls, 8px fields, 12px cards, 16px composer and dialogs.
- Serif titles and greeting, sans UI and chat body, monospace code.

## Colors

A charcoal ladder in dark mode and a paper ladder in light mode, with one accent
and three functional signals.

### Primary
- **Accent Hue** (default Clay, `oklch(.55 .14 38)`): solid fills for primary
  buttons, toggle-on and Send. `--accent-text` is a lighter tint for links and
  accent icons; `--accent-soft` is a 12–16% tint for selected states. Six presets
  set one hue: Clay 38, Blue 255, Green 150, Violet 295, Pink 350, Graphite 80
  (low chroma, near-black text on solid).

### Neutral (dark / light)
- **Sunken** (#1a1917 / #f0eee9): title bar, sidebar, settings nav.
- **Canvas** (#232220 / #faf9f6): chat column, panels, project page.
- **Raised** (#2b2a27 / #ffffff): composer, user bubble, cards, modal.
- **Overlay** (#32312d / #ffffff): menus, popovers, tooltips.
- **Fill 1/2/3** (3.5% / 6.5% / 12% alpha): inset groups, hover, pressed/active.
- **Line subtle / line / line strong** (7% / 12% / 22% alpha): dividers, controls,
  hover edges. Draw them with `box-shadow: inset 0 0 0 1px` so layout never shifts.
- **Text** (#ebe8e2 / #1f1d1a): primary.
- **Text 2** (#b4afa6 / #5d5953): secondary copy.
- **Text 3** (#a19c93 / #6e6962): meta, labels, placeholders; ≥ 4.5:1 on every
  surface including overlay.
- **Text off** (#6a665f / #a39e95): disabled and decorative only.

### Tertiary (functional signals)
- **Danger** (#f0757c / #be2f3a): errors, destructive actions, window-close hover.
- **Success** (#6cc48a / #1d7a3e): connected status, success states.
- **Warning** (#e6b055 / #8a5a00): needs attention, high context usage.
- **Info** (#7db1f0 / #1f5fae): neutral information only.

Status always pairs an icon and a word with the colour.

### Named Rules
**The Surface-First Rule.** Use surface contrast before adding a border. Never a
surface and a border on the same edge.

**The One Signal Rule.** Color appears only to carry meaning. Hover is a fill,
active is a stronger fill, focus is a ring — never all three at once.

**The Accent-Is-Action Rule.** Solid accent fills once per view. Accent never
carries body text; `--accent-text` exists for that.

## Typography

**Body Font:** Segoe UI Variable Text, Segoe UI, system-ui, sans-serif (14px/1.45)

**Character:** The system font is the brand — no webfont is loaded, so type
renders identically offline and with the network unplugged.

### Hierarchy
- **Page title** (Georgia serif, 400, 28px, 1.2): welcome greeting, Projects,
  project detail.
- **Dialog title** (sans, 600, 18px): settings and form dialogs.
- **Chat** (400, 15px, 1.65): assistant and user message text.
- **Body** (400, 14px, 1.45): UI chrome, lists, form copy.
- **Small** (400–500, 13px): buttons, table cells, menu items, descriptions.
- **Meta** (400–500, 12px): section labels, badges, hints, timestamps. This is
  the floor; no 10–11px text.
- **Mono** (Cascadia Code, Consolas, 13px): code, URLs, keys, shortcuts, token
  counts. Not for model names or ordinary values.

### Named Rules
**The System-Font Rule.** No webfont is loaded, ever.

**The Serif-Is-Title Rule.** Serif appears only in page titles and the welcome
greeting, at weight 400 — nowhere else.

## Layout

A title bar (36px) sits above a three-column grid: sidebar (264px, collapsible
to 56px) | main column | artifact panel (400px, resizable 360–640, or full).
The main canvas has a 16px rounded top-left corner and an inset hairline, so the
sidebar reads as behind it without a divider. The reading column is capped at
720px and centered; the composer at 760px. The composer sits in a dock with a
28px fade above it, and the context ring lives in its action row. Minimum window
size is 900×560. Regions scroll independently; there is no page scroll.

## Elevation & Depth

**The Surface-First Rule.** Depth comes from the tonal ladder first. Shadows are
small and functional: `shadow-sm` on the composer and user bubble, `shadow-md` on
menus, popovers and the jump pill, `shadow-lg` on the settings modal. The modal
scrim is 62% dark / 38% light with a 3px backdrop blur. Never a border and a
shadow doing the same job on one edge.

## Shapes

Chips are 6px; buttons, inputs, menu items and rows are 8px; cards, code blocks
and bubbles are 12px; the composer and dialogs are 16px; toggles, avatars,
status pills and suggestion chips are fully round. Icon buttons are square
32/28/24px grids. The Send button is a 32px rounded square (10px).

## Components

### Buttons
- **Shape:** 8px radius, 32px height (28px small), 12px horizontal padding.
- **Primary:** accent fill with on-accent text — one per view.
- **Secondary:** fill-2 with an inset Line hairline.
- **Ghost:** transparent, text-2 — icon and tertiary actions.
- **Danger:** danger text, danger-soft hover. No red outline by default.
- **Hover / Focus:** hover steps the fill; focus draws a 2px accent-line ring
  with a 3px soft halo. No transforms, no lift.

### Inputs / Fields
- **Style:** fill-1, inset 1px Line, 8px radius, 32px height.
- **Focus:** the same recipe everywhere — inset accent-line plus a 3px
  accent-ring halo.
- **Toggles:** 36×20 pill switches, 16px thumb. **Segmented:** fill-2 track,
  selected raised chip with an inset hairline; policy segments tint Allow green
  and Block red.

### Sidebar
- **Style:** 264px rail on Sunken; collapses to a 56px icon rail. The main canvas
  rounds over its top-right corner instead of a divider.
- **New chat:** 36px solid accent with the shortcut on the right — the one solid
  accent in the rail.
- **Rows:** 34px (30 compact), 8px radius. Every row reserves a 16px lead slot,
  so titles never jump between dotted and plain rows.
- **Active:** fill-3 plus brighter text only. No left accent bar. A dot or a
  spinner in the lead slot means unread/working.
- **Groups:** 12px sentence-case headers with a rotating chevron; fold state is
  remembered.
- **Order:** a chat appears once — under its project if it has one, otherwise in
  its date group. “All projects” is the page; “Projects” is the rail section.
- **Footer:** profile row (name, provider status) with the settings gear beside it.

### Message
- **User:** right-aligned bubble on Raised, 16px radius, no border, `shadow-sm`,
  max 80% width; hover reveals copy and edit.
- **Assistant:** logo + model name in 12px meta type once per run, then rendered
  markdown at 15px/1.65. Thinking and tool calls are collapsed trace rows.
  Streaming shows an accent caret; the activity pill owns the in-between signal.
  Hover reveals copy, regenerate (last only), branch, ratings and remember.
- **Rhythm:** 28px between turns, 8px between a turn’s meta and body, 12px between
  blocks. Density changes the gap.
- **Attachments:** a 168px card per document — type chip, name, size and character
  count.

### Composer
- **Shape:** 16px radius on Raised, inset Line, `shadow-sm`. Focus = inset
  accent-line + 3px accent-ring.
- **Contents:** auto-growing textarea (to ~8 lines); an attachment row when used;
  a tool row of ghost controls — attach, model chip, reasoning chip, then the
  context ring with a live percent, mic and a 32px Send. Send is neutral until
  there is text, then accent. It becomes Stop while streaming.
- **Context:** the ring opens the Context panel. Compact lives inside that panel.
- **Slash menu:** anchored popover above the box, 8px rows, arrow-key navigation.
- **Paste:** a block-looking paste arrives as a fenced code block with a guessed
  language; Undo restores the raw paste.
- **Footer:** 12px meta line — Markdown, `/` commands, keys stay local, plus
  Compact/Show all when relevant.

### Activity pill
- **Shape:** `rounded-full` on Surface Raised at 95% with a Line border, the
  panel shadow and backdrop blur; 3px radius gap to the composer.
- **Placements:** centered in the page while the transcript is empty, otherwise a
  centered inline row directly above the composer. Never inside the transcript.
- **States:** `Thinking`, `Writing`, `Compacting` with a staggered ellipsis;
  `Listening — release to send` with the mic and a pulsing dot; `Transcribing`
  with the mic and a spinner. Static `…` under `prefers-reduced-motion`.
- **Voice:** the mic's phase outranks the model's, because the user is holding
  the button; the pill only renders above the composer while recording.

### Progress panel and artifacts
- **Progress dock:** right-hand pane at the shared panel width, 48px header;
  steps in order, Outputs (first two as cards), and Used in this session.
- **Artifact dock:** 400px by default, resizable 360–640 and persisted. Row 1:
  back, title, language badge, close. Row 2: segmented Preview/Code tabs, then
  Copy, Download, a divider, minimize and fullscreen. Footer: sandbox status.
- **Narrow windows:** below 1100px the open panel overlays the app with a scrim
  and traps focus; closing returns focus to the header trigger.
- **Outputs gallery:** a grid of the chat’s artifacts and written files, each with
  the same sandboxed thumbnail the panel uses.


### Command Palette
- **Shape:** a 560px modal pinned near the top over a 62% scrim with 3px blur, a
  48px search row, 12px section headers, 36px rows, and a keyboard-hint footer.

### Toasts & Confirms
- **Toasts:** bottom-center overlay pills with a 1px strong hairline and optional
  action buttons; auto-dismiss.
- **Confirms:** small centered dialogs with Cancel plus a primary or danger-filled
  confirm; Esc and backdrop both cancel.

## Do's and Don'ts

### Do:
- **Do** separate regions with surface contrast first; add a hairline only as a
  secondary cue.
- **Do** reserve solid accent for one primary action per view.
- **Do** keep the reading column at 720px and the composer at 760px.
- **Do** show keyboard focus with a 2px accent ring on every control.
- **Do** keep destructive actions behind the confirm dialog.
- **Do** pair status colour with an icon and a word.

### Don't:
- **Don't** use a surface and a border on the same edge.
- **Don't** load a webfont or use serif outside page titles and the greeting.
- **Don't** ship a control that does nothing — omit it until it works.
- **Don't** use color as the only cue for state.
- **Don't** use 10–11px text for anything a user must read.

## Screen Design Process

A screen is designed, not generated. Work these steps in order; do not write
markup until step 4. This exists because settings screens were once built from a
single `row(label, help, control)` primitive and stopped at "meets the
requirement": controls crushed into one fixed-width column, a wrapped blob passed
off as a log, colour-only status, and placeholders standing in for labels. The
task sentence names the happy path only — the design is everything else.

### 1. State the job in one sentence
"A person pastes API keys, sees which one is used, and keeps them in priority
order." If you cannot write the sentence, the screen is not understood yet. Note
how often it is opened too: a daily screen (Audit) may be dense, a once-only
screen (Add server) must be self-explanatory.

### 2. List the nouns, their states, and their verbs
Nouns: key, server, tool, log entry. States each can be in: ready, testing,
quota reached, invalid, off, error. Verbs: add, test, reorder, remove, allow,
block, copy, open. Every state needs a visible treatment; every verb a control.

### 3. Pick a pattern; do not invent one
| The content is… | Use |
|---|---|
| One value or toggle | a labelled row — the control must fit a narrow column |
| A list the user manages | rows or cards, one per thing, per-item actions on the right, the section's **Add** in the section header |
| A form with 2+ fields | a dialog: labels above inputs, inline errors, Enter submits, Esc cancels |
| One quick input (paste a key) | an inline field under the list, Add button, Enter submits |
| Chronological records | a day-grouped list, one-line summaries, expand for detail, search and filters, paging |
| 2–4 exclusive choices | a segmented control; use a select only for 5 or more |
| Status | a pill: text **and** colour, never colour alone |
| Machine text | mono, truncated with `title`, full text on expand with **Copy** |
| Remove, and it's reversible | do it now, then a toast with **Undo** (~6 s) |
| Remove, and it's irreversible or bulk | a confirm dialog with a specific title, a one-line consequence, and a verb button ("Remove all", not "OK") |

### 4. Place things deliberately
- One primary action per region, top-right of the section it affects.
- A destructive action is never beside the primary one: put it opposite the
  primary in the section header, or in a menu.
- Order is information. If order matters (key priority), show it with numbers and
  make it changeable.
- Put a rule before the thing it governs (an approval callout above the list).
- Never put a form, list or log inside a single control column. If it does not
  fit one control, it needs its own layout or a dialog.
- A page is: title, one-line description, then groups. Keep line length under
  about 62 characters.
- Collapsed rows truncate with an ellipsis; detail lives one click deeper, not in
  a wrapped blob.

### 5. Design every state
- [ ] Empty: says what this is, offers one next action (presets if you can)
- [ ] Loading / testing: a spinner in place; the control that started it is disabled
- [ ] Populated, with 1 item and with 30
- [ ] Error: what happened, how to fix it, a retry, and the failed field or item marked
- [ ] Off / disabled: dimmed but still reachable
- [ ] Long text: a very long command, path or title does not break the layout
- [ ] Success: visible feedback (status change or toast), never silent
- [ ] After the action: where does focus go?

### 6. Write the words
Sentence case. Buttons are verbs that say what happens ("Add server", "Clear
log"). Keep one name through the flow: the button says "Remove", the toast says
"Key removed". Errors say what went wrong and how to fix it, and do not
apologise. Empty states invite an action. Name things in the user's terms
("tools", "keys") rather than by implementation.

### 7. Make it work by keyboard
Tab order follows reading order. Enter submits a field or dialog. Esc closes the
top layer. On a validation error, focus the first invalid field. After a
re-render, focus returns to the control that triggered it. Toggles use
`role="switch"` and `aria-checked`; a segmented control is a `role="group"` with
`aria-pressed` buttons; live counts and errors use `aria-live` or `role="alert"`.

### 8. Verify in the app, not in your head
Build and open the screen at roughly 700px and 1280px, in light and dark.
Exercise it: type, click, Enter, Esc, tab through. Trigger every state from step
5. Start an async action (a key test, a reconnect), keep typing, and confirm
focus and text survive. Confirm no console errors and no horizontal overflow.
Compare it with a neighbouring screen: if it looks like a different app, fix it.

## Pattern Reference

| Thing | Values in this app |
|---|---|
| Radii | 6 chips and tags · 8 buttons, inputs, rows, menu items · 12 cards, code blocks, bubbles · 16 composer, dialogs · 999 toggles, avatars, status pills |
| Control heights | 24 small icon button · 28 small button and icon button · 32 default button and input · 34 sidebar row (30 compact) · 36 title bar and new chat · 48 header · 52 composer minimum |
| Type (px) | 12 meta and tags · 13 small and controls · 14 UI · 15 chat (1.65) · 18 dialog title · 28 serif page title |
| Spacing (px) | 4, 8, 12, 16, 20, 24, 32, 40, 48 — layout values only; control padding may use 10 |
| Colour | tokens only: `--bg-sunken --bg-canvas --bg-raised --bg-overlay --fill-1/2/3 --line-subtle --line --line-strong --text --text-2 --text-3 --text-off --accent-solid --accent-text --accent-soft --on-accent --danger --success --warning --info`. Never hard-code hex; the accent is a hue preset |
| Icons | `lucide-react`, 16px inside the control grid. Icon-only buttons need `aria-label` and `title` |
| Mono | mono for anything a machine wrote: commands, keys, URLs, tool names |
| Settings dialog | 960×640 max, shrinking to 92vw × 86vh; the page content scrolls, the 220px nav never does |

### Settings pages
Nav order: General, Appearance, Providers, Models, Search, MCP, Sandbox, Voice,
Audit, Memory, Data, Shortcuts, Changelog, About. Every page carries a subtitle
under its title and at least one search-index term; a page without either fails
the test in `lib/settings-pages.test.ts`. Each page reuses
the same primitives — section header with the section's primary action, bordered
groups with dividers, list rows with a badge, status pill and action icons, a
callout above the content it governs, field label above input with help text
replaced by the inline error in the same spot, a segmented control for 2–4
exclusive choices, a content-only empty state, and the 960px dialog for forms.
Reuse these; don't invent siblings.

## Anti-Patterns

| Anti-pattern | Instead |
|---|---|
| Cramming a form or list into a single control column | Give it its own layout, or a dialog |
| Placeholder is the only label | A visible label above the input |
| A truncated placeholder carrying the instructions | Short placeholder, instruction as help text |
| A destructive button beside the primary one | Separate it, and confirm or offer Undo |
| Free text where a choice exists | A segmented control or a select |
| A log entry as one wrapped paragraph | A one-line summary, expand for detail |
| Raw IDs shown to the user | The thing's name, as a link |
| Status by colour alone | A pill with text and an icon |
| Silent success | A status change or a toast |
| Re-rendering a whole page while someone types | Re-render only the list region; keep typed state in the store |
| A new class or component that already exists | Search `src/components` and `src/index.css` first |

## Pre-Merge UI Checklist

- [ ] Job sentence written; every noun state and verb has a visible treatment
- [ ] Pattern chosen from the table; no bespoke layout without a reason
- [ ] One primary action per region; destructive actions separated and guarded
- [ ] Empty, loading, error, off, long-text and success states all designed
- [ ] Tokens only, no hex; no new class or component that collides with an existing one
- [ ] Keyboard path works end to end; focus survives a re-render; icon buttons labelled
- [ ] Checked at ~700px and ~1280px, light and dark, no overflow, no console errors
- [ ] Copy is sentence case, verb-led, and consistent from button to toast

## UI Instructions for the Agent

> Before writing UI, write down: the user's job in one sentence; the nouns, their
> states and the verbs; and which pattern from the table fits each part. Reuse
> the existing tokens and components; don't add a class or component without
> checking the name is unused. Never put a form, list or log inside a single
> control column. Every screen must define its empty, loading, error, off,
> long-text and success states. One primary action per region; destructive
> actions go elsewhere, and reversible removals use Undo while irreversible or
> bulk ones use a confirm dialog with a specific verb. Status is text plus
> colour. Machine strings are mono, truncated, with a way to see and copy the
> whole thing. Labels sit above inputs; errors replace help text in the same
> place, and focus moves to the first invalid field. Keep typed state in the
> store so a re-render can't lose it. Finish by running the app at two widths in
> both themes and checking the state list; don't report it done from reading the
> code.
