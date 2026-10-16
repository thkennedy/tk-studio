"""The supervisor-into-monorepo rehearsal is a script with a report (Story 28.1, AD-21, ADR section 5).

tools/restructure/rehearse.py is pinned here against a fake pair of small repositories built with
real git in a temp folder (git config isolated, no network). The real git-filter-repo is used when
it is on PATH; otherwise a small fake rebuilds the fake's linear history under the prefix.
"""
from __future__ import annotations

import argparse
import io
import os
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = PLUGIN_ROOT.parents[1] / "tools" / "restructure" / "rehearse.py"
sys.path.insert(0, str(PLUGIN_ROOT.parents[1] / "tools" / "restructure"))
import rehearse  # noqa: E402  (repo-side, like release_archive in test_release_roster)

IDENTITY = ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost"]
BRANCH = "restructure/supervisor-into-monorepo"
SECTIONS = ["## Step 1 — Freeze", "## Step 2 — Rewrite", "## Step 3 — Merge",
            "## Step 4 — Nested studio project", "## Step 5 — Sandboxes", "## unverifiable-here"]
HOOK_EVENTS = ("SessionStart", "Stop", "SessionEnd", "PreCompact")

FAKE_FILTER_REPO = r'''
import os, subprocess, sys
args = sys.argv[1:]
prefix = args[args.index("--to-subdirectory-filter") + 1].strip("/")

def git(*a, env=None, data=None):
    return subprocess.run(["git", *a], check=True, capture_output=True, text=True,
                          env=env, input=data).stdout

head = git("symbolic-ref", "--short", "HEAD").strip()
index = os.path.abspath(os.path.join(git("rev-parse", "--git-dir").strip(), "fake-filter-index"))
mapping, parent = {}, None
for sha in git("rev-list", "--reverse", head).split():
    env = {**os.environ, "GIT_INDEX_FILE": index}
    git("read-tree", "--empty", env=env)
    git("read-tree", f"--prefix={prefix}/", sha + "^{tree}", env=env)
    tree = git("write-tree", env=env).strip()
    an, ae, ad, cn, ce, cd = git("log", "-1", "--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI", sha).splitlines()
    msg = git("log", "-1", "--format=%B", sha)
    cenv = {**os.environ, "GIT_AUTHOR_NAME": an, "GIT_AUTHOR_EMAIL": ae, "GIT_AUTHOR_DATE": ad,
            "GIT_COMMITTER_NAME": cn, "GIT_COMMITTER_EMAIL": ce, "GIT_COMMITTER_DATE": cd}
    parent = git("commit-tree", "--no-gpg-sign", tree, *(["-p", parent] if parent else []),
                 env=cenv, data=msg).strip()
    mapping[sha] = parent
git("update-ref", f"refs/heads/{head}", parent)
for line in git("for-each-ref", "--format=%(refname) %(objectname)", "refs/tags").splitlines():
    ref, obj = line.split()
    if obj in mapping:
        git("update-ref", ref, mapping[obj])
for remote in git("remote").split():
    git("remote", "remove", remote)
git("reset", "--hard", "-q")
if os.path.exists(index):
    os.remove(index)
'''

SETTINGS = """{
  "hooks": {
%s
  },
  "permissions": {"allow": ["Bash(uv run:*)"]}
}
"""
HOOK = ('    "%s": [{"hooks": [{"type": "command", "command": '
        '"uv run --no-project python \\"$CLAUDE_PROJECT_DIR\\"/.bmad-loop/bmad_loop_hook.py %s"}]}]')

DRIFT_STUB = """import json, sys
print(json.dumps({"ok": True, "result": %r, "planes": [], "fixes": [], "mutated": False}))
"""
BMAD_LOOP_STUB = """#!%s
import json, sys
print(json.dumps({"schema_version": 1, "runs": []}))
"""
VERIFY_STUB = """import sys, time
print("stub verify_host line 1")
print("stub verify_host %s")
time.sleep(%d)
sys.exit(%d)
"""
# the ADR section 5 step 3 fix-up renderer (tools/restructure/nest_pipeline.py): the stub
# writes the five rendered files under --out, as the real one does
NEST_STUB = """import argparse, pathlib
p = argparse.ArgumentParser(); p.add_argument("--out", required=True); p.add_argument("--project-name", default="supervisor")
a = p.parse_args(); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
for name in ("task-planning.md", "consult.md", "gate.md", "reconcile.md", "transcribe.py"):
    (out / name).write_text("rendered for " + a.project_name + "\\n", encoding="utf-8")
print("rendered 5 files")
"""
SHIM_TOOLS = ("git", "uv", "ssh-keygen")


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *IDENTITY, *args], cwd=str(cwd), check=True,
                          capture_output=True, text=True).stdout


def commit(repo: Path, files: dict[str, str], message: str) -> None:
    for rel, text in files.items():
        path = repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)


