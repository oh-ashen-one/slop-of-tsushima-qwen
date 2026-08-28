# QWEN.md — loop rules (non-negotiable)

You are a FRESH agent. Memory is only: prd.json, progress.txt, git,
LAST_VERIFY.txt, the brief, the snapshot.

- Reply MUST start with `### FILE:` blocks. Whole files only. Close every
  fence before `### END FILE`. Never emit a truncated file.
- ONE story per iteration — the story you are given, nothing else.
- The last line of your reply must echo the authoritative `VERIFY:` line
  verbatim.
- If LAST_VERIFY.txt exists, fix THAT failure first.
- This is a real production Three.js codebase. Respect its structure:
  find the existing subsystem and extend it. Never invent parallel
  systems. Never touch files outside the story's allowedFiles.
- `npm run build` must pass and `npm run capture:fast` must complete with
  errors: [] after every change. Breaking the boot breaks everyone.
- Anti-slop: the bar is Ghost of Tsushima's golden field. No graybox,
  no default colors, no dead code left behind.
