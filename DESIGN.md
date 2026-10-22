---
name: myagent
description: Local-first BYOK Windows chat client
colors:
  window-bg: "#202020"
  sidebar: "#1b1b1b"
  surface: "#2b2b2b"
  surface-2: "#323232"
  border: "#3d3d3d"
  text: "#f2f2f2"
  muted: "#a0a0a0"
  accent: "#c96442"
  accent-contrast: "#ffffff"
  danger: "#c42b1c"
  success: "#0f7b0f"
  warn: "#e0a040"
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
    lineHeight: 1.6
  greeting:
    fontFamily: "Georgia, Times New Roman, serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.06em"
  small:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "12px"
rounded:
  control: "4px"
  card: "8px"
  composer: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "0 10px"
    height: "32px"
  message-bubble:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "12px"
    padding: "10px 14px"
  composer:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.composer}"
    padding: "8px 10px"
---

# Design System: MyAgent

## Overview

**Creative North Star: "The Local Vault"**

The interface is a Windows desktop room the user controls: a 32px title bar with
real caption buttons, a quiet sidebar, a centered reading column, and an
artifact pane that opens beside the chat. Nothing glows for attention. Surfaces
are flat charcoal steps separated by hairline borders; a single terracotta
accent marks the few things that act — Send, primary buttons, the active row,
focus rings.

The system ships in two themes (light and dark) that share the same structure;
dark is the default and the reference. Type is the system UI stack everywhere
except two places: the welcome greeting, which is set in Georgia serif, and code,
which is Cascadia Code monospace.

**Key Characteristics:**
- Windows-native shell: custom title bar, 900px minimum width, Ctrl-first shortcuts.
- Flat tonal ladder, hairline borders, one terracotta accent.
- 32px controls, 8px cards, 12px composer and bubbles.
- Serif greeting, system UI body, monospace code.

## Colors

A charcoal ladder in dark mode and a paper ladder in light mode, with one accent
and three functional signals.