def make_shim(bin_dir: Path) -> str:
    """A PATH holding only git, uv, python and ssh-keygen, so bun and bmad-loop are absent.

    Symlinks where the OS allows them; on Windows a symlink needs a privilege the host
    gate does not hold (WinError 1314), and a linked or copied git.exe would not find its
    DLLs anyway, so the fallback is the tools' own folders joined into a PATH (2026-10-16:
    the whole module was skipped on the agent PC before this)."""
    bin_dir.mkdir(parents=True)
    links = {name: shutil.which(name) for name in SHIM_TOOLS}
    links["python"] = links["python3"] = sys.executable
    try:
        for name, target in links.items():
            if target:
                os.symlink(target, bin_dir / name)
    except OSError:
        # Each tool's own folder joins the PATH, except a folder that also holds bun or
        # bmad-loop (WinGet's Links folder holds uv and bun side by side): that tool, a
        # single-file executable, is copied into the shim folder instead.
        folders: list[str] = []
        for name, target in links.items():
            if not target:
                continue
            folder = os.path.dirname(target)
            if any(shutil.which(x, path=folder) for x in ("bun", "bmad-loop")):
                shutil.copy2(target, bin_dir / os.path.basename(target))
                continue
            if folder not in folders:
                folders.append(folder)
        path = os.pathsep.join([str(bin_dir), *folders])
        for name in ("bun", "bmad-loop"):
            found = shutil.which(name, path=path)
            if found:
                raise OSError(f"{name} would stay on the fallback PATH: {found}")
        return path
    return str(bin_dir)


class RehearsalCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="rehearse-test-")
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name).resolve()
        home = self.tmp / "home"
        home.mkdir()
        self.gitconfig = home / ".gitconfig"
        # the isolated global config: on Windows the script's Step 1 demands core.longpaths
        # (the box has it set globally), so the fixture carries it; a test that rewrites
        # the file keeps this prefix
        self.gitconfig_base = "[core]\n\tlongpaths = true\n" if os.name == "nt" else ""
        self.gitconfig.write_text(self.gitconfig_base, encoding="utf-8")
        if not shutil.which("git") or not shutil.which("uv"):
            self.skipTest("git and uv are required")
        try:
            shim = make_shim(self.tmp / "shim")
        except OSError as exc:
            self.skipTest(f"cannot build the PATH shim (symlinks): {exc}")
        env = {"GIT_CONFIG_NOSYSTEM": "1", "HOME": str(home), "USERPROFILE": str(home),
               "GIT_CONFIG_GLOBAL": str(self.gitconfig), "TK_STUDIO_HOME": str(self.tmp / "tk-studio-home"),
               "UV_PYTHON": sys.executable, "UV_OFFLINE": "1", "UV_NO_CONFIG": "1", "PATH": shim,
               "GIT_TERMINAL_PROMPT": "0"}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        for var in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "CLAUDE_PROJECT_DIR"):
            os.environ.pop(var, None)
        self._no_network()
        self.sup = self.tmp / "src" / "supervisor"
        self.tks = self.tmp / "src" / "tk-studio"
        self.scratch = self.tmp / "scratch"
        self.report = self.tmp / "out" / "restructure-rehearsal.md"
        self.fake_filter = self.tmp / "bin" / "fake_git_filter_repo.py"
        self.fake_filter.parent.mkdir()
        self.fake_filter.write_text(FAKE_FILTER_REPO, encoding="utf-8")

    def _no_network(self):
        def refuse(*a, **kw):
            raise AssertionError(f"network call attempted: {a!r}")
        for target, attr in ((socket.socket, "connect"),
                             (socket.socket, "connect_ex"),
                             (socket, "create_connection"),
                             (socket, "getaddrinfo")):
            patcher = mock.patch.object(target, attr, side_effect=refuse)
            patcher.start()
            self.addCleanup(patcher.stop)

    # --- the fake pair ------------------------------------------------------------------------

    def make_supervisor(self, tag=False, node_modules=False, signed=False, mergetag=False):
        """node_modules="dup": node_modules/ is byte-identical to an earlier vendor/ (same blob
        and tree), so a once-per-object listing names it vendor/ only."""
        repo = self.sup
        repo.mkdir(parents=True)
        git(repo, "init", "-q", "-b", "main")
        commit(repo, {".gitignore": "node_modules/\n",
                      "package.json": '{"name": "supervisor", "version": "0.1.0"}\n',
                      "src/server.ts": "export {};\n"}, "supervisor: first")
        if node_modules == "dup":
            commit(repo, {"vendor/x.js": "module.exports = 1;\n"}, "vendor: x")
        if node_modules:
            (repo / "node_modules").mkdir()
            (repo / "node_modules" / "x.js").write_text("module.exports = 1;\n", encoding="utf-8")
            git(repo, "add", "-f", "node_modules/x.js")
            git(repo, "commit", "-q", "-m", "oops: vendored")
            git(repo, "rm", "-q", "-r", "--cached", "node_modules")
            git(repo, "commit", "-q", "-m", "drop node_modules")
        hooks = ",\n".join(HOOK % (e, e) for e in HOOK_EVENTS)
        commit(repo, {".claude/settings.json": SETTINGS % hooks,
                      ".bmad-loop/bmad_loop_hook.py": "import sys\n"}, "supervisor: hooks")
        if signed:
            key = self.ssh_key()
            # no gpg.ssh.allowedSignersFile anywhere: %G? reads N, the raw gpgsig header does not
            (repo / "SIGNED.md").write_text("signed\n", encoding="utf-8")
            git(repo, "add", "-A")
            git(repo, "-c", "gpg.format=ssh", "-c", f"user.signingkey={key}.pub",
                "commit", "-q", "-S", "-m", "supervisor: signed")
        if mergetag:
            git(repo, "checkout", "-q", "-b", "side")
            commit(repo, {"SIDE.md": "side\n"}, "side: one")
            # a merged signed tag leaves a mergetag header; %G? reads the merge commit as N
            git(repo, "-c", "gpg.format=ssh", "-c", f"user.signingkey={self.ssh_key()}.pub",
                "tag", "-s", "-m", "side tag", "v-side")
            git(repo, "checkout", "-q", "main")
            git(repo, "merge", "-q", "--no-ff", "-m", "merge tag v-side", "v-side")
            git(repo, "tag", "-d", "v-side")
            git(repo, "branch", "-q", "-D", "side")
        if tag:
            # tag=True: a foreign tag (still refused); tag="release": the supervisor's own
            # release tag, carried by the rewrite (2026-10-16: supervisor--v0.1.0 exists)
            git(repo, "tag", "supervisor--v0.1.0" if tag == "release" else "v0.1.0")
        git(repo, "remote", "add", "origin", str(self.tmp / "nowhere" / "supervisor.git"))

    def ssh_key(self) -> Path:
        key = self.tmp / "signing" / "key"
        if not key.exists():
            key.parent.mkdir()
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "fixture",
                            "-f", str(key)], check=True, capture_output=True)
        return key

    def make_tk_studio(self, verify_rc=0, collide=False, sleep=0, drift_result="clean"):
        repo = self.tks
        repo.mkdir(parents=True)
        git(repo, "init", "-q", "-b", "main")
        commit(repo, {"README.md": "# tk-studio\n"}, "tk: first")
        files = {"tools/verify_host.py": VERIFY_STUB % ("failing" if verify_rc else "ok", sleep, verify_rc),
                 "plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py": DRIFT_STUB % drift_result,
                 "tools/restructure/nest_pipeline.py": NEST_STUB}
        if collide:
            files["apps/supervisor/package.json"] = '{"name": "not-the-supervisor"}\n'
        commit(repo, files, "tk: tools")
        git(repo, "remote", "add", "origin", str(self.tmp / "nowhere" / "tk-studio.git"))

    def snapshot(self) -> dict:
        out = {}
        for name, repo in (("sup", self.sup), ("tks", self.tks)):
            if repo.exists():
                out[name] = (git(repo, "rev-parse", "HEAD"), git(repo, "for-each-ref"),
                             git(repo, "remote", "-v"), git(repo, "status", "--porcelain"))
        return out

    def run_script(self, *extra: str, scratch: Path | None = None, report: Path | None = None,
                   supervisor: str | None = None, tk_studio: str | None = None) -> tuple[int, str]:
        argv = ["--supervisor", supervisor or str(self.sup), "--tk-studio", tk_studio or str(self.tks),
                "--scratch", str(scratch or self.scratch), "--report", str(report or self.report), *extra]
        if not shutil.which("git-filter-repo") and "--filter-repo" not in extra:
            argv += ["--filter-repo", str(self.fake_filter)]
        before = self.snapshot()
        buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(buf):
            rc = rehearse.main(argv)
        self.assertEqual(self.snapshot(), before, "a source repository changed")
        return rc, buf.getvalue()

    def report_text(self) -> str:
        return self.report.read_text(encoding="utf-8")

    def assert_shape(self, text: str):
        at = [text.index(s) for s in SECTIONS]
        self.assertEqual(at, sorted(at), "report sections out of ADR section 5 order")
        unver = text[text.index("## unverifiable-here"):]
        for line in unver.splitlines():
            if line.startswith("- **"):
                self.assertRegex(line, r"Agent PC: `[^`]+`$")
        return text.rstrip("\n").splitlines()[-1]

    # --- the I/O matrix -----------------------------------------------------------------------

    def test_happy_path(self):
        self.make_supervisor()
        self.make_tk_studio()
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertEqual(self.assert_shape(text), "Verdict: rehearsal passed")
        clone = self.scratch / "tk-studio"
        git(clone, "rev-parse", "--verify", BRANCH)
        self.assertEqual(git(clone, "symbolic-ref", "--short", "HEAD").strip(), BRANCH)
        paths = git(clone, "ls-tree", "-r", "--name-only", "HEAD").split()
        self.assertIn("apps/supervisor/package.json", paths)
        self.assertIn("apps/supervisor/.claude/settings.json", paths)
        self.assertNotIn("package.json", paths)
        # the ADR section 5 step 3 fix-up: the nested studio-pipeline copy rendered and committed
        # on the restructure branch, so Step 4's checks see the tree the real merge produces
        self.assertIn("### nest the studio pipeline (fix-up) — pass", text)
        self.assertIn("### commit the fix-up — pass", text)
        for name in ("task-planning.md", "consult.md", "gate.md", "reconcile.md", "transcribe.py"):
            self.assertIn(f"apps/supervisor/.bmad-loop/plugins/studio-pipeline/{name}", paths)
        self.assertIn("restructure: render apps/supervisor's studio-pipeline copy",
                      git(clone, "log", "-1", "--format=%s"))
        self.assertEqual(git(clone, "status", "--porcelain").strip(), "")
        svc_paths = git(self.scratch / "svc-rewrite", "ls-tree", "-r", "--name-only", "HEAD").split()
        self.assertTrue(svc_paths and all(p.startswith("apps/supervisor/") for p in svc_paths))
        self.assertEqual(git(clone, "remote").strip(), "")
        self.assertEqual(git(self.scratch / "svc-rewrite", "remote").strip(), "")
        unver = text[text.index("## unverifiable-here"):]
        self.assertIn("hooks fire live", unver)
        # the shim PATH holds no bun and no bmad-loop: both are unverifiable-here, never a pass
        self.assertIn("**bun test**", unver)
        self.assertIn("bun install --frozen-lockfile; bun test`", unver)
        self.assertIn("### bun test — unverifiable-here", text)
        self.assertIn("**bmad-loop list**", unver)
        self.assertIn("bmad-loop list --json`", unver)
        self.assertIn("### bmad-loop list — unverifiable-here", text)
        self.assertNotIn("### bun test — pass", text)
        self.assertNotIn("### bmad-loop list — pass", text)
        self.assertIn("### hooks declared (4) — pass", text)
        for event in HOOK_EVENTS:
            self.assertIn(f"### hook {event} script path — pass", text)
        self.assertIn("### verify_host — pass", text)
        self.assertIn("### tk activate — pass", text)
        self.assertIn("result=clean", text)
        self.assertIn(rehearse.DRIFT_NOTE, text)
        self.assertIn("### clone size after merge — info", text)
        self.assertIn("measured right after the merge", text)
        self.assertIn("- cwd: `tk-studio`", text)
        # AC2: every recorded check row carries a duration
        blocks = text.split("\n### ")[1:]
        self.assertTrue(blocks)
        for block in blocks:
            head = block.splitlines()[0]
            if head.endswith("unverifiable-here"):
                continue
            self.assertRegex(block.split("\n## ")[0], r"- duration: \d+\.\d\ds", head)
        # AC2: every row whose command ran through the Runner carries its exit code and output tail
        ran = [b.split("\n## ")[0] for b in blocks
               if "- command: `" in b and "never executed" not in b.split("\n## ")[0]]
        names = [b.splitlines()[0] for b in ran]
        for want in ("clone supervisor", "clone tk-studio", "filter-repo", "merge — pass",
                     "tk activate", "verify_host", "clone size after merge"):
            self.assertTrue(any(n.startswith(want) for n in names), (want, names))
        for block in ran:
            self.assertRegex(block, r"\n- exit code: -?\d+\n", block.splitlines()[0])
            self.assertRegex(block, r"\n```text\n(.|\n)*?\n```\n", block.splitlines()[0])

    def test_relative_supervisor_path(self):
        self.make_supervisor()
        self.make_tk_studio()
        old = os.getcwd()
        os.chdir(self.sup.parent)
        self.addCleanup(os.chdir, old)
        rc, out = self.run_script(supervisor="supervisor")
        self.assertEqual(rc, 0, out + self.report_text())
        # the report renders argv with shlex.join (a Windows path gets quoted)
        self.assertIn(shlex.join(["clone", "--no-local", str(self.sup), "svc-rewrite"]),
                      self.report_text())

    def test_tag_present(self):
        # a tag that is not a release tag is still refused: nothing but supervisor--vX.Y.Z moves
        self.make_supervisor(tag=True)
        self.make_tk_studio()
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 2 — tags present")
        self.assertIn("tags present (not release tags): v0.1.0", text)
        for section in SECTIONS[2:5]:
            self.assertIn(f"{section}\n\nnot run (Step 2 failed)", text)
        # origin is removed from the rewrite clone on an early Step 2 exit too
        self.assertEqual(git(self.scratch / "svc-rewrite", "remote").strip(), "")
        self.assertIn("### remove origin (rewrite clone) — pass", text)

    def test_release_tag_is_carried(self):
        # 2026-10-16: the supervisor has supervisor--v0.1.0 (its first release, 2026-10-15), so
        # the ADR's "no tags to rename" is stale: release tags ride the rewrite into the clone
        self.make_supervisor(tag="release")
        self.make_tk_studio()
        tagged = git(self.sup, "rev-list", "-n", "1", "supervisor--v0.1.0").strip()
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertEqual(self.assert_shape(text), "Verdict: rehearsal passed")
        self.assertIn("### tags are release tags (carried) — pass", text)
        self.assertIn("release tags carried by the rewrite: supervisor--v0.1.0", text)
        self.assertIn("### release tags carried into the clone — pass", text)
        self.assertIn("git push origin supervisor--v0.1.0", text)
        svc = self.scratch / "svc-rewrite"
        rewritten = git(svc, "rev-list", "-n", "1", "supervisor--v0.1.0").strip()
        self.assertNotEqual(rewritten, tagged, "the tag was not rewritten onto the new history")
        paths = git(svc, "ls-tree", "-r", "--name-only", "supervisor--v0.1.0").split()
        self.assertTrue(paths and all(p.startswith("apps/supervisor/") for p in paths))
        clone = self.scratch / "tk-studio"
        self.assertEqual(git(clone, "rev-list", "-n", "1", "supervisor--v0.1.0").strip(), rewritten)
        # the source repository's tag is untouched (snapshot asserted by run_script)
        self.assertEqual(git(self.sup, "rev-list", "-n", "1", "supervisor--v0.1.0").strip(), tagged)

    def test_signed_commit(self):
        # signatures never survive a rewrite and the archived repository keeps the originals:
        # recorded as informational, never a failure (2026-10-16: GitHub signs web merges)
        if not shutil.which("ssh-keygen"):
            self.skipTest("ssh-keygen is not available to make an SSH-signed commit")
        self.make_supervisor(signed=True)
        self.make_tk_studio()
        self.assertIn("\ngpgsig ", git(self.sup, "cat-file", "commit", "HEAD"))
        self.assertNotIn("allowedSignersFile", self.gitconfig.read_text(encoding="utf-8"))
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertEqual(self.assert_shape(text), "Verdict: rehearsal passed")
        self.assertIn("### signed commits (informational) — info", text)
        self.assertIn("signature headers: gpgsig in 1 commit", text)
        self.assertIn("archived repository keeps the signed originals", text)

    def test_mergetag_commit(self):
        if not shutil.which("ssh-keygen"):
            self.skipTest("ssh-keygen is not available to make an SSH-signed tag")
        self.make_supervisor(mergetag=True)
        self.make_tk_studio()
        self.assertIn("\nmergetag ", git(self.sup, "cat-file", "commit", "HEAD"))
        self.assertEqual(git(self.sup, "tag", "--list").strip(), "")
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertEqual(self.assert_shape(text), "Verdict: rehearsal passed")
        self.assertIn("### signed commits (informational) — info", text)
        self.assertIn("signature headers: mergetag in 1 commit", text)

    def test_unsigned_history_is_a_plain_pass(self):
        self.make_supervisor()
        self.make_tk_studio()
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertIn("### signed commits (informational) — pass", text)
        self.assertIn("no gpgsig/gpgsig-sha256/mergetag header in", text)
        self.assertIn("### tags are release tags (carried) — pass", text)
        self.assertIn("no tags", text)
        self.assertIn("no release tags to carry", text)

    def test_signature_headers(self):
        raw = ("commit a\ntree t\ngpgsig -----BEGIN-----\n x\n -----END-----\n\n    gpgsig in message\n"
               "commit b\ntree t\nmergetag object o\n type commit\ngpgsig-sha256 s\n\n    msg\n"
               "commit c\ntree t\n\n    mergetag is only words here\n")
        self.assertEqual(rehearse.signature_headers(raw),
                         {"gpgsig": 1, "mergetag": 1, "gpgsig-sha256": 1})
        self.assertEqual(rehearse.signature_headers("commit a\ntree t\n\n    plain\n"), {})

    def test_node_modules_in_history(self):
        self.make_supervisor(node_modules=True)
        self.make_tk_studio()
        rc, out = self.run_script()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(self.report_text()),
                         "Verdict: failed at Step 2 — node_modules in history")

    def test_node_modules_identical_to_earlier_path(self):
        self.make_supervisor(node_modules="dup")
        self.make_tk_studio()
        listed = git(self.sup, "rev-list", "--all", "--objects")
        self.assertNotIn("node_modules", listed)  # a once-per-object listing misses it
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 2 — node_modules in history")
        self.assertIn("node_modules paths: apps/supervisor/node_modules/x.js", text)

    def test_merge_conflict(self):
        self.make_supervisor()
        self.make_tk_studio(collide=True)
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        last = self.assert_shape(text)
        self.assertEqual(last, "Verdict: failed at Step 3 — merge conflict")
        self.assertIn("## Step 4 — Nested studio project\n\nnot run", text)
        self.assertIn("## Step 5 — Sandboxes\n\nnot run", text)

    def test_merge_failed_without_conflict(self):
        self.make_supervisor()
        self.make_tk_studio()
        original = rehearse.Runner.gitcheck

        def no_such_ref(runner, name, args, cwd, label="", ok=None):
            if name == "merge":  # a merge that exits non-zero with no unmerged path
                args = [a if a != "svc/main" else "svc/no-such-ref" for a in args]
            return original(runner, name, args, cwd, label=label, ok=ok)

        with mock.patch.object(rehearse.Runner, "gitcheck", no_such_ref):
            rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 3 — merge failed")

    def test_merge_ignores_global_gpgsign(self):
        self.make_supervisor()
        self.make_tk_studio()
        self.gitconfig.write_text(self.gitconfig_base + "[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = "
                                  f"{(self.tmp / 'no-such-gpg').as_posix()}\n", encoding="utf-8")
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertIn("-c commit.gpgsign=false -c merge.ff=true merge --allow-unrelated-histories", text)

    def test_merge_ignores_global_ff_only(self):
        self.make_supervisor()
        self.make_tk_studio()
        self.gitconfig.write_text(self.gitconfig_base + "[merge]\n\tff = only\n", encoding="utf-8")
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertEqual(self.assert_shape(text), "Verdict: rehearsal passed")
        self.assertIn("-c merge.ff=true merge --allow-unrelated-histories", text)

    def test_step1_failure_removes_supervisor_origin(self):
        self.make_supervisor()
        # the tk-studio clone fails after the supervisor clone succeeded
        missing = (self.tmp / "nowhere" / "no-such-tk-studio").as_uri()
        rc, out = self.run_script(tk_studio=missing)
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 1 — clone tk-studio (--no-local)")
        self.assertIn("### clone supervisor (--no-local) — pass", text)
        self.assertIn("### clone tk-studio (--no-local) — fail", text)
        step1 = text[text.index(SECTIONS[0]):text.index(SECTIONS[1])]
        self.assertIn("### remove origin (rewrite clone) — pass", step1)
        for section in SECTIONS[1:5]:
            self.assertIn(f"{section}\n\nnot run (Step 1 failed)", text)
        # the kept scratch holds no clone whose origin points at the live source
        self.assertIn("scratch kept at", out)
        self.assertEqual(git(self.scratch / "svc-rewrite", "remote").strip(), "")

    def test_filter_repo_is_a_directory(self):
        self.make_supervisor()
        self.make_tk_studio()
        folder = self.tmp / "not-a-program"
        folder.mkdir()
        rc, out = self.run_script("--filter-repo", str(folder))
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 2 — filter-repo")
        self.assertIn("- exit code: 126", text)
        self.assertEqual(git(self.scratch / "svc-rewrite", "remote").strip(), "")

    def test_unexpected_error_in_a_step(self):
        self.make_supervisor()
        self.make_tk_studio()
        with mock.patch.object(rehearse, "measure_size", side_effect=RuntimeError("boom")):
            rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text),
                         "Verdict: failed at Step 3 — unexpected error (RuntimeError: boom)")
        self.assertIn("### unexpected error — fail", text)
        self.assertIn("### remove remote svc — pass", text)
        for section in SECTIONS[3:5]:
            self.assertIn(f"{section}\n\nnot run (Step 3 failed)", text)

    def test_unexpected_error_message_is_one_line(self):
        self.make_supervisor()
        self.make_tk_studio()
        with mock.patch.object(rehearse, "measure_size",
                               side_effect=RuntimeError("boom\n  second line\r\nthird")):
            rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        last = self.assert_shape(text)
        self.assertTrue(last.startswith("Verdict: failed at"), last)
        self.assertEqual(last, "Verdict: failed at Step 3 — unexpected error "
                               "(RuntimeError: boom second line third)")
        self.assertNotIn("\n", last)
        self.assertNotIn("\r", text)
        self.assertIn(last, out.splitlines())

    def test_hook_variable_mid_token(self):
        self.make_supervisor()
        self.make_tk_studio()
        mid = ('    "Stop": [{"hooks": [{"type": "command", "command": '
               '"uv run --no-project python --script=$CLAUDE_PROJECT_DIR/.bmad-loop/x.py"}]}]')
        hooks = ",\n".join(mid if e == "Stop" else HOOK % (e, e) for e in HOOK_EVENTS)
        commit(self.sup, {".claude/settings.json": SETTINGS % hooks}, "supervisor: mid-token hook")
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertNotIn("unexpected error", text)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 4 — hook Stop script path")
        self.assertIn("### hook Stop script path — fail", text)
        self.assertIn("missing: --script=", text)
        for event in HOOK_EVENTS:
            if event != "Stop":
                self.assertIn(f"### hook {event} script path — pass", text)
        self.assertIn("### hooks declared (4) — pass", text)
        self.assertIn("**hooks fire live", text[text.index("## unverifiable-here"):])

    def test_tk_activate_needs_clean(self):
        self.make_supervisor()
        self.make_tk_studio(drift_result="unknown")
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 4 — tk activate")
        self.assertIn("result=unknown", text)

    def test_bmad_loop_finds_the_nested_workspace(self):
        if os.name == "nt":
            self.skipTest("the bmad-loop stub is a shebang script")
        stub = self.tmp / "shim" / "bmad-loop"
        stub.write_text(BMAD_LOOP_STUB % sys.executable, encoding="utf-8")
        stub.chmod(0o755)
        self.make_supervisor()
        self.make_tk_studio()
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 0, out + text)
        self.assertIn("### bmad-loop list — pass", text)
        self.assertIn("workspace apps/supervisor/.bmad-loop; 0 runs", text)
        self.assertNotIn("**bmad-loop list**", text[text.index("## unverifiable-here"):])

    def test_bmad_loop_pass_rule(self):
        nested = self.tmp / "nested"
        nested.mkdir()
        ok = rehearse.bmad_loop_listed(nested)
        listing = '{"schema_version": 1, "runs": []}'
        self.assertEqual(ok(0, listing), (False, "workspace apps/supervisor/.bmad-loop missing"))
        (nested / ".bmad-loop").mkdir()
        self.assertEqual(ok(0, listing), (True, "workspace apps/supervisor/.bmad-loop; 0 runs"))
        self.assertFalse(ok(1, listing)[0])
        self.assertFalse(ok(0, "[]")[0])
        self.assertFalse(ok(0, '{"schema_version": 1}')[0])
        self.assertFalse(ok(0, "no json")[0])

    def test_parse_json(self):
        self.assertEqual(rehearse._parse_json('{"a": 1}'), {"a": 1})
        self.assertEqual(rehearse._parse_json('banner\n{"a": 1}\nwarning: } trailing'), {"a": 1})
        self.assertEqual(rehearse._parse_json('note [x] {bad\n[1, 2]\n}'), [1, 2])
        self.assertEqual(rehearse._parse_json('warn {not json}\n{"runs": []}\n'), {"runs": []})
        self.assertIsNone(rehearse._parse_json("no json here }"))

    def test_supervisor_branch_missing(self):
        self.make_supervisor()
        self.make_tk_studio()
        rc, out = self.run_script("--supervisor-branch", "no-such-branch")
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(self.report_text()),
                         "Verdict: failed at Step 3 — supervisor branch missing")

    def test_failing_check(self):
        self.make_supervisor()
        self.make_tk_studio(verify_rc=1)
        rc, out = self.run_script()
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 4 — verify_host")
        block = text[text.index("### verify_host — fail"):]
        block = block[:block.index("\n### ")]
        self.assertIn("- exit code: 1", block)
        self.assertIn("stub verify_host failing", block)

    def test_check_timeout(self):
        self.make_supervisor()
        self.make_tk_studio(sleep=120)
        rc, out = self.run_script("--timeout", "8")
        text = self.report_text()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.assert_shape(text), "Verdict: failed at Step 4 — verify_host timed out after 8s")
        self.assertIn("### verify_host — fail", text)

    def test_hook_paths_with_spaces(self):
        scratch = self.tmp / "scratch with spaces"
        nested = scratch / "tk-studio" / "apps" / "supervisor"
        (nested / ".bmad-loop").mkdir(parents=True)
        (nested / ".bmad-loop" / "bmad_loop_hook.py").write_text("", encoding="utf-8")
        (nested / ".claude").mkdir()
        hooks = ",\n".join(HOOK % (e, e) for e in HOOK_EVENTS)
        (nested / ".claude" / "settings.json").write_text(SETTINGS % hooks, encoding="utf-8")
        checks = rehearse.check_hooks(rehearse.Runner(scratch.resolve(), 20, 60), nested.resolve())
        failed = [c.name for c in checks if c.status == "fail"]
        self.assertEqual(failed, [])
        self.assertEqual(sum(1 for c in checks if c.status == "pass"), 1 + len(HOOK_EVENTS))
        self.assertEqual(rehearse.hook_paths('python "${CLAUDE_PROJECT_DIR}/a b.py" x', "/r o"),
                         ["/r o/a b.py"])

    # --- the guard ----------------------------------------------------------------------------

    def assert_refused(self, rc: int, out: str, *never: Path, needle: str = "refused"):
        self.assertEqual(rc, 2, out)
        self.assertIn(needle, out)
        for path in never:
            self.assertFalse(path.exists(), f"{path} was written")

    def test_guard_scratch_inside_source(self):
        self.make_supervisor()
        self.make_tk_studio()
        for scratch in (self.sup / "scratch", self.tks / "nested" / "scratch"):
            rc, out = self.run_script(scratch=scratch)
            self.assert_refused(rc, out, scratch, self.report, needle="inside the source")

    def test_guard_report_paths(self):
        self.make_supervisor()
        self.make_tk_studio()
        for report in (self.tks / "notes" / "rehearsal.md", self.sup / "rehearsal.md",
                       self.tks / "_bmad-output" / "rehearsal.md"):
            rc, out = self.run_script(report=report)
            self.assert_refused(rc, out, report, self.scratch, needle="is inside the")
        report = self.scratch / "rehearsal.md"
        rc, out = self.run_script(report=report)
        self.assert_refused(rc, out, report, self.scratch, needle="inside the scratch folder")
        folder = self.tmp / "a-folder"
        folder.mkdir()
        buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(buf):
            rc = rehearse.main(["--supervisor", str(self.sup), "--tk-studio", str(self.tks),
                                "--report", str(folder)])
        self.assert_refused(rc, buf.getvalue(), needle="is a folder")
        self.assertEqual(list(folder.iterdir()), [])

    def test_guard_remote_source_and_live_checkout(self):
        self.make_tk_studio()
        buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(buf):
            rc = rehearse.main(["--supervisor", "https://github.com/thkennedy/tk-studio-supervisor",
                                "--tk-studio", str(self.tks), "--scratch", str(self.scratch),
                                "--report", str(self.report)])
        self.assert_refused(rc, buf.getvalue(), self.scratch, self.report, needle="--allow-remote-source")
        for live in (r"C:\GitHub\tk-studio-supervisor\scratch", "/c/GitHub/tk-studio-supervisor/s"):
            buf = io.StringIO()
            with redirect_stdout(buf), redirect_stderr(buf):
                rc = rehearse.main(["--supervisor", "https://github.com/thkennedy/tk-studio-supervisor",
                                    "--allow-remote-source", "--tk-studio", str(self.tks),
                                    "--scratch", live, "--report", str(self.report)])
            self.assert_refused(rc, buf.getvalue(), self.report, needle="live checkout")
        self.make_supervisor()
        for live in ("/c/GitHub/tk-studio/scratch", r"C:\GitHub\tk-studio\scratch"):
            buf = io.StringIO()
            with redirect_stdout(buf), redirect_stderr(buf):
                rc = rehearse.main(["--supervisor", str(self.sup), "--tk-studio", str(self.tks),
                                    "--scratch", live, "--report", str(self.report)])
            self.assert_refused(rc, buf.getvalue(), self.report, needle="live checkout")

    def test_guard_report_in_live_checkout(self):
        self.make_supervisor()
        self.make_tk_studio()
        for report in (r"C:\GitHub\tk-studio\README.md",
                       r"C:\GitHub\tk-studio\_bmad-output\rehearsal.md",
                       "/c/GitHub/tk-studio/rehearse-test-never/rehearsal.md",
                       r"C:\GitHub\tk-studio-supervisor\rehearsal.md",
                       r"C:\GitHub\tk-studio-supervisor\_bmad-output\implementation-artifacts\r.md",
                       "/c/GitHub/tk-studio-supervisor/rehearse-test-never/r.md"):
            # on the agent PC these live paths are real: an existing file must stay as it was,
            # a missing one must stay missing
            target = Path(report).resolve()
            before = target.stat() if target.exists() else None
            buf = io.StringIO()
            with redirect_stdout(buf), redirect_stderr(buf):
                rc = rehearse.main(["--supervisor", str(self.sup), "--tk-studio", str(self.tks),
                                    "--scratch", str(self.scratch), "--report", report])
            if before is None:
                self.assert_refused(rc, buf.getvalue(), self.scratch, target, needle="live checkout")
            else:
                self.assert_refused(rc, buf.getvalue(), self.scratch, needle="live checkout")
                after = target.stat()
                self.assertEqual((before.st_size, before.st_mtime_ns),
                                 (after.st_size, after.st_mtime_ns), f"{target} was rewritten")
        self.assertFalse(Path("/c/GitHub/tk-studio/rehearse-test-never").exists())

        def vet(report):
            return rehearse.guard(argparse.Namespace(
                supervisor=str(self.sup), tk_studio=str(self.tks), allow_remote_source=False,
                scratch=None, report=report))

        # the AC4 default location inside the live tk-studio root stays allowed (a C:\ path is only
        # absolute on Windows; elsewhere the live root's /c/ form is the absolute one)
        vet(r"C:\GitHub\tk-studio\_bmad-output\implementation-artifacts\restructure-rehearsal-x.md"
            if os.name == "nt" else
            "/c/GitHub/tk-studio/_bmad-output/implementation-artifacts/restructure-rehearsal-x.md")
        vet(None)

    # --- static pins --------------------------------------------------------------------------

    def test_default_report_path(self):
        day = rehearse._dt.datetime.now(rehearse._dt.timezone.utc).strftime("%Y-%m-%d")
        repo_root = PLUGIN_ROOT.parents[1]
        self.assertEqual(rehearse.default_report(),
                         repo_root / "_bmad-output" / "implementation-artifacts"
                         / f"restructure-rehearsal-{day}.md")

    def test_child_env_strips_git_and_project_vars(self):
        with mock.patch.dict(os.environ, {v: "/x" for v in rehearse.STRIPPED_ENV}):
            env = rehearse.child_env()
        for var in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
                    "GIT_OBJECT_DIRECTORY", "CLAUDE_PROJECT_DIR"):
            self.assertNotIn(var, env)

    def test_argv_only(self):
        src = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("shell=True", src)
        self.assertNotIn("os.system", src)
        self.assertIn('sys.stdout.reconfigure(encoding="utf-8")', src[src.index("def main("):])


if __name__ == "__main__":
    unittest.main()
