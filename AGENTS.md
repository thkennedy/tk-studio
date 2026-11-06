<!-- bmad:context -->
<!-- Verified 2026-10-31 against b170379. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Known pitfalls

- Name the encoding on every text-mode open (`encoding="utf-8"`); Linux defaults to UTF-8 and the Windows host to cp1252, so the sandbox gate passes what the host leg fails (DW-132) — conformance's `e2e_text_encoding` drive fails the call site.
- Write paths, renames and subprocesses for the Windows host too: a `path.join` joins with backslashes there (append the POSIX tail after `toVmPath(studioRoot(env))`, normalise a joined path before a POSIX-suffix assertion), a rename refuses an existing empty folder (WinError 183: clear it first), a `text=True` subprocess decodes cp1252 (name `encoding="utf-8"`), and every `bun test` names `--timeout` (holes 108, 110) — conformance's `e2e_windows_semantics` drive fails the call site (for `bun test`: a conformance bun drive's or `tools/verify_host.py`'s without `--timeout`); `win-ok: <reason>` exempts a proven false positive.

<!-- /bmad:context -->
