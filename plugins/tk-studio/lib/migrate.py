"""Designed migration local -> Jira (ST-8.2, AD-16).

Rebinding a project's planning backend to Jira is a verified migration, not
a copy. The dps safety rules are ported verbatim (AD-16):

  - **Closed inventory first**: canonical entities (validated against the
    interchange shape) plus every file of the current backend projection,
    hashed, persisted before any move. Nothing not on the inventory may
    ever be deleted.
  - **Copy-then-verify-then-flag**: import = the jira adapter's promote
    (canonical -> Jira, snapshots recorded); verification = entity counts,
    a complete id map, content hashes (both against the inventory and the
    promote snapshots), and a spot round-trip read back from Jira; the
    cutover **flag** — `planning.backend: jira` in the tracked project
    config — is written last and re-verified through config resolution, so
    a crash mid-migration still reads from the source binding.
  - **No-delete-before-clearance**: at cutover the old projection's files
    are marked read-only and retained; `clear` deletes them only with the
    operator's explicit `--confirm`, only files on the inventory, and
    reports (never deletes) anything else it finds.

Any verification mismatch halts `blocked` with each discrepancy listed —
no partial state ever reads as migrated. Canonical files are never a
migration *source* in the deletable sense: they stay the authoritative
representation under every binding, Jira included (AD-4/AD-5).

CLI:
  uv run migrate.py run --directory ROOT [--dry-run]
  uv run migrate.py status --directory ROOT
  uv run migrate.py clear --directory ROOT [--confirm]

Exit codes: 0 ok; 2 blocked/refusal; 1 unexpected failure.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
import interchange
import jirabackend
import plansync

MIGRATION_VERSION = 1
RECORD_REL = Path(".tk-studio") / "migrations" / "jira.json"
TARGET = "jira"
SAMPLE_SIZE = 3


def record_path(project_root: Path) -> Path:
    return Path(project_root) / RECORD_REL


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _blocked(reason: str, **extra) -> dict:
    return {"ok": False, "blocked": True, "reason": reason, **extra}


def _load_record(project_root: Path) -> dict | None:
    path = record_path(project_root)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _save_record(project_root: Path, record: dict) -> None:
    text = json.dumps(record, ensure_ascii=False, indent=2) + "\n"
    # The record is tracked project data: relative paths and hashes only.
    configlib.assert_tracked_safe(text, str(record_path(project_root)))
    _atomic_write(record_path(project_root), text)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _entity_hash(front: dict, body: str) -> str:
    """The promote-side content hash, recomputed the adapter's way."""
    return jirabackend._content_hash(
        front["title"], ",".join(jirabackend._labels(front)),
        front.get("parent") or "", body)


# ---------------------------------------------------------------- inventory

def take_inventory(project_root: Path) -> dict:
    """Closed inventory (AD-16): validated canonical entities + every file
    of the current projection, hashed. Raises nothing — returns either the
    inventory or a blocked dict under 'blocked'."""
    project_root = Path(project_root).resolve()
    plan = plansync.plan_dir(project_root)
    entities = jirabackend._load_entities(plan)
    if not entities:
        return _blocked(f"no canonical planning entities under "
                        f"{plansync.PLANNING_REL / plansync.PLAN_DIRNAME} — "
                        f"nothing to migrate (run tk-studio-plan-sync first)")
    validation = interchange.validate_set([p for p, _, _ in entities])
    problems = list(validation["set_errors"])
    problems += [f"{f['path']}: {e}" for f in validation["files"]
                 for e in f["errors"]]
    if problems:
        return _blocked("canonical export does not validate — fix before "
                        "migrating (AD-16)", discrepancies=problems)

    try:
        source_binding, _ = configlib.resolve("planning.backend",
                                              project_root=project_root)
    except configlib.ConfigError:
        source_binding = "bmad-files"

    canonical = [{"id": front["id"], "type": front["type"],
                  "status": front["status"],
                  "path": path.relative_to(project_root).as_posix(),
                  "content_hash": _entity_hash(front, body)}
                 for path, front, body in entities]

    source_files, notes = [], []
    if source_binding == "backlog-md":
        backlog = project_root / "backlog"
        if backlog.is_dir():
            for path in sorted(backlog.rglob("*")):
                if path.is_file():
                    source_files.append(
                        {"path": path.relative_to(project_root).as_posix(),
                         "sha256": _sha256(path)})
        else:
            notes.append("backlog-md bound but no backlog/ folder — "
                         "no projection files to retain")
    else:
        notes.append(f"source binding {source_binding!r}: the canonical "
                     f"files are the backend and remain authoritative under "
                     f"jira too (AD-5) — nothing becomes read-only, nothing "
                     f"to clear")

    return {"ok": True, "taken_at": _now(), "source_binding": source_binding,
            "canonical": canonical, "source_files": source_files,
            "notes": notes}


