# Vendored transcribe-rs

- Upstream: https://github.com/cjpais/transcribe-rs
- Version: 0.3.12 (crates.io)
- License: MIT (see `LICENSE`)

Local patch: `src/onnx/session.rs` builds sessions from a shared
`ort::Environment` because this app pins `ort 2.0.0-rc.15`, while upstream pins
`2.0.0-rc.12` (`Session::builder(environment)` instead of `Session::builder()`).
`Cargo.toml` is trimmed to the dependencies the `onnx` feature needs. The public
API is unchanged.
