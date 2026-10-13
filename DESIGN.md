---
name: myagent
description: Local-first BYOK Windows chat client
colors:
  vault-black: "#0a0a0a"
  vault-surface: "#171717"
  vault-surface-raised: "#262626"
  vault-line: "#404040"
  text-primary: "#f5f5f5"
  text-muted: "#a3a3a3"
  text-faint: "#737373"
  accent: "#60a5fa"
  danger: "#dc2626"
  danger-text: "#fca5a5"
  success: "#4ade80"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.625
  heading:
    fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.025em"
rounded:
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.text-primary}"
    textColor: "{colors.vault-black}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.vault-surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  input:
    backgroundColor: "{colors.vault-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  panel:
    backgroundColor: "{colors.vault-black}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: myagent

## Overview

**Creative North Star: "The Local Vault"**

The interface is a sealed room the user controls. Nothing glows for attention,
nothing announces itself. Surfaces are quiet and near-black; a single hairline
border is the only separation between one region and the next. The mood is calm
custody rather than productivity theater — the app holds secrets and history, and
it behaves like a good safe: present, unremarkable, trustworthy.

The system is deliberately monochrome. Color is a signal, not decoration — blue
means "this is a link you can leave through", red means "this destroys
something", green means "this secret is stored". No accent is used for emphasis,
brand, or personality. Restraint is the identity.

Density is comfortable rather than packed: a solo user reading long model
answers needs air around the text, not a console's compression.

**Key Characteristics:**
- Near-black tonal ladder, no shadows, hairline borders only.
- One accent color (blue) reserved for outbound links.
- Sentence-light labels, uppercase only for status micro-labels.
- Flat at rest and flat on interaction; state is shown by tone, not lift or glow.

## Colors

A near-black neutral ladder with three functional signals and no decorative hue.

