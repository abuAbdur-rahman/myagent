# Design system (summary)

`DESIGN.md` is the system of record. This file is the working summary.

## North star

**The Local Vault** — a Windows desktop room the user controls. A warm four-step
surface ramp, alpha hairlines, one accent hue. Light and dark themes share one
structure; dark is the reference.

## Shell

36px custom title bar with real caption buttons and a centred command search,
then a three-column grid: sidebar (264px, collapsible to 56px) | main canvas |
artifact panel (400px, resizable 360–640). The main canvas rounds over the
sidebar at 16px. Minimum window 900×560. Regions scroll independently.

## Tokens (defined in `src/index.css` via Tailwind v4 `@theme inline`)

Use the semantic token, not a raw hex. Light values live on `:root`; dark values
under `:root[data-theme="dark"]`. `data-theme` is always set.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg-sunken` | `#1a1917` | `#f0eee9` | title bar, sidebar, settings nav |
| `bg-canvas` | `#232220` | `#faf9f6` | chat column, panels |
| `bg-raised` | `#2b2a27` | `#ffffff` | composer, bubble, cards, modal |
| `bg-overlay` | `#32312d` | `#ffffff` | menus, popovers, tooltips |
| `fill-1/2/3` | 3.5 / 6.5 / 12% | 3 / 5.5 / 9% | inset, hover, active |
| `line-subtle/line/line-strong` | 7 / 12 / 22% | 7 / 13 / 26% | dividers, controls, hover |
| `text` | `#ebe8e2` | `#1f1d1a` | body text |
| `text-2` | `#b4afa6` | `#5d5953` | secondary copy |
| `text-3` | `#a19c93` | `#6e6962` | meta, labels, placeholders |
| `text-off` | `#6a665f` | `#a39e95` | disabled only |
| `accent-solid` | `oklch(.55 .14 hue)` | same | primary fill, toggle-on, Send |
| `accent-text` | `oklch(.78 .12 hue)` | `oklch(.50 .14 hue)` | links, accent icons |
| `accent-soft` | 16% | 12% | selected tint |
| `danger` | `#f0757c` | `#be2f3a` | destructive, errors |
| `success` | `#6cc48a` | `#1d7a3e` | connected |
| `warning` | `#e6b055` | `#8a5a00` | needs attention |
| `info` | `#7db1f0` | `#1f5fae` | information |

The accent is a hue preset (`data-accent`): Clay 38, Blue 255, Green 150,
Violet 295, Pink 350, Graphite 80. Settings → Appearance writes the id; a saved
legacy hex is migrated in `lib/accent.ts`.

Radii: `rounded-chip` 6 (tags), `rounded-field` 8 (buttons, inputs, rows),
`rounded-card` 12 (cards, code), `rounded-composer` 16 (composer, dialogs),
`rounded-full` for toggles, avatars and status pills.

## Rules (do not break)

1. **Surface first, hairline second.** Never a surface and a border on one edge.
2. **One signal per state.** Hover = fill-2, active = fill-3 + text, focus = ring.
3. **Accent means action.** One solid accent button per view. Body text never
   uses solid accent; use `accent-text`.
4. **System font only** (Segoe UI stack); serif (Georgia, weight 400) only for
   page titles and the welcome greeting; monospace (Cascadia Code) only for code,
   URLs, keys and shortcuts.
5. **12px is the text floor.** No 10–11px readable text. Uppercase only for tags.
6. **Focus is always visible.** 2px accent-line ring, 2px offset.
7. **No dead controls.** Omit a control until it works.
8. **Reading measure** stays at 720px; the composer at 760px.
9. **Touch/click targets** ≥ 28px; icon-only controls carry `aria-label` and a
   tooltip.

## Accessibility floor

- Keyboard: everything reachable, tab order logical, no traps; Ctrl+K / Ctrl+N /
  Ctrl+, / Ctrl+B / Ctrl+Shift+A / Esc all work.
- Dialogs and the palette: `role="dialog"`, `aria-modal`, labelled, focus moves
  in on open, Esc closes.
- Errors: `role="alert"`, plain language, Retry, technical text behind Details;
  never colour-only.
- Status is an icon plus a word plus colour.
- Controls that are icon-only carry `aria-label`.

## Verify UI changes

```bash
node <impeccable>/scripts/detect.mjs --json src   # mechanical detector
```

For frontend work, also run the `impeccable` skill for a critique/audit pass.
