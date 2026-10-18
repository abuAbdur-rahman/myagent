# Workflow

## Branches

- `main` is always shippable.
- Work in short-lived branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Merge within days; do not let branches drift.

## Commits

Conventional Commits: `type(scope): imperative summary`.

- Types: `feat` `fix` `refactor` `perf` `docs` `test` `chore` `build` `ci`.
- Subject ≤ 50 chars (hard cap 72), imperative, no trailing period.
- `git add .` — always stage everything. Never selective staging.
- Body only when the why is non-obvious; `-` bullets, wrap 72.
- Never: AI attribution, emoji, "this commit", "I/we".

## The review gate (mandatory before push)

Both gates run on the commit you are about to push. Fix what they find before
pushing; only minor/nit findings may remain.

```bash
# 1. Dead code + dependency hygiene (TS/JS)
fallow dead-code
fallow audit --base main        # on a branch; reviews the change set

# 2. AI code review (whole commit vs its parent)
ocr review -c <sha> --audience agent

# 3. Build/type gates (must be green regardless)
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

`ocr` = OpenCodeReview. `fallow` = TS/JS codebase intelligence. If either tool is
missing, install it (`npm i -g @alibaba-group/open-code-review`, `npm i -g fallow`)
or run it via `npx -y`.

### Triage

| Finding | Action |
|---|---|
| `critical` / `high` | Must fix before push. |
| `medium` (bug) | Fix before push. |
| `low` (bug) | Fix if cheap; otherwise note in the commit body. |
| `style` / `nit` | Optional; keep only if it does not add churn. |

## Push policy

- Push only when the gates are clean.
- Never force-push.
- Never commit secrets, `.env`, `node_modules/`, `dist/`, `src-tauri/target/`.
- Pre-push sanity: `git diff --cached` shows no key material.

## GitHub Actions

- `.github/workflows/ci.yml` — on push/PR to `main`: `npm ci`, `tsc --noEmit`,
  `vite build`, `cargo fmt/clippy/check`, `cargo test`, `fallow dead-code` on
  `windows-latest`. The vitest suite runs locally (`npm test`) but is not yet a
  CI step.
- `.github/workflows/release.yml` — on a `v*` tag: `tauri-action` builds the NSIS
  installer and **publishes** a GitHub Release (not a draft), with the installer,
  its `.sig` and `latest.json`. The in-app updater reads that release.
- All third-party actions are pinned to full commit SHAs. Do not introduce a
  mutable tag; resolve the SHA and add the version as a comment.

## Releases

1. Land the release PR with a merge commit (merge commits are the convention;
   the release PR keeps its own history).
2. Tag that merge commit on `main` with the version, lightweight, no `v0.3.x`
   annotation: `git tag vX.Y.Z && git push origin vX.Y.Z`. `v0.3.1` and `v0.3.2`
   both point at their release PR's merge commit.
3. `release.yml` runs on the tag and publishes; verify the workflow run and the
   release assets before calling the release done.
4. Bump the version in `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, and add the release to
   `src/lib/releasenotes.ts` plus `docs/releases/vX.Y.Z.md`, in the release PR.

## Change summary

After a change, report:

- **CHANGES MADE:** files and what changed.
- **THINGS I DIDN'T TOUCH (intentionally):** out-of-scope items noticed.
- **POTENTIAL CONCERNS:** assumptions a reviewer should confirm.