### Primary
- **Outbound Blue** (#60a5fa): links inside rendered markdown only. It signals
  "this leaves the app through the system browser". Never used for buttons,
  selection, or emphasis.

### Neutral
- **Vault Black** (#0a0a0a): the page background and the assistant's message
  surface. The deepest tone; everything else sits above it.
- **Vault Surface** (#171717): input fields, the sidebar wash, and user message
  blocks — a first step up from black.
- **Vault Surface Raised** (#262626): hover and selected rows, secondary button
  fill. The highest neutral step in normal use.
- **Vault Line** (#404040): hairline borders and input strokes. The only
  structural separator in the system.
- **Text Primary** (#f5f5f5): body and heading text.
- **Text Muted** (#a3a3a3): secondary copy, connection metadata, labels.
- **Text Faint** (#737373): placeholders, timestamps, disabled affordances.

### Tertiary (functional signals)
- **Destroy Red** (#dc2626): destructive button fill and the delete affordance.
- **Alarm Text** (#fca5a5): error banner text over a dark red ground.
- **Stored Green** (#4ade80): the single "key is stored" status word.

### Named Rules
**The One Signal Rule.** Color appears only to carry meaning — a link, a
destruction, a stored secret. If a color would merely make something prettier, it
is not used.

**The No-Accent-For-Emphasis Rule.** Never tint a button, a selected row, or a
heading with the accent. Selection is shown with `neutral-800`; the accent is for
links alone.

## Typography

**Body Font:** system UI stack (ui-sans-serif, system-ui, "Segoe UI", Roboto,
sans-serif)

**Character:** The system font *is* the brand — no webfont, no download, no
network dependency. This is a deliberate match to the product's local-first
stance: the type must render identically with the network unplugged.

### Hierarchy
- **Heading** (600, 18px, 1.4): empty-state title and dialog titles. Used
  sparingly; most screens have none.
- **Body** (400, 14px, 1.625): message text, labels with values, form copy.
- **Label** (500, 12px, 0.025em, uppercase for micro-labels): the "YOU" /
  "ASSISTANT" role markers and section eyebrows. Uppercase is reserved for these
  alone.
- **Micro** (400, 12px): metadata lines, placeholders, status text.

### Named Rules
**The System-Font Rule.** No webfont is loaded, ever. Type must be identical
offline and must not add a network request.

## Layout

A two-region shell: a fixed 256px chat sidebar on the left, a flexible main
column on the right, and an optional 420px artifact panel that slides in from
the right edge. The main column centers its content at a 768px reading measure so
long answers keep a comfortable line length.

Vertical rhythm inside the reading column is a 24px gap between messages. The
header is a fixed 56px bar; the composer is anchored to the bottom with 16px of
padding. There is no page scroll — regions scroll independently.

## Elevation & Depth

**The Flat-By-Default Rule.** The system uses no shadows anywhere. Depth is
conveyed entirely by the neutral ladder (Vault Black → Vault Surface → Vault
Surface Raised) and 1px Vault Line borders. A raised region is a lighter fill,
never a floating card.

Dialogs are the single exception in spirit but not in form: the overlay dims the
page with a 60% black scrim, and the dialog itself is still a flat bordered
surface — it is separated by the scrim, not by a shadow.

### Named Rules
**The No-Shadow Rule.** No `box-shadow` outside the dialog's least-necessary
case. If a region needs to separate, step the tone or add a border.

## Shapes

Form language is soft-rectangular and uniform. Interactive controls (buttons,
inputs, selects, textareas) use a 6px radius; the message blocks, panels, and the
dialog use an 8px radius. There are no pills, no circles except the streaming
"thinking" dots, and no clipped or notched silhouettes. Borders are always 1px
and always Vault Line, never brighter on hover.

## Components

### Buttons
- **Shape:** gently curved (6px radius), 36px height, 16px horizontal padding.
- **Primary:** near-white fill (`text-primary`) on Vault Black text — the single
  high-contrast action on a screen (Send, Save). Used once per view.
- **Secondary:** Vault Surface Raised fill with Text Primary — supporting actions
  (New, Store, artifact openers).
- **Ghost:** transparent, Text Muted, fills with neutral-800 on hover — icon and
  tertiary actions (Close, Copy).
- **Destructive:** Destroy Red fill with white text — Stop, Delete.
- **Hover / Focus:** hover steps the fill one neutral up; focus draws a 2px
  neutral-500 ring via `focus-visible` only. No transform, no lift.

### Inputs / Fields
- **Style:** 1px Vault Line stroke on Vault Surface fill, 6px radius, 36px height,
  Text Primary text, Text Faint placeholder.
- **Focus:** the stroke brightens to neutral-500 and a focus ring appears; there
  is no glow.
- **Disabled:** reduced opacity, no fill change.

### Cards / Containers
- **Corner Style:** 8px radius.
- **Background:** assistant messages on Vault Black, user messages on Vault
  Surface; panels on Vault Black or a 40% Vault Surface wash.
- **Border:** always 1px Vault Line.
- **Shadow Strategy:** none (see Elevation & Depth).

### Navigation
- **Style:** the chat sidebar is a flat 256px column on a 40% Vault Surface wash
  with a single right hairline. Rows are 6px-radius; the active row is
  neutral-800. Row labels are single-line, truncated, 14px.
- **States:** active = neutral-800 fill; hover = 60% neutral-800; the delete
  affordance appears on hover and on keyboard focus.

### Message
- **Role label:** 12px uppercase Text Faint eyebrow above each block.
- **Body:** rendered markdown at 14px/1.625, or a whitespace-preserving block for
  user text.
- **Streaming:** three neutral-500 dots pulsing on a 150ms stagger — the only
  motion in the system.

### Artifact Panel
- **Signature component.** A 420px right-hand pane holding one extracted code
  block, with a 48px header carrying the language name, a Copy ghost button, and
  a Close icon. Code is monospace at 12px on Vault Surface Raised.

## Do's and Don'ts

### Do:
- **Do** separate regions with a 1px Vault Line border or a step on the neutral
  ladder — never a shadow.
- **Do** reserve `text-primary` buttons for the single most important action on a
  screen.
- **Do** keep the reading column to a 768px measure.
- **Do** show keyboard focus with a visible 2px ring on every interactive element.

### Don't:
- **Don't** introduce a second accent hue or tint a selection with blue.
- **Don't** add hover transforms, lifts, or glows; hover is a tone step only.
- **Don't** load a webfont — the system stack is the identity.
- **Don't** use color as the only cue for state (errors pair Alarm Text with an
  alert role and a dismiss control).
