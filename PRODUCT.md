# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo Windows power users who already hold their own model provider credentials
(OpenRouter or an OpenAI-compatible endpoint) and want a single desktop client
for chat work. They run one machine, install from an NSIS package, and expect
their keys and history to stay on that machine.

## Product Purpose

A Windows-only desktop chat client that lets one user talk to any
OpenAI-compatible model through their own key. Success means: install, paste a
key, pick a model, chat with streaming responses that persist locally — with no
account, no sign-in, and no server the user did not choose.

## Positioning

Local-first bring-your-own-key with zero telemetry. Unlike Claude Desktop and
OpenWebUI-style deployments, there is no hosted backend at all: credentials live
in the Windows Credential Manager, requests are proxied from the Rust process,
and conversation history is a local SQLite file. A neighboring hosted product
could not truthfully make the same claim about where secrets and chats live.

## Operating Context

Single Windows desktop window. The user adds one or more connections (OpenRouter
or a custom OpenAI-compatible base URL), stores an API key per connection,
selects a model, and chats. Responses stream token by token. Code blocks in
replies open in a side artifact panel. Sessions resume from a local chat list.

## Capabilities and Constraints

Shipped: multiple connections with per-connection keys; model list fetched from
the provider; streaming chat completions with cancellation; local conversation
and message history; artifacts panel for code blocks; dark-only UI.

Required but not yet built: **Memory** — durable user/assistant context that
persists across chats — and **Projects** — grouping work with shared context.
Both are explicitly important to the product and must be designed for, not
treated as optional.

Constraints: Windows-only; no backend server; no accounts or sign-in; keys never
reach the webview; chat, history, and artifacts define the v1 scope boundary.

## Evidence on Hand

No testimonials, benchmarks, customers, or marketing assets exist. Future work
must not fabricate them.

## Product Principles

1. The secret never leaves the machine. Any feature that would move a key or a
   chat off-device is out unless the user explicitly asks for it.
2. One user, one machine. Design for a solo power user, not teams or admins.
3. Local truth. History and settings are the local database; the network is only
   ever the user's chosen provider.
4. Chat first. Memory and Projects extend the core chat loop; they do not
   replace it.
5. No ceremony. Install, key, model, chat — no sign-up or onboarding maze.

## Accessibility & Inclusion

No product-specific requirement recorded. Standard desktop expectations apply:
full keyboard reach, visible focus, and readable contrast.
