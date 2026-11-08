---
id: visualize
title: Inline visual
version: 1.0.0
triggers: ["visualize", "visualise", "inline ui", "interactive", "diagram", "slider", "simulate"]
requires_tools: []
requires_imports:
  python: []
  node: []
network: none
writes: []
summary: Build one interactive inline visual as part of a normal answer. The visual supports the prose; it never replaces the explanation, summary or next steps.
---

# Inline visual

Use this when the user asks to see something, compare how inputs change a result,
or explore a mechanism. The visual is one part of the reply, never the reply.

## Shape

- Answer normally in Markdown. Put one short sentence before the block, the
  block, then the takeaway, caveats or next steps after it.
- Exactly one fence marked `viz` per reply. Nothing else goes inside it.
- The fence contains a complete HTML document: doctype, `head` with `style`,
  `body`, and `script` at the end.
- If a table, list or two paragraphs answer it better, skip the visual.
- Continue the conversation after the block. Do not stop at the visual.

## Contract

- Inline CSS and JS only. HTTPS CDN scripts are allowed when a library earns
  its weight; pin the version and use at most two.
- No `fetch`, XHR, WebSocket, form submission, external iframe,
  `localStorage`, `sessionStorage` or `window.open`. The sandbox blocks them.
- The frame is 320–900 px wide. Height is measured from the document, so keep
  it under 1200 px and never use `100vh` or `100vw`.
- Match the app with the tokens it sends:
  `var(--myagent-bg)`, `var(--myagent-fg)`, `var(--myagent-muted)`,
  `var(--myagent-border)`, `var(--myagent-accent)`, `var(--myagent-card)`,
  `var(--myagent-radius)`. Give each a fallback for the first paint.
- Use real controls: `<button>`, `<input type="range">`, `<label>`. Every
  control has a label and works from the keyboard. Changing values update the
  DOM directly, and an `aria-live="polite"` node announces new results.
- Keep contrast readable and text at 13 px or more.
- Any number the user did not supply is illustrative. Say so in the prose or
  in a small caption, never present it as measured.

## Skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: var(--myagent-bg, #fff);
    --fg: var(--myagent-fg, #171717);
    --muted: var(--myagent-muted, #737373);
    --line: var(--myagent-border, #e5e5e5);
    --accent: var(--myagent-accent, #2563eb);
  }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  .row { display: flex; align-items: center; gap: 12px; }
  output { font-variant-numeric: tabular-nums; font-weight: 600; }
</style>
</head>
<body>
  <div class="row">
    <label for="calls">Tool calls</label>
    <input id="calls" type="range" min="1" max="50" value="10">
    <output id="value" for="calls" aria-live="polite">10</output>
  </div>
  <p style="color: var(--muted)">Illustrative model, not a measurement.</p>
  <script>
    const input = document.getElementById("calls");
    const value = document.getElementById("value");
    input.addEventListener("input", () => { value.textContent = input.value; });
  </script>
</body>
</html>
```

## Failure modes to avoid

- A wall of numbers already in the prose, duplicated inside the visual.
- A chart that never changes when its control moves.
- Script that reads a value before the element exists; put it at the end of
  `body` or wait for `DOMContentLoaded`.
- Uncaught errors: a broken document shows its source instead of rendering.
- Ending the reply at the visual with no explanation.
