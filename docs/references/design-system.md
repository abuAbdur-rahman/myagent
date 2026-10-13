# Design system (summary)

`DESIGN.md` is the system of record. This file is the working summary.

## North star

**The Local Vault** — a sealed room the user controls. Quiet, near-black,
monochrome, flat. Color is a signal, never decoration.

## Tokens (defined in `src/index.css` via Tailwind v4 `@theme`)

Use the semantic token, not a raw hex, not a Tailwind palette color.

| Token | Value | Use |
|---|---|---|
| `vault-black` | `#0a0a0a` | page + assistant surface |
| `vault-surface` | `#171717` | inputs, sidebar wash, user message |
| `vault-raised` | `#262626` | hover/selected rows, secondary fill |
| `vault-line` | `#404040` | every 1px border and input stroke |
| `text-primary` | `#f5f5f5` | body text |
| `text-muted` | `#a3a3a3` | secondary copy |
| `text-faint` | `#737373` | placeholders, micro-labels |
| `accent-link` | `#60a5fa` | markdown links only |
| `destroy` / `destroy-hover` | `#dc2626` / `#ef4444` | destructive actions |
| `alarm` | `#fca5a5` | error text |
| `stored` | `#4ade80` | "key stored" status |
| `focus` | `#737373` | 2px focus ring |

Radii: `rounded-control` (6px) for controls, `rounded-panel` (8px) for panels and
messages.

## Rules (do not break)

1. **No shadows.** Separate regions with a border or a tone step.
2. **One accent.** Blue is for outbound links only — never selection or emphasis.
3. **System font only.** No webfont, ever; the app must render identically offline.
4. **Focus is always visible.** Every interactive element shows a 2px `focus` ring
   on `:focus-visible`.
5. **Uppercase only for micro-labels** (role markers, eyebrows).
6. **Reading measure** stays at 768px.

## Accessibility floor

- Keyboard: everything reachable, tab order logical, no traps.
- Dialogs: `role="dialog"`, `aria-modal`, labelled, focus moves in on open.
- Errors: `role="alert"` plus a dismiss control; never color-only.
- Controls that are icon-only carry `aria-label`.

## Verify UI changes

```bash
node <impeccable>/scripts/detect.mjs --json src   # mechanical detector
```

For frontend work, also run the `impeccable` skill for a critique/audit pass.