### Primary
- **Vault Clay** (#c96442): the accent. Send button, primary buttons, active
  sidebar bar, focus rings, avatar fills, model checkmarks. Six presets exist
  (Clay, Blue #0067c0, Green #0f7b0f, Purple #7a42d6, Pink #c239b3, Graphite
  #5c5c5c); the default is Clay.

### Neutral
- **Window** (#202020 dark / #f3f3f3 light): the title bar and app background.
- **Sidebar** (#1b1b1b dark / #eeeeee light): the navigation rail.
- **Surface** (#2b2b2b dark / #ffffff light): the chat column, cards, buttons.
- **Surface Raised** (#323232 dark / #f9f9f9 light): inputs, user bubbles, hover
  grounds.
- **Line** (#3d3d3d dark / #e0e0e0 light): every 1px border and input stroke.
- **Text** (#f2f2f2 dark / #1b1b1b light): body and heading text.
- **Muted** (#a0a0a0 dark / #6b6b6b light): secondary copy, labels, placeholders.

### Tertiary (functional signals)
- **Danger Red** (#c42b1c): destructive buttons and text, error banners, the
  window-close hover.
- **Stored Green** (#0f7b0f): connected status, success states.
- **Warning Amber** (#e0a040 dark / #9d5d00 light): high context usage.

### Named Rules
**The One Signal Rule.** Color appears only to carry meaning. If a color would
merely decorate, it is not used.

**The Accent-Is-Action Rule.** The accent marks things the user can act on —
never plain text, never selection alone.

## Typography

**Body Font:** Segoe UI Variable Text, Segoe UI, system-ui, sans-serif (14px/1.45)

**Character:** The system font is the brand — no webfont is loaded, so type
renders identically offline and with the network unplugged.

### Hierarchy
- **Greeting** (Georgia serif, 600, 28px, 1.25): the welcome screen and the
  Projects title. The only serif on any screen.
- **Title** (600, 20–22px): dialog and view headings (Settings, project detail).
- **Chat** (400, 15px, 1.6): message and composer text.
- **Body** (400, 14px, 1.45): UI chrome, lists, form copy.
- **Small** (400, 13px): buttons, table cells, menu items.
- **Micro** (400–500, 11–12px, 0.06em, uppercase for group headers): sidebar
  section labels, badges, hints, table metadata.
- **Mono** (Cascadia Code, Consolas, 12px): code, kbd, token counts, URLs.

### Named Rules
**The System-Font Rule.** No webfont is loaded, ever.

**The Serif-Is-Greeting Rule.** Serif appears only in the welcome greeting and
top-level view titles — nowhere else.

## Layout

A title bar (32px) sits above a three-column grid: sidebar (260px, collapsible
to 56px) | main column | artifact panel (0 or 420px). The reading column is
capped at 760px and centered; the welcome column at 720px. The composer is
anchored to the bottom of the thread with a context bar above it. Minimum window
size is 900×560. Regions scroll independently; there is no page scroll.

## Elevation & Depth

**The Flat-By-Default Rule.** No shadows on surfaces. Depth comes from the tonal
ladder and 1px Line borders. The only shadows in the system belong to floating
layers: modal dialogs, popover menus, the command palette, and toasts
(`0 8px 24px rgba(0,0,0,.14)` light / `.5` dark).

## Shapes

Controls are 4px rectangles; cards, inputs and panels are 8px; the composer,
message bubbles and dialogs are 12px. Icon buttons are square 32/28/24px grids.
The Send button is a 32px accent circle. Borders are always 1px Line.

## Components

### Buttons
- **Shape:** 4px radius, 32px height (28px small), 12px horizontal padding.
- **Primary:** accent fill with white text — the single main action per view.
- **Default:** surface fill with a Line border.
- **Ghost:** transparent, muted text — icon and tertiary actions.
- **Danger:** red text with red border; **Danger Fill:** red fill, white text.
- **Hover / Focus:** hover steps the tone; focus draws a 2px accent ring. No
  transforms, no lift.

### Inputs / Fields
- **Style:** Line stroke on Surface Raised fill, 8px radius, 32px height.
- **Focus:** the stroke becomes the accent with a 1px accent ring.
- **Toggles:** 40×20 pill switches; **Segmented:** bordered groups with an
  accent-filled active segment (used in settings).

### Sidebar
- **Style:** flat 260px rail on Sidebar tone with a right hairline; collapses to
  a 56px icon rail.
- **Rows:** 32–34px, 4px radius; active chat rows get a 3px accent bar at the
  left edge; project rows show a stable color dot.
- **Groups:** sticky uppercase micro headers (Pinned, Today, Yesterday,
  Previous 7 days, Older).
- **Footer:** a settings icon plus a profile button (avatar, name, plan) opening
  a small menu.

### Message
- **User:** right-aligned bubble on Surface Raised with a Line border, 12px
  radius, max 80% width; hover reveals copy and edit actions.
- **Assistant:** accent-ring avatar with the model name in muted micro type, then
  rendered markdown; streaming shows an accent caret, and no in-transcript dots —
  the activity pill above the composer owns that signal; hover reveals copy,
  regenerate (last only), branch, thumbs up/down, artifact and remember actions.
- **Attachments:** a 168px card per document — type chip from the mime type, name
  wrapping to two lines, and a meta line with size and character count ("Size
  unknown" when it is).

### Composer
- **Shape:** 12px radius container on Surface Raised with a Line border; accent
  border + ring while focused.
- **Contents:** auto-growing textarea (to ~8 lines), an attachment row when used,
  and a tool row: model chip, effort (only where the provider takes it), mic, and
  a 32px round Send button (accent; gray when disabled) that becomes Stop while
  streaming. No token estimate — the context bar above the box already answers
  that question with provider numbers.
- **Slash menu:** an anchored popover above the box for `/new /clear /memory
  /settings`, with arrow-key navigation.
- **Paste:** a block-looking paste arrives as a fenced code block with a guessed
  language; Undo restores the raw paste at the same position.
- **Footer:** a centered muted disclaimer line.

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
- **Progress dock:** 344px right-hand pane with a left hairline and a 48px
  header: steps in position order, Outputs (the first two artifacts as cards, the
  rest and written files as rows), and Used in this session (uploads, images,
  tools, search domains).
- **Artifact dock:** 480px by default, resizable and persisted; the header starts
  with a Back arrow to Progress, then title, language badge, tabs, Copy, Download,
  minimize, fullscreen and Close.
- **Narrow windows:** below 1100px the open panel overlays the app with a dimmed
  backdrop and traps focus; closing returns focus to the header trigger.
- **Outputs gallery:** the sidebar entry opens a grid of the chat's artifacts and
  written files, each with the same sandboxed thumbnail the panel uses.

### Sidebar
- **Style:** flat 260px rail on Sidebar tone with a right hairline; collapses to
  a 56px icon rail.
- **Rows:** 32–34px, 4px radius; active chat rows get a 3px accent bar at the
  left edge; project rows show a stable color dot.
- **Groups:** sticky uppercase micro headers (Pinned, Today, Yesterday,
  Previous 7 days, Older).
- **Filter:** All chats, Pinned or one project by name; a filtered empty list
  names the filter and offers Show all chats instead of reading like data loss.
- **Footer:** a settings icon plus a profile button (avatar, name, plan) opening
  a small menu.

### Command Palette
- **Shape:** a 560px modal pinned near the top over a dimmed app, with a 48px
  search row, section headers, 36px rows, and a keyboard-hint footer.

### Toasts & Confirms
- **Toasts:** bottom-center dark pills with optional action buttons, auto-dismiss.
- **Confirms:** small centered dialogs with Cancel plus a primary or
  danger-filled confirm; Esc and backdrop both cancel.

## Do's and Don'ts

### Do:
- **Do** separate regions with a 1px Line border or a step on the tonal ladder.
- **Do** reserve the primary button for the single main action on a screen.
- **Do** keep the reading column at 760px and the welcome column at 720px.
- **Do** show keyboard focus with a visible 2px accent ring on every control.
- **Do** keep destructive actions behind the confirm dialog.

### Don't:
- **Don't** add shadows to surfaces; floating layers only.
- **Don't** load a webfont or use serif outside greetings and view titles.
- **Don't** ship a control that does nothing — omit it until it works.
- **Don't** use color as the only cue for state.

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
| Radii | 4 buttons, rows, chips · 8 inputs, cards, groups · 12 dialogs, composer, bubbles |
| Control heights | 24 small icon button · 28 small button · 32 default button and input · 34 settings nav row · 48 header |
| Type (px) | 11 micro and tags · 12 meta, help, mono · 13 dense body and buttons · 14 base · 15 chat · 20–22 title · 28 greeting |
| Spacing (px) | 4, 6, 8, 10, 12, 16, 20, 24, 28 — no other values |
| Colour | tokens only: `--bg --sidebar --surface --surface-2 --border --text --muted --hover --active --accent --accent-contrast --danger --success --warn --shadow`. Never hard-code hex; the accent is user-selectable |
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
