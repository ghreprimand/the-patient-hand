# The Patient Hand

A visually-stunning take on the classic water-sort puzzle. Tap a tube, tap another, pour the top color, sort every tube to one color. Wrapped in a real-time fluid surface simulation, custom WebGL2 glass refraction shader, particle splashes, completion glow, and a warm 17th-century apothecary frame.

The thesis: in a genre defined by spreadsheet-grade visuals, the prettiest version wins by default.

> **Status:** in early development. The full design and 14-day build plan live in [`docs/design.md`](./docs/design.md).

## Quick links

- [Design doc & build plan](./docs/design.md)
- [License (MIT)](./LICENSE)

## Repository conduct (read this before contributing)

This repository is **public**. Treat it accordingly.

- **No secrets in the repo, ever.** No API keys, tokens, `.env` files, signing keys, deploy credentials, internal tooling output, or personal notes. The `.gitignore` enforces the obvious cases — `.env*`, `.archon/`, `.claude/`, `secrets/`, `credentials/`, etc. — but `.gitignore` is a backstop, not a strategy. **Run `git status` before every commit and read what you're staging.**
- **If a secret is committed by accident, treat it as permanently disclosed.** Rotate the credential immediately. Do not "fix it later" with a force-push or rebase — assume it has already been scraped by the time you notice.
- **No personal or unrelated material.** This repo is the game and only the game. Brainstorm scratch, design alternatives that didn't ship, agent transcripts, etc. live outside the repo and are excluded by `.gitignore`.
- **Auto-commit cadence.** Work proceeds with frequent commits and pushes — at minimum once per completed checklist item in the build plan, and always at the end of a working session. Use descriptive commit messages (imperative mood, what + why). Push directly to `main`; no PR review at v1.

## Tech stack (planned)

- Vite + TypeScript
- WebGL2, custom render wrapper (no Three.js / Pixi)
- Web Audio API
- HTML/CSS overlay UI
- Cloudflare Workers + KV for the daily leaderboard backend
- Zero runtime dependencies

## License

Code under [MIT](./LICENSE). Art assets shipped with the repo are CC0 or CC-BY (specific attribution per asset, where applicable).
