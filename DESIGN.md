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
  rendered markdown; typing shows three pulsing dots, streaming shows an accent
  caret; hover reveals copy, regenerate (last only), branch, artifact and
  remember actions.

### Composer
- **Shape:** 12px radius container on Surface Raised with a Line border; accent
  border + ring while focused.
- **Contents:** auto-growing textarea (to ~8 lines), an attachment row when used,
  and a tool row: model chip, token estimate, and a 32px round Send button
  (accent; gray when disabled) that becomes Stop while streaming.
- **Slash menu:** an anchored popover above the box for `/new /clear /memory
  /settings`, with arrow-key navigation.
- **Footer:** a centered muted disclaimer line.

### Artifact Panel
- **Shape:** a 420px right-hand pane with a left hairline and a 48px header.
- **Header:** title, language badge, Preview/Code or Doc/Source tabs, Copy,
  Download, Close.
- **Body:** sandboxed iframe preview for HTML, rendered document for Markdown,
  plain source otherwise; a muted footer names the active view.

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
