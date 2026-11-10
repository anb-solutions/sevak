# Notes for AI coding agents

Whatever tool you are (Claude Code, Codex, Cursor, Copilot or another), read these before
changing Sevak:

1. [`CLAUDE.md`](CLAUDE.md): what Sevak is, the layout, the commands and the rules.
2. [`.claude/skills/steward/SKILL.md`](.claude/skills/steward/SKILL.md): **before every push,
   review or merge**, especially if you merge your own pull request. It says what must be
   checked, what to try to break, and which changes need the owner.

A merge into `staging` is a release: it deploys within minutes, and real people use it.
