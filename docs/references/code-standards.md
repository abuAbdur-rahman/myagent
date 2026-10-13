# Code standards

## TypeScript

- **No `any`.** Use `unknown` and narrow, or generics.
- **Zod at the boundary.** Any external input (provider responses, user form
  input, persisted rows that feed decisions) is parsed, not asserted.
- Inferred types come from the schema: `z.infer<typeof schema>`. Do not hand-write
  a parallel interface.
- Prefer `type` for unions, `interface` for object shapes that may extend.
- No `console.log`. Errors go through state or a returned typed error.
- Components are function components; hooks at top level; no nested ternaries in
  JSX (extract a component or a `renderX()` helper).

## Rust

- Public commands live in their module and are registered in `lib.rs`.
- Errors: return `AppResult<T>` (= `Result<T, AppError>`). Never `unwrap()` on
  anything that can fail at runtime; `expect()` only for programmer errors at
  startup (e.g. building the HTTP client).
- Encode variant meaning precisely — vault vs network vs upstream vs internal.
  Do not funnel unrelated failures into one variant.
- Streaming: accumulate `Vec<u8>`, split on `\n`, then decode the complete line.
  Never decode a socket chunk boundary as text.
- Cancellation is a `tokio::sync::Notify` per request, removed when the request
  ends. Never leave unbounded per-request state behind.
- Reuse the managed `reqwest::Client`; never build one per call.

## Security

- Runtime secrets only ever pass through `vault.rs`.
- Keys never enter the renderer, the database, or a log line.
- Outbound URLs are validated as `http(s)` at the Zod boundary before they reach
  the proxy.
- Rendered model output is sanitized (`DOMPurify`) and code is highlighted
  locally; no remote scripts, no `eval`.
- Links in rendered markdown open through the OS opener, never in the webview.

## Comments

- Write none unless the user asks. Code should read on its own.

## Style

- Keep files focused; extract a component when a function exceeds ~60 lines.
- Match the surrounding style exactly; do not reformat adjacent code.
