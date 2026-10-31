<!-- bmad:context -->
<!-- Verified 2026-10-31 against b170379. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Known pitfalls

- Name the encoding on every text-mode open (`encoding="utf-8"`); Linux defaults to UTF-8 and the Windows host to cp1252, so the sandbox gate passes what the host leg fails (DW-132) — conformance's `e2e_text_encoding` drive fails the call site.

<!-- /bmad:context -->
