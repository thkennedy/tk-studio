"""Tests for the design-page publish (Story 31.3).

`plansync.publish` sequences confluence (AD-4) through the agent seat's
gateway Confluence token. `FakeConfluencePublish` extends the setup fake
with the page routes (v2) and the attachment routes (v2 list, v1 upload):
no test makes a network call. Covered: the hashing, the idempotence, the
provenance footer, the refusals (each before any call), images and the
per-file ceiling, the dry run and the page index.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import unittest
import urllib.parse
import zlib
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import confluence  # noqa: E402
import jirabackend  # noqa: E402
import mdstorage  # noqa: E402
import plansync  # noqa: E402

from test_tracking_setup import (FakeAtlassian, SetupTestCase,  # noqa: E402
                                 SITE)

FOLDERS = {"brief": "F-brief", "gdd": "F-gdd", "scope-of-work": "F-sow",
           "decisions": "F-dec", "records": "F-rec"}
BRIEF = "---\ntitle: The brief\n---\n# Brief\n\nThe **owner** wants:\n\n- a\n- b\n"
DECISIONS = ("# Decisions\n\n| # | Decision |\n|---|---|\n| 1 | ship |\n\n"
             "See [the brief](../../briefs/b1/brief.md).\n")
BRIEF_REL = "_bmad-output/planning-artifacts/briefs/b1/brief.md"
DECISIONS_REL = "_bmad-output/planning-artifacts/design/d1/decisions.md"


def png(size: int = 64) -> bytes:
    """A valid PNG whose IDAT is stored uncompressed (re-deflate shrinks it)."""
    raw = b"".join(b"\x00" + b"\x10\x20\x30" * size for _ in range(size))

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    return (mdstorage.PNG_SIGNATURE
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 0)) + chunk(b"IEND", b""))


class FakeConfluencePublish(FakeAtlassian):
    """FakeAtlassian plus the publish routes: pages under folders (v2), the
    page's attachments (v2 list) and the attachment upload (v1, multipart).
    These shapes are ungraded on the live site, so they are pinned here."""

    def __init__(self):
        super().__init__()
        self.pages: dict[str, dict] = {}
        self.attachments: dict[str, list[dict]] = {}
        self.page_bodies: list[dict] = []   # every POST/PUT /pages body

    def __call__(self, method, url, body):
        if "/ex/confluence/" in url and confluence.V1_PREFIX + "/" in url:
            path = url.split(confluence.V1_PREFIX, 1)[1].partition("?")[0]
            self.urls.append(url)
            self.calls.append((method, "confluence-v1:" + path))
            forced = self.force.get((method, "confluence-v1:" + path))
            return forced if forced else self._v1(method, path, body)
        if "/ex/confluence/" in url:
            path, _, query = url.split(confluence.API_PREFIX, 1)[1].partition("?")
            handled = self._pages(method, path, query, body)
            if handled is not None:
                self.urls.append(url)
                self.calls.append((method, "confluence:" + path))
                forced = self.force.get((method, "confluence:" + path))
                return forced if forced else handled
        return super().__call__(method, url, body)

    def _v1(self, method, path, body):
        m = re.match(r"^/content/([^/]+)/child/attachment$", path)
        if method == "PUT" and m and isinstance(body, confluence.Multipart):
            files = self.attachments.setdefault(m.group(1), [])
            files[:] = [f for f in files if f["title"] != body.filename]
            files.append({"id": self._id(70000), "title": body.filename,
                          "comment": body.fields.get("comment"),
                          "fileSize": len(body.content),
                          "content": body.content})
            return 200, {"results": [{"title": body.filename}]}
        return 400, {"message": f"unhandled v1 {method} {path}"}

    def _pages(self, method, path, query, body):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        m = re.match(r"^/folders/([^/]+)/direct-children$", path)
        if method == "GET" and m:
            kids = [{"id": p["id"], "type": "page", "title": p["title"]}
                    for p in self.pages.values() if p["parentId"] == m.group(1)]
            return self._cursor_page(path, kids, q)
        if method == "POST" and path == "/pages":
            self.page_bodies.append(body)
            if any(p["title"] == body["title"] for p in self.pages.values()):
                return 400, {"message": "A page with this title already exists"}
            pid = self._id(60000)
            self.pages[pid] = {"id": pid, "title": body["title"],
                               "parentId": body["parentId"],
                               "spaceId": body["spaceId"], "version": 1,
                               "body": body["body"]["value"]}
            return 200, self._page_json(pid)
        m = re.match(r"^/pages/([^/]+)$", path)
        if m and m.group(1) in self.pages:
            page = self.pages[m.group(1)]
            if method == "GET":
                return 200, self._page_json(page["id"])
            if method == "PUT":
                self.page_bodies.append(body)
                if body["version"]["number"] != page["version"] + 1:
                    return 409, {"message": "version conflict"}
                page.update(version=body["version"]["number"],
                            title=body["title"], body=body["body"]["value"])
                return 200, self._page_json(page["id"])
        m = re.match(r"^/pages/([^/]+)/attachments$", path)
        if method == "GET" and m:
            files = [{k: v for k, v in f.items() if k != "content"}
                     for f in self.attachments.get(m.group(1), [])]
            return self._cursor_page(path, files, q)
        return None

    def _page_json(self, pid):
        page = self.pages[pid]
        return {"id": pid, "title": page["title"], "parentId": page["parentId"],
                "version": {"number": page["version"]},
                "body": {"storage": {"value": page["body"],
                                     "representation": "storage"}},
                "_links": {"webui": f"/spaces/TKSTUDIO/pages/{pid}"}}

    def page(self, title):
        return next(p for p in self.pages.values() if p["title"] == title)


class PublishTestCase(SetupTestCase):
    def setUp(self):
        super().setUp()
        self.fake = FakeConfluencePublish()
        plansync.write_binding(self.root, {
            "jira": {"site": SITE},
            "confluence": {"space_key": "TKSTUDIO", "space_id": "S-1",
                           "folders": dict(FOLDERS)}})
        self.write(BRIEF_REL, BRIEF)
        self.write(DECISIONS_REL, DECISIONS)

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        return path

    def publish(self, **kwargs):
        return plansync.publish(self.root, transport=self.fake, **kwargs)

    def index(self):
        return json.loads((self.root / ".tk-studio" / "confluence-pages.json")
                          .read_text(encoding="utf-8"))

    def assert_block_last(self, result, status):
        self.assertEqual(list(result)[-4:], list(plansync.SETUP_BLOCK_KEYS))
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-plan-sync")


class FirstPublishTests(PublishTestCase):
    def test_first_publish_creates_both_pages_with_footer(self):
        result = self.publish()
        self.assert_block_last(result, "complete")
        self.assertTrue(result["ok"])
        self.assertEqual([c["title"] for c in result["created"]],
                         ["Brief: b1", "Decisions: decisions"])
        brief = self.fake.page("Brief: b1")
        self.assertEqual(brief["parentId"], FOLDERS["brief"])
        self.assertEqual(brief["spaceId"], "S-1")
        self.assertIn("<h1>Brief</h1>", brief["body"])
        self.assertIn("<strong>owner</strong>", brief["body"])
        self.assertNotIn("title: The brief", brief["body"])
        self.assertTrue(brief["body"].endswith(
            f"<p><em>Published by tk-studio from <code>{BRIEF_REL}</code> at "
            f"commit <code>no commit</code>. content-hash: sha256:"
            + re.search(r"sha256:([0-9a-f]{64})", brief["body"]).group(1)
            + "</em></p>"))
        decisions = self.fake.page("Decisions: decisions")
        self.assertEqual(decisions["parentId"], FOLDERS["decisions"])
        self.assertIn("<table><tbody><tr><th>#</th>", decisions["body"])
        self.assertIn('<ri:page ri:content-title="Brief: b1"/>',
                      decisions["body"])

    def test_index_is_written_with_ids_and_paths_only(self):
        result = self.publish()
        self.assertEqual(result["written"], [".tk-studio/confluence-pages.json"])
        self.assertEqual(result["artifacts"], result["written"])
        pages = self.index()["pages"]
        self.assertEqual([p["source"] for p in pages], [BRIEF_REL, DECISIONS_REL])
        for page in pages:
            self.assertEqual(sorted(page), ["category", "page_id", "source",
                                            "title", "webui"])
        self.assertEqual(pages[0]["webui"],
                         f"/spaces/TKSTUDIO/pages/{pages[0]['page_id']}")
        self.assertNotIn("fake-confluence-token",
                         (self.root / ".tk-studio" / "confluence-pages.json")
                         .read_text(encoding="utf-8"))

    def test_empty_categories_are_named_skipped_not_errors(self):
        result = self.publish()
        skipped = {s.get("category"): s["reason"] for s in result["skipped"]}
        self.assertEqual(skipped, {"gdd": "no source",
                                   "scope-of-work": "no source"})
        self.assertEqual(result["status"], "complete")

    def test_records_folder_is_never_published(self):
        self.publish()
        self.assertFalse(any(p["parentId"] == FOLDERS["records"]
                             for p in self.fake.pages.values()))

    def test_ceiling_assumed_and_bytes_reported_in_notes(self):
        result = self.publish()
        notes = " ".join(result["notes"])
        self.assertIn("attachment ceiling assumed 104,857,600 bytes", notes)
        self.assertIn("0 bytes uploaded this run", notes)
        self.assertIn("2 GB", notes)
        self.assertEqual(result["bytes_uploaded"], 0)

    def test_the_cli_publishes_through_main(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                mock.patch.object(confluence.ConfluenceClient, "_http",
                                  lambda _s, m, u, b: self.fake(m, u, b)):
            code = plansync.main(["publish", "--directory", str(self.root)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["status"], "complete")


class IdempotenceTests(PublishTestCase):
    def test_rerun_unchanged_skips_with_no_write_call(self):
        self.publish()
        self.fake.calls.clear()
        result = self.publish()
        self.assert_block_last(result, "complete")
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], [])
        unchanged = [s["title"] for s in result["skipped"]
                     if s["reason"] == "unchanged"]
        self.assertEqual(unchanged, ["Brief: b1", "Decisions: decisions"])
        self.assertEqual([f["title"] for f in result["found"]], unchanged)
        self.assertEqual(result["written"], [])  # the index did not change

    def test_source_edit_updates_with_the_next_version(self):
        self.publish()
        self.write(BRIEF_REL, BRIEF + "\nMore.\n")
        result = self.publish()
        self.assertEqual([u["title"] for u in result["updated"]], ["Brief: b1"])
        brief = self.fake.page("Brief: b1")
        self.assertEqual(brief["version"], 2)
        self.assertIn("<p>More.</p>", brief["body"])
        self.assertIn("Brief: b1: the remote content hash differs",
                      " ".join(result["notes"]))

    def test_page_edited_in_confluence_is_overwritten_and_named(self):
        self.publish()
        brief = self.fake.page("Brief: b1")
        brief["body"] = "<p>edited in the browser</p>"
        brief["version"] = 5
        result = self.publish()
        self.assertEqual([u["title"] for u in result["updated"]], ["Brief: b1"])
        self.assertEqual(brief["version"], 6)
        self.assertIn("<h1>Brief</h1>", brief["body"])
        self.assertIn("Brief: b1: the remote page carries no tk-studio "
                      "content hash", " ".join(result["notes"]))
        self.assertIn("overwritten, the local source wins (AD-5)",
                      " ".join(result["notes"]))

    def test_footer_only_change_does_not_republish(self):
        # the footer (and so the commit) is outside the hash
        self.publish()
        brief = self.fake.page("Brief: b1")
        brief["body"] = brief["body"].replace("no commit", "abc123")
        self.fake.calls.clear()
        self.publish()
        self.assertEqual(self.fake.writes(), [])


class HashTests(PublishTestCase):
    def test_hash_covers_title_storage_and_attachments_not_footer(self):
        storage, _ = mdstorage.convert(BRIEF, BRIEF_REL, {})
        digest = plansync.page_hash("Brief: b1", storage, [])
        self.assertEqual(digest, jirabackend._content_hash("Brief: b1", storage))
        self.assertNotEqual(digest, plansync.page_hash("Brief: b2", storage, []))
        self.assertNotEqual(digest,
                            plansync.page_hash("Brief: b1", storage, ["0" * 64]))
        self.publish()
        self.assertIn(f"content-hash: sha256:{digest}",
                      self.fake.page("Brief: b1")["body"])

    def test_footer_shape(self):
        self.assertEqual(
            plansync.page_footer("a/b.md", "abc", "f" * 64),
            "<p><em>Published by tk-studio from <code>a/b.md</code> at commit "
            "<code>abc</code>. content-hash: sha256:" + "f" * 64 + "</em></p>")


class ProvenanceTests(PublishTestCase):
    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "user.name=T", "-c", "user.email=t@example.com",
             "-c", "commit.gpgsign=false", *args], cwd=self.root,
            capture_output=True, text=True, check=True).stdout.strip()

    def test_footer_names_the_last_commit_that_touched_the_source(self):
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "sources")
        brief_sha = self.git("log", "-1", "--format=%H", "--", BRIEF_REL)
        self.write("other.txt", "unrelated\n")
        self.git("add", "other.txt")
        self.git("commit", "-q", "-m", "unrelated")
        head = self.git("rev-parse", "HEAD")
        self.assertNotEqual(head, brief_sha)
        self.publish()
        body = self.fake.page("Brief: b1")["body"]
        self.assertIn(f"at commit <code>{brief_sha}</code>.", body)
        self.assertNotIn(head, body)

    def test_dirty_source_is_marked_uncommitted(self):
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "sources")
        sha = self.git("log", "-1", "--format=%H", "--", BRIEF_REL)
        self.write(BRIEF_REL, BRIEF + "\nDirty.\n")
        self.publish()
        self.assertIn(f"at commit <code>{sha} (uncommitted changes)</code>.",
                      self.fake.page("Brief: b1")["body"])

    def test_outside_a_work_tree_names_no_commit(self):
        self.assertEqual(plansync._provenance(self.root, BRIEF_REL),
                         "no commit")


class RefusalTests(PublishTestCase):
    def test_no_env_blocks_naming_each_variable_with_no_call(self):
        for name in (jirabackend.AGENT_EMAIL_ENV,
                     jirabackend.AGENT_CONFLUENCE_TOKEN_ENV,
                     jirabackend.CLOUD_ID_ENV):
            os.environ.pop(name, None)
        out = io.StringIO()
        # the CLI's client is wired to the fake, and real HTTP raises, so a
        # regression that makes any call fails here
        with contextlib.redirect_stdout(out), \
                mock.patch.object(confluence.ConfluenceClient, "_http",
                                  lambda _s, m, u, b: self.fake(m, u, b)), \
                mock.patch("urllib.request.urlopen",
                           side_effect=AssertionError("network call")):
            code = plansync.main(["publish", "--directory", str(self.root)])
        result = json.loads(out.getvalue())
        self.assertEqual(code, 2)
        self.assert_block_last(result, "blocked")
        for name in (jirabackend.AGENT_EMAIL_ENV,
                     jirabackend.AGENT_CONFLUENCE_TOKEN_ENV,
                     jirabackend.CLOUD_ID_ENV):
            self.assertIn(f"{name} is not set", result["reason"])
        self.assertEqual(self.fake.calls, [])
        self.assertFalse((self.root / ".tk-studio" /
                          "confluence-pages.json").exists())

    def test_no_binding_refuses_run_setup_first(self):
        (self.root / ".tk-studio" / "config.yaml").write_text(
            "project_id: tk-studio\n", encoding="utf-8")
        result = self.publish()
        self.assert_block_last(result, "blocked")
        self.assertIn("planning.confluence.space_id is not recorded",
                      result["reason"])
        self.assertIn("run `plansync.py setup` first", result["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_duplicate_title_is_refused_before_any_call(self):
        other = "_bmad-output/planning-artifacts/design/d2/decisions.md"
        self.write(other, "# Other\n")
        result = self.publish()
        self.assert_block_last(result, "blocked")
        self.assertIn("duplicate page title 'Decisions: decisions'",
                      result["reason"])
        self.assertIn(DECISIONS_REL, result["reason"])
        self.assertIn(other, result["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_missing_folder_skips_the_category_and_ends_partial(self):
        cfg = self.root / ".tk-studio" / "config.yaml"
        cfg.write_text(re.sub(r"\n\s+decisions: \"F-dec\"", "",
                              cfg.read_text(encoding="utf-8")),
                       encoding="utf-8")
        result = self.publish()
        self.assert_block_last(result, "partial")
        self.assertTrue(result["ok"])
        skipped = next(s for s in result["skipped"]
                       if s.get("category") == "decisions")
        self.assertIn("planning.confluence.folders.decisions", skipped["reason"])
        self.assertEqual([c["title"] for c in result["created"]], ["Brief: b1"])

    def test_source_flag_replaces_the_category_default(self):
        alt = self.write("docs/gdd-main.md", "# GDD\n")
        result = self.publish(sources=[f"gdd={alt}",
                                       f"brief={BRIEF_REL}"])
        titles = [c["title"] for c in result["created"]]
        self.assertIn("GDD: gdd-main", titles)
        self.assertEqual(self.fake.page("GDD: gdd-main")["parentId"],
                         FOLDERS["gdd"])

    def test_bad_source_flags_are_named(self):
        result = self.publish(sources=["records=x.md", "brief=missing.md",
                                       "nonsense"])
        self.assert_block_last(result, "blocked")
        for phrase in ("unknown category 'records'", "missing.md does not exist",
                       "'nonsense' is not <category>=<path>"):
            self.assertIn(phrase, result["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_401_blocks_naming_the_confluence_token(self):
        self.fake.force[("GET", f"confluence:/folders/{FOLDERS['brief']}"
                                f"/direct-children")] = (401, {"message": "no"})
        result = self.publish()
        self.assert_block_last(result, "blocked")
        self.assertIn("TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN", result["reason"])

    def test_create_refusal_is_named_and_partial(self):
        self.fake.force[("POST", "confluence:/pages")] = (400, {"message": "x"})
        result = self.publish()
        self.assert_block_last(result, "partial")
        self.assertEqual({r["name"] for r in result["refused"]},
                         {"Brief: b1", "Decisions: decisions"})


class ImageTests(PublishTestCase):
    def setUp(self):
        super().setUp()
        self.image = png()
        (self.root / "_bmad-output/planning-artifacts/briefs/b1/img").mkdir()
        (self.root / "_bmad-output/planning-artifacts/briefs/b1/img/shot.png"
         ).write_bytes(self.image)
        self.write(BRIEF_REL, BRIEF + "\n![shot](img/shot.png)\n")

    def test_image_is_compressed_attached_and_reported(self):
        result = self.publish()
        self.assert_block_last(result, "complete")
        page = self.fake.page("Brief: b1")
        self.assertIn('<ri:attachment ri:filename="shot.png"/>', page["body"])
        files = self.fake.attachments[page["id"]]
        self.assertEqual([f["title"] for f in files], ["shot.png"])
        sent = files[0]["content"]
        self.assertLess(len(sent), len(self.image))
        self.assertEqual(sent, mdstorage.recompress_png(self.image))
        # the hash is over the source bytes, the upload the compressed ones
        self.assertEqual(files[0]["comment"],
                         "sha256:" + hashlib.sha256(self.image).hexdigest())
        storage, _ = mdstorage.convert(
            (self.root / BRIEF_REL).read_text(encoding="utf-8"), BRIEF_REL,
            {BRIEF_REL: "Brief: b1", DECISIONS_REL: "Decisions: decisions"})
        self.assertIn("content-hash: sha256:" + plansync.page_hash(
            "Brief: b1", storage, [hashlib.sha256(self.image).hexdigest()]),
            page["body"])
        self.assertEqual(result["bytes_uploaded"], len(sent))
        self.assertIn(f"{len(sent)} bytes uploaded this run",
                      " ".join(result["notes"]))

    def test_unchanged_attachment_is_not_reuploaded(self):
        self.publish()
        self.write(BRIEF_REL, BRIEF + "\nEdited.\n\n![shot](img/shot.png)\n")
        self.fake.calls.clear()
        result = self.publish()
        self.assertEqual([u["title"] for u in result["updated"]], ["Brief: b1"])
        self.assertFalse(any(c[1].startswith("confluence-v1:")
                             for c in self.fake.calls))
        self.assertEqual(result["bytes_uploaded"], 0)

    def test_oversize_image_is_refused_and_the_page_still_publishes(self):
        result = self.publish(attachment_max_bytes=10)
        self.assert_block_last(result, "partial")
        self.assertEqual([r["name"] for r in result["refused"]],
                         ["_bmad-output/planning-artifacts/briefs/b1/img/shot.png"])
        self.assertIn("over the per-file attachment ceiling of 10 bytes",
                      result["refused"][0]["reason"])
        self.assertEqual([c["title"] for c in result["created"]],
                         ["Brief: b1", "Decisions: decisions"])
        self.assertFalse(any(c[1].startswith("confluence-v1:")
                             for c in self.fake.calls))
        self.assertNotIn("assumed", " ".join(result["notes"]))

    def test_supplied_ceiling_above_100_mb_is_capped(self):
        result = self.publish(attachment_max_bytes=500_000_000)
        self.assertIn("104,857,600 bytes", " ".join(result["notes"]))


class ReviewPassOneImageTests(ImageTests):
    """Confinement, collisions, percent-encoding, the pre-read ceiling."""

    def assert_refused_outside(self, result, name):
        self.assert_block_last(result, "partial")
        refused = [r for r in result["refused"] if r["name"] == name]
        self.assertEqual(len(refused), 1, result["refused"])
        self.assertIn("outside the project root", refused[0]["reason"])
        self.assertIn("Brief: b1", [c["title"] for c in result["created"]])
        page = self.fake.page("Brief: b1")
        self.assertNotIn(page["id"], self.fake.attachments)
        self.assertFalse(any(c[1].startswith("confluence-v1:")
                             for c in self.fake.calls))

    def test_dotdot_escape_is_refused_before_any_read(self):
        outside = Path(self._tmp.name) / "secret.png"
        outside.write_bytes(self.image)
        self.write(BRIEF_REL, BRIEF + "\n![x](../../../../../secret.png)\n")
        with mock.patch.object(Path, "read_bytes",
                               side_effect=AssertionError("read")):
            result = self.publish()
        self.assert_refused_outside(result, "../secret.png")

    def test_absolute_path_is_refused(self):
        outside = Path(self._tmp.name) / "secret.png"
        outside.write_bytes(self.image)
        self.write(BRIEF_REL, BRIEF + f"\n![x]({outside.as_posix()})\n")
        result = self.publish()
        self.assert_refused_outside(result, outside.as_posix())

    def test_non_http_scheme_is_refused(self):
        self.write(BRIEF_REL, BRIEF + "\n![x](file:///etc/passwd)\n")
        result = self.publish()
        self.assert_refused_outside(result, "file:///etc/passwd")

    def test_symlink_out_of_the_root_is_refused(self):
        outside = Path(self._tmp.name) / "secret.png"
        outside.write_bytes(self.image)
        link = self.root / "_bmad-output/planning-artifacts/briefs/b1/img/link.png"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        self.write(BRIEF_REL, BRIEF + "\n![x](img/link.png)\n")
        result = self.publish()
        self.assert_refused_outside(
            result, "_bmad-output/planning-artifacts/briefs/b1/img/link.png")

    def test_same_basename_images_get_two_attachments(self):
        other = self.root / "_bmad-output/planning-artifacts/briefs/b1/b"
        other.mkdir()
        (other / "shot.png").write_bytes(png(48))
        self.write(BRIEF_REL, BRIEF + "\n![a](img/shot.png) ![b](b/shot.png)\n")
        result = self.publish()
        self.assert_block_last(result, "complete")
        page = self.fake.page("Brief: b1")
        names = sorted(f["title"] for f in self.fake.attachments[page["id"]])
        self.assertEqual(len(names), 2)
        self.assertIn("shot.png", names)
        self.assertTrue(re.fullmatch(r"shot-[0-9a-f]{8}\.png", names[0]), names)
        for name in names:
            self.assertIn(f'ri:filename="{name}"', page["body"])
        self.fake.calls.clear()
        again = self.publish()
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(again["bytes_uploaded"], 0)

    def test_percent_encoded_image_path_is_found(self):
        folder = self.root / "_bmad-output/planning-artifacts/briefs/b1/img"
        (folder / "my img.png").write_bytes(self.image)
        self.write(BRIEF_REL, BRIEF + "\n![x](img/my%20img.png)\n")
        result = self.publish()
        self.assert_block_last(result, "complete")
        page = self.fake.page("Brief: b1")
        self.assertEqual([f["title"] for f in self.fake.attachments[page["id"]]],
                         ["my img.png"])

    def test_far_oversize_image_is_refused_before_the_read(self):
        big = self.root / "_bmad-output/planning-artifacts/briefs/b1/img/big.jpg"
        with open(big, "wb") as handle:  # sparse: never really this large
            handle.truncate(200)
        self.write(BRIEF_REL, BRIEF + "\n![x](img/big.jpg)\n")
        with mock.patch.object(Path, "read_bytes",
                               side_effect=AssertionError("read")):
            result = self.publish(attachment_max_bytes=100)
        self.assert_block_last(result, "partial")
        self.assertIn("200 bytes is over the per-file attachment ceiling "
                      "of 100 bytes", result["refused"][0]["reason"])

    def test_png_between_the_ceiling_and_four_times_it_is_read(self):
        # over the ceiling as stored, under it once re-deflated
        squeezed = len(mdstorage.recompress_png(self.image))
        ceiling = (len(self.image) + squeezed) // 2
        self.assertLess(len(self.image), 4 * ceiling)
        result = self.publish(attachment_max_bytes=ceiling)
        self.assert_block_last(result, "complete")
        self.assertIn(f"attachment ceiling {ceiling:,} bytes: the supplied "
                      f"site setting", " ".join(result["notes"]))


class ReviewPassOneTests(PublishTestCase):
    def test_remote_hash_is_the_last_match(self):
        self.write(BRIEF_REL, BRIEF + "\nQuoted: `content-hash: sha256:"
                   + "a" * 64 + "`\n")
        self.publish()
        self.fake.calls.clear()
        result = self.publish()
        self.assertEqual(self.fake.writes(), [])
        self.assertIn("Brief: b1", [s.get("title") for s in result["skipped"]])

    def test_dry_run_says_would_be_overwritten(self):
        self.publish()
        self.write(BRIEF_REL, BRIEF + "\nMore.\n")
        result = self.publish(dry_run=True)
        notes = " ".join(result["notes"])
        self.assertIn("— would be overwritten, the local source wins", notes)
        self.assertNotIn("— overwritten", notes)

    def test_same_file_in_two_categories_is_refused(self):
        result = self.publish(sources=[f"gdd={DECISIONS_REL}"])
        self.assert_block_last(result, "blocked")
        self.assertIn(f"{DECISIONS_REL} supplied to two categories",
                      result["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_index_keeps_a_category_skipped_for_its_folder(self):
        self.publish()
        cfg = self.root / ".tk-studio" / "config.yaml"
        cfg.write_text(re.sub(r"\n\s+decisions: \"F-dec\"", "",
                              cfg.read_text(encoding="utf-8")),
                       encoding="utf-8")
        self.write(BRIEF_REL, BRIEF + "\nMore.\n")
        result = self.publish()
        self.assertEqual(result["status"], "partial")
        self.assertEqual([p["title"] for p in self.index()["pages"]],
                         ["Brief: b1", "Decisions: decisions"])

    def test_index_keeps_pages_a_source_override_replaced(self):
        self.publish()
        alt = self.write("docs/brief-two.md", "# Two\n")
        self.publish(sources=[f"brief={alt}"])
        self.assertEqual([p["title"] for p in self.index()["pages"]],
                         ["Brief: b1", "Decisions: decisions",
                          "Brief: brief-two"])

    def test_merge_replaces_by_title_in_previous_order(self):
        previous = [{"title": "A", "page_id": "1"}, {"title": "B", "page_id": "2"}]
        landed = [{"title": "C", "page_id": "3"}, {"title": "A", "page_id": "9"}]
        self.assertEqual(plansync._merge_page_index(previous, landed),
                         [{"title": "A", "page_id": "9"},
                          {"title": "B", "page_id": "2"},
                          {"title": "C", "page_id": "3"}])


class DryRunTests(PublishTestCase):
    def test_dry_run_writes_nothing_and_lists_would_publish(self):
        result = self.publish(dry_run=True)
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual([(w["title"], w["action"])
                          for w in result["would_publish"]],
                         [("Brief: b1", "create"),
                          ("Decisions: decisions", "create")])
        self.assertEqual(result["written"], [])
        self.assertFalse((self.root / ".tk-studio" /
                          "confluence-pages.json").exists())
        self.assert_block_last(result, "partial")

    def test_dry_run_after_publish_lists_only_changes(self):
        self.publish()
        self.write(BRIEF_REL, BRIEF + "\nMore.\n")
        self.fake.calls.clear()
        result = self.publish(dry_run=True)
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual([(w["title"], w["action"])
                          for w in result["would_publish"]],
                         [("Brief: b1", "update")])



class ReviewPassTwoTests(PublishTestCase):
    """The second review pass on Story 31.3 (patches 6-8)."""

    def test_undecodable_page_index_is_rewritten_and_the_run_ends(self):
        index = self.root / ".tk-studio" / "confluence-pages.json"
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_bytes(b"\xff\xfe\x80 not utf-8")
        result = self.publish()
        self.assert_block_last(result, "complete")
        self.assertEqual([p["title"] for p in self.index()["pages"]],
                         ["Brief: b1", "Decisions: decisions"])
        self.assertIn(".tk-studio/confluence-pages.json", result["written"])

    def test_update_refusal_is_named_and_partial(self):
        self.publish()
        pid = self.fake.page("Brief: b1")["id"]
        self.write(BRIEF_REL, BRIEF + "\nEdited.\n")
        self.fake.force[("PUT", f"confluence:/pages/{pid}")] = (
            409, {"message": "version conflict"})
        result = self.publish()
        self.assert_block_last(result, "partial")
        self.assertEqual([r["name"] for r in result["refused"]], ["Brief: b1"])
        self.assertIn("update refused", result["refused"][0]["reason"])
        self.assertIn("page Brief: b1 update refused", result["reason"])
        self.assertEqual(result["updated"], [])

    def test_403_on_a_page_create_blocks_naming_the_scope(self):
        self.fake.force[("POST", "confluence:/pages")] = (403, {"message": "no"})
        result = self.publish()
        self.assert_block_last(result, "blocked")
        self.assertIn("403", result["reason"])
        self.assertIn("TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN", result["reason"])
        self.assertIn(confluence.SCOPE_PAGE, result["reason"])


class FollowUpReviewTests(PublishTestCase):
    """The follow-up review pass on Story 31.3 (patches 1-2)."""

    def test_default_source_symlinked_out_of_the_root_is_refused_unread(self):
        outside = Path(self._tmp.name) / "secret-brief.md"
        outside.write_text("# Secret\n\nOUTSIDE-MARKER\n", encoding="utf-8")
        link = self.root / BRIEF_REL
        link.unlink()
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        read = []
        real_read_text = Path.read_text

        def spy(path, *args, **kwargs):
            read.append(Path(path).resolve())
            return real_read_text(path, *args, **kwargs)

        with mock.patch.object(Path, "read_text", spy):
            result = self.publish()
        self.assert_block_last(result, "blocked")
        self.assertIn(f"brief source {BRIEF_REL!r}", result["reason"])
        self.assertIn("is outside the project root", result["reason"])
        self.assertNotIn(outside.resolve(), read)
        self.assertEqual(self.fake.calls, [])
        self.assertFalse(any("OUTSIDE-MARKER" in json.dumps(p)
                             for p in self.fake.pages.values()))
        self.assertFalse((self.root / ".tk-studio" /
                          "confluence-pages.json").exists())

    def test_titles_differing_only_by_case_are_refused_before_any_call(self):
        # Confluence titles are unique per space case-insensitively
        other = "_bmad-output/planning-artifacts/design/d2/Decisions.md"
        self.write(other, "# Upper\n")
        result = self.publish()
        self.assert_block_last(result, "blocked")
        self.assertIn("duplicate page title 'Decisions: decisions' / "
                      "'Decisions: Decisions'", result["reason"])
        self.assertIn(DECISIONS_REL, result["reason"])
        self.assertIn(other, result["reason"])
        self.assertEqual(self.fake.calls, [])


class ReviewPassTwoImageTests(ImageTests):
    """The second review pass on Story 31.3 (patches 7-8, images)."""

    def test_upload_refusal_is_named_partial_and_not_counted(self):
        self.publish()
        pid = self.fake.page("Brief: b1")["id"]
        (self.root / "_bmad-output/planning-artifacts/briefs/b1/img/shot.png"
         ).write_bytes(png(48))
        self.fake.force[("PUT", f"confluence-v1:/content/{pid}/child/"
                                f"attachment")] = (500, {"message": "boom"})
        result = self.publish()
        self.assert_block_last(result, "partial")
        self.assertEqual([u["title"] for u in result["updated"]], ["Brief: b1"])
        self.assertEqual([r["name"] for r in result["refused"]], ["shot.png"])
        self.assertIn("upload refused", result["refused"][0]["reason"])
        self.assertIn("attachment shot.png refused", result["reason"])
        self.assertEqual(result["bytes_uploaded"], 0)

    def test_dry_run_names_a_missing_attachment_of_an_unchanged_page(self):
        self.publish()
        pid = self.fake.page("Brief: b1")["id"]
        self.fake.attachments[pid] = []
        self.fake.calls.clear()
        result = self.publish(dry_run=True)
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(
            [(w["title"], w["action"], w.get("attachments"))
             for w in result["would_publish"]],
            [("Brief: b1", "attach", ["shot.png"])])
        self.assertEqual(result["would_publish"][0]["page_id"], pid)
        self.assert_block_last(result, "partial")

    def test_dry_run_names_a_stale_attachment_comment(self):
        self.publish()
        pid = self.fake.page("Brief: b1")["id"]
        self.fake.attachments[pid][0]["comment"] = "sha256:" + "0" * 64
        self.fake.calls.clear()
        result = self.publish(dry_run=True)
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual([(w["title"], w["action"])
                          for w in result["would_publish"]],
                         [("Brief: b1", "attach")])
        self.assert_block_last(result, "partial")

    def test_dry_run_with_attachments_current_is_complete(self):
        self.publish()
        result = self.publish(dry_run=True)
        self.assertEqual(result["would_publish"], [])
        self.assert_block_last(result, "complete")


if __name__ == "__main__":
    unittest.main()
