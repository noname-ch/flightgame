# Notes for coding agents

Read CLAUDE.md: it holds this repo's working rules, code map and test tips for every agent, not only Claude.

The most important rule: before every push, run the smoke test from the repo root:

    node tools/smoke.mjs

It needs Node 22+ and Chrome or Chromium, and takes about 2 minutes. Push only when it ends with
`✓ smoke test passed`. If it fails, fix the errors it lists first. See "The smoke test" in CLAUDE.md.
