# Design system (summary)

`DESIGN.md` is the system of record. This file is the working summary.

## North star

**The Local Vault** — a Windows desktop room the user controls. Flat charcoal
steps, hairline borders, one terracotta accent. Light and dark themes share one
structure; dark is the reference.

## Shell

32px custom title bar with real caption buttons, then a three-column grid:
sidebar (260px, collapsible to 56px) | main column | artifact panel (0 or 420px).
Minimum window 900×560. Regions scroll independently.

## Tokens (defined in `src/index.css` via Tailwind v4 `@theme inline`)

Use the semantic token, not a raw hex. Light values live on `:root`; dark values
under `:root[data-theme="dark"]`; the theme is switched by setting the attribute.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#202020` | `#f3f3f3` | title bar + app background |
| `sidebar` | `#1b1b1b` | `#eeeeee` | navigation rail |
| `surface` | `#2b2b2b` | `#ffffff` | chat column, cards, buttons |
| `surface-2` | `#323232` | `#f9f9f9` | inputs, user bubbles, hover grounds |
| `border` | `#3d3d3d` | `#e0e0e0` | every 1px border and input stroke |
| `text` | `#f2f2f2` | `#1b1b1b` | body text |
| `muted` | `#a0a0a0` | `#6b6b6b` | secondary copy |
| `accent` | `#c96442` | `#c96442` | send, primary, active bar, focus, avatars |
| `danger` | `#c42b1c` | `#c42b1c` | destructive actions, errors, close hover |
| `success` | `#0f7b0f` | `#0f7b0f` | connected status |
| `warn` | `#e0a040` | `#9d5d00` | high context usage |

The accent is a runtime CSS variable — presets (Clay/Blue/Green/Purple/Pink/
Graphite) set it from Settings → Appearance.

Radii: `rounded-control` (4px) for controls, `rounded-card` (8px) for cards and
inputs, `rounded-composer` (12px) for the composer, bubbles and dialogs.

## Rules (do not break)

1. **No shadows on surfaces.** Floating layers (dialogs, popovers, palette,
   toasts) alone may cast one.
2. **Accent means action.** Never plain text, never selection alone.
3. **System font only** (Segoe UI stack); serif (Georgia) only for the welcome
   greeting and top-level view titles; monospace (Cascadia Code) only for code.
4. **Focus is always visible.** 2px accent ring on `:focus-visible`.
5. **Uppercase only for micro-labels** (sidebar groups, badges).
6. **No dead controls.** Omit a control until it works.
7. **Reading measure** stays at 760px (welcome at 720px).

## Accessibility floor

- Keyboard: everything reachable, tab order logical, no traps; Ctrl+K / Ctrl+N /
  Ctrl+, / Ctrl+B / Ctrl+Shift+A / Esc all work.
- Dialogs and the palette: `role="dialog"`, `aria-modal`, labelled, focus moves
  in on open, Esc closes.
- Errors: `role="alert"` plus a dismiss control; never color-only.
- Controls that are icon-only carry `aria-label`.

## Verify UI changes

```bash
node <impeccable>/scripts/detect.mjs --json src   # mechanical detector
```

For frontend work, also run the `impeccable` skill for a critique/audit pass.