# ------------------------------------------------------------- verification

def _verify(project_root: Path, inventory: dict, client,
            pulled: dict) -> dict:
    """Counts, id map, content hashes, spot round-trip (AD-16)."""
    project_root = Path(project_root).resolve()
    discrepancies: list[str] = []
    entities = jirabackend._load_entities(plansync.plan_dir(project_root))
    by_id = {front["id"]: (path, front, body) for path, front, body in entities}

    for conflict in pulled.get("conflicts") or []:
        discrepancies.append(
            f"pull-back conflict on {conflict['id']}: "
            f"{'; '.join(conflict['fields'])} — resolve before migrating")

    expected = [e for e in inventory["canonical"] if e["status"] != "dropped"]
    id_map: dict[str, str] = {}
    for item in expected:
        entry = by_id.get(item["id"])
        if entry is None:
            discrepancies.append(f"{item['id']}: on the inventory but no "
                                 f"longer on disk")
            continue
        path, front, body = entry
        snapshot = (front.get("external") or {}).get(jirabackend.BINDING) or {}
        if not snapshot.get("key"):
            discrepancies.append(f"{item['id']}: no Jira key after import")
            continue
        id_map[item["id"]] = snapshot["key"]
        current = _entity_hash(front, body)
        if snapshot.get("content_hash") != current:
            discrepancies.append(
                f"{item['id']}: promote snapshot hash does not match the "
                f"entity content")
        if item["content_hash"] != current:
            discrepancies.append(
                f"{item['id']}: content changed since the inventory was "
                f"taken — re-run to re-inventory")

    counts = {"expected": len(expected), "mapped": len(id_map)}
    if counts["mapped"] != counts["expected"]:
        discrepancies.append(f"counts: {counts['expected']} entities on the "
                             f"inventory, {counts['mapped']} mapped to Jira "
                             f"keys")

    # Spot round-trip: read a sample back from the backend and compare.
    sampled = []
    keyed = [e["id"] for e in expected if e["id"] in id_map]
    step = max(1, len(keyed) // SAMPLE_SIZE) if keyed else 1
    for entity_id in keyed[::step][:SAMPLE_SIZE]:
        _, front, _ = by_id[entity_id]
        key = id_map[entity_id]
        status, issue = client.request(
            "GET", f"/issue/{key}",
            query={"fields": "summary,labels,status"})
        if status != 200 or not isinstance(issue, dict):
            discrepancies.append(f"round-trip: GET /issue/{key} "
                                 f"({entity_id}) returned {status}")
            continue
        fields = issue.get("fields") or {}
        sampled.append(entity_id)
        if fields.get("summary") != front["title"]:
            discrepancies.append(
                f"round-trip {entity_id}/{key}: summary "
                f"{fields.get('summary')!r} != title {front['title']!r}")
        if entity_id not in (fields.get("labels") or []):
            discrepancies.append(
                f"round-trip {entity_id}/{key}: canonical id missing from "
                f"labels")
        category = ((fields.get("status") or {}).get("statusCategory")
                    or {}).get("key")
        wanted = jirabackend.TO_BACKEND_CATEGORY.get(front["status"])
        if category != wanted:
            discrepancies.append(
                f"round-trip {entity_id}/{key}: status category "
                f"{category!r} != expected {wanted!r} for canonical "
                f"{front['status']!r}")

    return {"ok": not discrepancies, "counts": counts, "id_map": id_map,
            "round_trip_sampled": sampled, "discrepancies": discrepancies}


# ------------------------------------------------------------------ cutover

def _flip_binding(project_root: Path) -> None:
    """Write the cutover flag: `planning.backend: jira` in the tracked
    config — textual surgery so every human-authored byte survives."""
    tracked = Path(project_root) / ".tk-studio" / configlib.TRACKED_NAME
    text = tracked.read_text(encoding="utf-8") if tracked.is_file() else ""
    lines = text.splitlines()
    planning_at = next((i for i, l in enumerate(lines)
                        if re.match(r"^planning:\s*$", l)), None)
    if planning_at is None:
        lines += (["", ""] if lines and lines[-1].strip() else []) + \
            ["planning:", "  backend: jira"]
    else:
        end = planning_at + 1
        backend_at = None
        while end < len(lines):
            line = lines[end]
            if line.strip() and not line.startswith((" ", "\t", "#")):
                break
            if re.match(r"^[ \t]+backend:\s*\S", line):
                backend_at = end
            end += 1
        if backend_at is None:
            lines.insert(planning_at + 1, "  backend: jira")
        else:
            lines[backend_at] = re.sub(r"(backend:\s*)\S.*$", r"\1jira",
                                       lines[backend_at])
    content = "\n".join(lines) + "\n"
    configlib.assert_tracked_safe(content, str(tracked))
    _atomic_write(tracked, content)


def _set_read_only(project_root: Path, inventory: dict) -> list[str]:
    marked = []
    for item in inventory["source_files"]:
        path = Path(project_root) / item["path"]
        if path.is_file():
            os.chmod(path, stat.S_IREAD)
            marked.append(item["path"])
    return marked


# ---------------------------------------------------------------------- run

def run(project_root: Path, dry_run: bool = False, client=None) -> dict:
    project_root = Path(project_root).resolve()
    if not project_root.is_dir():
        return _blocked(f"{project_root} does not exist")
    record = _load_record(project_root)
    try:
        binding, _ = configlib.resolve("planning.backend",
                                       project_root=project_root)
    except configlib.ConfigError:
        binding = "bmad-files"

    if binding == TARGET:
        if record is None:
            return _blocked("already bound to jira with no migration record "
                            "— nothing to migrate")
        if record.get("status") == "migrated":
            return {"ok": True, "action": "already-migrated",
                    "record": str(record_path(project_root)),
                    "cutover_at": record.get("cutover_at")}
        if record.get("status") == "verified":
            # crashed between flag and record: finish the record only
            record.update({"status": "migrated", "cutover_at": _now()})
            _save_record(project_root, record)
            return {"ok": True, "action": "cutover-completed",
                    "record": str(record_path(project_root))}
        return _blocked(f"binding is jira but the migration record status "
                        f"is {record.get('status')!r} — inspect "
                        f"{record_path(project_root)} before proceeding")
    if record is not None and record.get("status") == "migrated":
        return _blocked(f"migration record says migrated but the binding "
                        f"resolves to {binding!r} — inspect "
                        f"{record_path(project_root)} before re-running")

    # 1. Closed inventory before any move (AD-16).
    inventory = take_inventory(project_root)
    if inventory.get("blocked"):
        return inventory

    # 2/3. Export is the canonical shape itself (validated above);
    # transform + import ride the jira adapter — the only surface that
    # talks to the backend (AD-4).
    if dry_run:
        plan = jirabackend.project(project_root, plansync.plan_dir(project_root),
                                   dry_run=True)
        if plan.get("blocked"):
            return _blocked(plan["reason"])
        return {"ok": True, "dry_run": True, "action": "plan",
                "source_binding": inventory["source_binding"],
                "inventory": {"canonical": len(inventory["canonical"]),
                              "source_files": len(inventory["source_files"])},
                "import_plan": plan["promote"],
                "notes": inventory["notes"] + [
                    "dry-run: nothing written, backend not contacted; "
                    "verification and cutover run live only"]}

    settings, gaps = jirabackend._resolve_settings(project_root, None)
    if gaps:
        return _blocked("jira preflight: " + "; ".join(gaps))
    if client is None:
        client = jirabackend.JiraClient(settings["site"], settings["email"],
                                        settings["token"])

    record = {"migration_version": MIGRATION_VERSION, "target": TARGET,
              "source_binding": inventory["source_binding"],
              "taken_at": inventory["taken_at"],
              "inventory": {"canonical": inventory["canonical"],
                            "source_files": inventory["source_files"]},
              "status": "inventory", "notes": inventory["notes"]}
    _save_record(project_root, record)

    plan = plansync.plan_dir(project_root)
    try:
        checked = jirabackend.preflight(client, settings["project_key"])
        pulled = jirabackend.pull_back(plan, client)
        promoted = jirabackend.promote(
            plan, client, settings["project_key"], checked["mapping"],
            skip_ids={c["id"] for c in pulled["conflicts"]})
    except jirabackend.JiraError as exc:
        record.update({"status": "blocked", "reason": str(exc)})
        _save_record(project_root, record)
        return _blocked(str(exc))

    # 4. Verification — any mismatch halts blocked, discrepancies listed.
    verification = _verify(project_root, inventory, client, pulled)
    record["verification"] = {k: verification[k] for k in
                              ("ok", "counts", "round_trip_sampled",
                               "discrepancies")}
    record["id_map"] = verification["id_map"]
    if not verification["ok"]:
        record["status"] = "blocked"
        _save_record(project_root, record)
        return _blocked("verification failed — no partial state reads as "
                        "migrated (AD-16)",
                        discrepancies=verification["discrepancies"])
    record["status"] = "verified"
    _save_record(project_root, record)

    # 5. Cutover: source read-only, then the flag last, then re-verify it.
    marked = _set_read_only(project_root, inventory)
    _flip_binding(project_root)
    flag, _ = configlib.resolve("planning.backend", project_root=project_root)
    if flag != TARGET:
        return _blocked(f"cutover flag did not take: planning.backend "
                        f"resolves to {flag!r} (a local overlay may override "
                        f"it) — source binding remains authoritative",
                        record=str(record_path(project_root)))
    record.update({"status": "migrated", "cutover_at": _now(),
                   "source": {"read_only": marked, "cleared": False}})
    _save_record(project_root, record)

    return {"ok": True, "action": "migrated",
            "source_binding": inventory["source_binding"],
            "counts": verification["counts"],
            "id_map": verification["id_map"],
            "round_trip_sampled": verification["round_trip_sampled"],
            "imported": {"created": len(promoted["created"]),
                         "updated": len(promoted["updated"])},
            "source_read_only": marked,
            "record": str(record_path(project_root)),
            "notes": inventory["notes"] + promoted["notes"] + [
                "source retained read-only — delete only via "
                "`migrate.py clear --confirm` after operator clearance "
                "(AD-16 no-delete-before-clearance)"]}


# -------------------------------------------------------------------- clear

def clear(project_root: Path, confirm: bool = False) -> dict:
    project_root = Path(project_root).resolve()
    record = _load_record(project_root)
    if record is None:
        return _blocked("no migration record — nothing to clear")
    if record.get("status") != "migrated":
        return _blocked(f"migration status is {record.get('status')!r}, not "
                        f"'migrated' — the source may only be cleared after "
                        f"a verified cutover (AD-16)")
    if record.get("source", {}).get("cleared"):
        return {"ok": True, "action": "already-cleared",
                "cleared_at": record["source"].get("cleared_at")}
    if not confirm:
        return _blocked("operator clearance required: re-run with --confirm "
                        "to delete the retained source projection "
                        "(no-delete-before-clearance, AD-16)")

    deleted, missing, leftovers = [], [], []
    inventoried = {item["path"] for item in
                   record["inventory"]["source_files"]}
    roots: set[Path] = set()
    for rel in sorted(inventoried):
        path = project_root / rel
        roots.add(project_root / Path(rel).parts[0])
        if not path.is_file():
            missing.append(rel)
            continue
        os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
        path.unlink()
        deleted.append(rel)
    for root in sorted(roots):
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*"), reverse=True):
            if path.is_file():
                # not on the closed inventory: reported, never deleted
                leftovers.append(path.relative_to(project_root).as_posix())
            elif path.is_dir() and not any(path.iterdir()):
                path.rmdir()
        if root.is_dir() and not any(root.iterdir()):
            root.rmdir()

    record.setdefault("source", {}).update(
        {"cleared": True, "cleared_at": _now(), "deleted": deleted,
         "leftovers": leftovers, "missing_at_clear": missing})
    _save_record(project_root, record)
    return {"ok": True, "action": "cleared", "deleted": deleted,
            "leftovers": leftovers, "missing_at_clear": missing}


# ------------------------------------------------------------------- status

def status(project_root: Path) -> dict:
    project_root = Path(project_root).resolve()
    if not project_root.is_dir():
        return _blocked(f"{project_root} does not exist")
    record = _load_record(project_root)
    if record is None:
        return {"ok": True, "migrated": False, "record": None}
    return {"ok": True, "migrated": record.get("status") == "migrated",
            "status": record.get("status"),
            "source_cleared": bool(record.get("source", {}).get("cleared")),
            "counts": (record.get("verification") or {}).get("counts"),
            "record": str(record_path(project_root))}


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: entity titles
    # are arbitrary unicode and the status JSON must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio designed migration local -> Jira (AD-16)")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "status", "clear"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--directory", required=True, help="project root")
        if name == "run":
            cmd.add_argument("--dry-run", action="store_true")
        if name == "clear":
            cmd.add_argument("--confirm", action="store_true",
                             help="operator clearance to delete the retained "
                                  "source (AD-16)")

    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            result = run(Path(args.directory), dry_run=args.dry_run)
        elif args.command == "clear":
            result = clear(Path(args.directory), confirm=args.confirm)
        else:
            result = status(Path(args.directory))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok") else 2
    except (configlib.ClassificationError, configlib.ConfigError,
            jirabackend.JiraError, interchange.InterchangeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
