"""Tests for the Markdown -> Confluence storage converter (Story 31.3) and
its reverse, `to_markdown` (Story 32.4: the scope round trip, the editor's
noise, the footer dropped)."""
from __future__ import annotations

import struct
import sys
import unittest
from unittest import mock
import xml.dom.minidom
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import engage  # noqa: E402
import mdstorage  # noqa: E402
import plansync  # noqa: E402

SRC = "plan/briefs/b1/brief.md"


def convert(md, titles=None):
    return mdstorage.convert(md, SRC, titles or {})


def well_formed(storage: str) -> None:
    xml.dom.minidom.parseString(
        f'<r xmlns:ac="urn:ac" xmlns:ri="urn:ri">{storage}</r>'.encode())


class BlockTests(unittest.TestCase):
    def test_frontmatter_is_stripped(self):
        storage, _ = convert("---\ntitle: x\nstatus: y\n---\n# Head\n")
        self.assertEqual(storage, "<h1>Head</h1>")

    def test_headings_one_to_six(self):
        storage, _ = convert("\n".join(f"{'#' * n} H{n}" for n in range(1, 7)))
        self.assertEqual(storage, "".join(f"<h{n}>H{n}</h{n}>"
                                          for n in range(1, 7)))

    def test_heading_closing_hashes_need_whitespace(self):
        storage, _ = convert("## Notes on C#\n## Title ##\n### #\n")
        self.assertEqual(storage, "<h2>Notes on C#</h2><h2>Title</h2><h3></h3>")

    def test_paragraphs_join_lines_and_split_on_blanks(self):
        storage, _ = convert("one\ntwo\n\nthree\n")
        self.assertEqual(storage, "<p>one two</p><p>three</p>")

    def test_inline_strong_em_code_del(self):
        storage, _ = convert("**b** and *i* and `x < y` and ~~gone~~ and a*b*c")
        self.assertEqual(storage, "<p><strong>b</strong> and <em>i</em> and "
                                  "<code>x &lt; y</code> and <del>gone</del> "
                                  "and a*b*c</p>")

    def test_text_is_escaped(self):
        storage, _ = convert("<script>&\"'</script>")
        self.assertNotIn("<script>", storage)
        self.assertIn("&lt;script&gt;&amp;&quot;", storage)
        well_formed(storage)

    def test_nested_lists(self):
        storage, _ = convert("- a\n- b\n  - b1\n  - b2\n- c\n\n1. one\n2. two\n")
        self.assertEqual(storage, "<ul><li>a</li><li>b<ul><li>b1</li>"
                                  "<li>b2</li></ul></li><li>c</li></ul>"
                                  "<ol><li>one</li><li>two</li></ol>")

    def test_ordered_list_nested_in_bullets(self):
        storage, _ = convert("* a\n   1. x\n   2. y\n* b\n")
        self.assertEqual(storage, "<ul><li>a<ol><li>x</li><li>y</li></ol>"
                                  "</li><li>b</li></ul>")
        well_formed(storage)

    def test_gfm_table(self):
        storage, _ = convert("| A | B |\n|:--|--:|\n| 1 | **2** |\n| x \\| y |\n")
        self.assertEqual(storage, "<table><tbody><tr><th>A</th><th>B</th></tr>"
                                  "<tr><td>1</td><td><strong>2</strong></td>"
                                  "</tr><tr><td>x | y</td><td></td></tr>"
                                  "</tbody></table>")

    def test_delimiter_cell_count_must_match_header(self):
        storage, _ = convert("a | b\n---\n")
        self.assertNotIn("<table>", storage)
        storage, _ = convert("a | b\n--- | ---\n1 | 2\n")
        self.assertEqual(storage, "<table><tbody><tr><th>a</th><th>b</th></tr>"
                                  "<tr><td>1</td><td>2</td></tr></tbody></table>")
        # nor does a mismatched pair end a paragraph as a table
        storage, _ = convert("intro\na | b\n---\n")
        self.assertNotIn("<table>", storage)

    def test_fenced_code_macro_splits_cdata_end(self):
        storage, _ = convert("```python\nx = ']]>'\n<b>\n```\n")
        self.assertEqual(
            storage,
            '<ac:structured-macro ac:name="code"><ac:parameter '
            'ac:name="language">python</ac:parameter><ac:plain-text-body>'
            "<![CDATA[x = ']]]]><![CDATA[>'\n<b>]]></ac:plain-text-body>"
            "</ac:structured-macro>")
        well_formed(storage)

    def test_fenced_code_without_language(self):
        storage, _ = convert("~~~\n# not a heading\n~~~\n")
        self.assertNotIn("language", storage)
        self.assertIn("<![CDATA[# not a heading]]>", storage)

    def test_quote_and_rule(self):
        storage, _ = convert("> quoted *text*\n\n---\n")
        self.assertEqual(storage, "<blockquote><p>quoted <em>text</em></p>"
                                  "</blockquote><hr/>")


class LinkTests(unittest.TestCase):
    def test_absolute_link_is_an_anchor(self):
        storage, _ = convert("[site](https://e.com/?a=1&b=2)")
        self.assertEqual(storage,
                         '<p><a href="https://e.com/?a=1&amp;b=2">site</a></p>')

    def test_link_to_a_published_source_is_a_page_link(self):
        storage, _ = convert("[the decisions](../../design/d1/decisions.md#x)",
                             {"plan/design/d1/decisions.md": "Decisions: d1"})
        self.assertEqual(
            storage, '<p><ac:link><ri:page ri:content-title="Decisions: d1"/>'
                     "<ac:plain-text-link-body><![CDATA[the decisions]]>"
                     "</ac:plain-text-link-body></ac:link></p>")

    def test_percent_encoded_link_is_decoded(self):
        storage, _ = convert("[x](my%20doc.md)",
                             {"plan/briefs/b1/my doc.md": "My doc"})
        self.assertEqual(
            storage, '<p><ac:link><ri:page ri:content-title="My doc"/>'
                     "<ac:plain-text-link-body><![CDATA[x]]>"
                     "</ac:plain-text-link-body></ac:link></p>")

    def test_page_link_body_holds_code_as_plain_text(self):
        storage, _ = convert("[`gdd` <notes> & co](gdd.md)",
                             {"plan/briefs/b1/gdd.md": "GDD"})
        self.assertIn("<![CDATA[gdd <notes> & co]]>", storage)
        self.assertNotIn("<code>", storage)
        self.assertNotIn("\x00", storage)
        well_formed(storage)
        storage, _ = convert("[`gdd` notes](gdd.md)",
                             {"plan/briefs/b1/gdd.md": "GDD"})
        self.assertIn("<![CDATA[gdd notes]]>", storage)
        self.assertNotIn("<code>", storage)

    def test_angle_bracket_destination_with_spaces_is_a_link(self):
        storage, _ = convert('[doc](<my doc.md> "t")',
                             {"plan/briefs/b1/my doc.md": "My doc"})
        self.assertEqual(
            storage, '<p><ac:link><ri:page ri:content-title="My doc"/>'
                     "<ac:plain-text-link-body><![CDATA[doc]]>"
                     "</ac:plain-text-link-body></ac:link></p>")
        storage, _ = convert("[site](<https://e.com/a b>)")
        self.assertIn('href="https://e.com/a b"', storage)
        self.assertNotIn("&lt;", storage)

    def test_other_relative_link_names_the_path(self):
        storage, _ = convert("[code](../../../lib/x.py)")
        self.assertEqual(storage, "<p>code (<code>lib/x.py</code>)</p>")


class ImageTests(unittest.TestCase):
    def test_relative_image_is_an_attachment(self):
        storage, attachments = convert("![a shot](img/shot.png) and "
                                       "![again](img/shot.png)")
        self.assertIn('<ac:image ac:alt="a shot"><ri:attachment '
                      'ri:filename="shot.png"/></ac:image>', storage)
        self.assertEqual(attachments, [{"filename": "shot.png",
                                        "path": "plan/briefs/b1/img/shot.png"}])

    def test_angle_bracket_destination_with_spaces_is_an_attachment(self):
        storage, attachments = convert("![x](<my image.png>) and "
                                       "![y](<img/b.png>)")
        self.assertEqual(attachments, [
            {"filename": "my image.png", "path": "plan/briefs/b1/my image.png"},
            {"filename": "b.png", "path": "plan/briefs/b1/img/b.png"}])
        self.assertIn('ri:filename="my image.png"', storage)
        self.assertNotIn("](", storage)
        self.assertNotIn("&lt;", storage)
        well_formed(storage)

    def test_same_basename_from_another_path_gets_a_suffix(self):
        storage, attachments = convert("![a](a/shot.png) ![b](b/shot.png)")
        names = [a["filename"] for a in attachments]
        self.assertEqual(names[0], "shot.png")
        self.assertRegex(names[1], r"^shot-[0-9a-f]{8}\.png$")
        self.assertIn(f'ri:filename="{names[1]}"', storage)

    def test_percent_encoded_path_is_decoded(self):
        _, attachments = convert("![a](img/my%20shot.png)")
        self.assertEqual(attachments[0]["path"], "plan/briefs/b1/img/my shot.png")

    def test_absolute_path_and_other_schemes_are_marked_outside(self):
        _, attachments = convert("![a](/etc/x.png) ![b](file:///x.png) "
                                 "![c](data:image/png;base64,AA)")
        self.assertEqual([a.get("outside") for a in attachments],
                         [True, True, True])

    def test_absolute_image_is_a_url(self):
        storage, attachments = convert("![x](https://e.com/a.png)")
        self.assertIn('<ri:url ri:value="https://e.com/a.png"/>', storage)
        self.assertEqual(attachments, [])

    def test_whole_document_is_well_formed(self):
        md = ("---\na: b\n---\n# T\n\nText **b** [l](https://x) ![i](i.png)\n\n"
              "- a\n  - b\n\n| h |\n|---|\n| c |\n\n```\n]]>\n```\n")
        storage, _ = convert(md)
        well_formed(storage)


def _png(raw_level: int, size: int = 32) -> bytes:
    raw = b"".join(b"\x00" + b"\x01\x02\x03" * size for _ in range(size))

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    return (mdstorage.PNG_SIGNATURE
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"tEXt", b"k\x00v")
            + chunk(b"IDAT", zlib.compress(raw, raw_level))
            + chunk(b"IEND", b"")), raw


class PngTests(unittest.TestCase):
    def test_recompress_is_lossless_and_smaller(self):
        data, raw = _png(0)
        out = mdstorage.recompress_png(data)
        self.assertLess(len(out), len(data))
        self.assertTrue(out.startswith(mdstorage.PNG_SIGNATURE))
        # walk the chunks: CRCs valid, pixel data identical, order kept
        pos, kinds, idat = 8, [], b""
        while pos < len(out):
            (length,) = struct.unpack(">I", out[pos:pos + 4])
            kind, body = out[pos + 4:pos + 8], out[pos + 8:pos + 8 + length]
            (crc,) = struct.unpack(">I", out[pos + 8 + length:pos + 12 + length])
            self.assertEqual(crc, zlib.crc32(kind + body) & 0xFFFFFFFF)
            kinds.append(kind)
            if kind == b"IDAT":
                idat += body
            pos += 12 + length
        self.assertEqual(kinds, [b"IHDR", b"tEXt", b"IDAT", b"IEND"])
        self.assertEqual(zlib.decompress(idat), raw)

    def test_already_tight_png_is_kept(self):
        data, _ = _png(9)
        self.assertEqual(mdstorage.recompress_png(data), data)

    def test_inflate_past_the_cap_returns_the_input(self):
        data, raw = _png(0)
        with mock.patch.object(mdstorage, "PNG_MAX_RAW_BYTES", len(raw) // 2):
            self.assertEqual(mdstorage.recompress_png(data), data)
        with mock.patch.object(mdstorage, "PNG_MAX_RAW_BYTES", len(raw)):
            self.assertLess(len(mdstorage.recompress_png(data)), len(data))

    def test_non_png_is_unchanged(self):
        self.assertEqual(mdstorage.recompress_png(b"GIF89a..."), b"GIF89a...")
        self.assertEqual(mdstorage.recompress_png(mdstorage.PNG_SIGNATURE + b"\x00"),
                         mdstorage.PNG_SIGNATURE + b"\x00")



class ToMarkdownTests(unittest.TestCase):
    def back(self, md: str) -> str:
        storage, _ = mdstorage.convert(md, SRC)
        return mdstorage.to_markdown(storage)

    def test_the_subset_convert_emits_comes_back(self):
        md = ("# Title\n\n## Part\n\nSome **bold**, *em*, `code` and "
              "~~gone~~ text.\n\n- a\n  - a1\n- b\n\n1. one\n2. two\n\n"
              "| h1 | h2 |\n|---|---|\n| x | y\\|z |\n\n> quoted\n\n"
              "```python\nx = ']]>' < 3\n```\n\n---\n\n"
              "[site](https://example.com) and "
              "![shot](https://example.com/a.png)\n")
        self.assertEqual(self.back(md), md)

    def test_links_to_pages_and_attachments(self):
        storage, _ = mdstorage.convert(
            "See [the brief](../b2/brief.md) and ![pic](pic.png).", SRC,
            {"plan/briefs/b2/brief.md": "Brief: b2"})
        self.assertEqual(mdstorage.to_markdown(storage),
                         "See the brief and ![pic](pic.png).\n")
        bare = ('<p><ac:link><ri:page ri:content-title="Brief: b2"/>'
                '</ac:link></p>')
        self.assertEqual(mdstorage.to_markdown(bare), "Brief: b2\n")

    def test_the_provenance_footer_is_dropped(self):
        footer = plansync.page_footer("x/scope.md", "no commit", "0" * 64)
        self.assertEqual(mdstorage.to_markdown("<h2>Goal</h2>" + footer),
                         "## Goal\n")

    def test_editor_noise_keeps_its_text(self):
        storage = (
            '<h2 local-id="h-1">Goal</h2>'
            '<p local-id="p-1"><span style="color: red;">Hello</span> '
            '<span data-x="1">owner</span><br/>again</p>'
            '<ac:structured-macro ac:name="info" ac:schema-version="1">'
            '<ac:parameter ac:name="title">Note</ac:parameter>'
            '<ac:rich-text-body><p>Panel text</p></ac:rich-text-body>'
            '</ac:structured-macro>'
            '<ul><li><p>item <strong>one</strong></p><ul><li><p>sub</p>'
            '</li></ul></li></ul><custom-tag>kept text</custom-tag>')
        self.assertEqual(mdstorage.to_markdown(storage),
                         "## Goal\n\nHello owner again\n\nPanel text\n\n"
                         "- item **one**\n  - sub\n\nkept text\n")

    def test_a_date_picker_time_keeps_its_date(self):
        storage = ('<ul><li><p>Read access by <time datetime="2026-11-02" />'
                   '</p></li><li><p>Sample by <time>2026-11-05</time></p>'
                   '</li></ul>')
        self.assertEqual(mdstorage.to_markdown(storage),
                         "- Read access by 2026-11-02\n"
                         "- Sample by 2026-11-05\n")

    def test_a_task_list_is_checkbox_lines_without_id_or_status(self):
        storage = (
            '<ac:task-list><ac:task><ac:task-id>1</ac:task-id>'
            '<ac:task-status>incomplete</ac:task-status>'
            '<ac:task-body>Send <strong>sample</strong></ac:task-body>'
            '</ac:task><ac:task><ac:task-id>2</ac:task-id>'
            '<ac:task-status>complete</ac:task-status>'
            '<ac:task-body>Grant access by <time datetime="2026-11-02" />'
            '</ac:task-body></ac:task></ac:task-list><p>after</p>')
        self.assertEqual(mdstorage.to_markdown(storage),
                         "- [ ] Send **sample**\n"
                         "- [x] Grant access by 2026-11-02\n\nafter\n")

    def test_an_empty_body_is_empty(self):
        self.assertEqual(mdstorage.to_markdown(""), "")


class ScopeRoundTripTests(unittest.TestCase):
    """AC2: Markdown to storage format to mirrored Markdown keeps every
    section, every deliverable's signal and every story heading, as
    `engage.py`'s scope parser reads them."""

    def test_the_scope_round_trip_keeps_every_section(self):
        from test_engage import SCOPE
        scope = SCOPE + "\n## Assumptions\n\n- db: postgres (the default)\n"
        storage, attachments = mdstorage.convert(
            scope, "_bmad-output/engagements/ENG-001/scope.md")
        self.assertEqual(attachments, [])
        footer = plansync.page_footer(
            "_bmad-output/engagements/ENG-001/scope.md", "no commit",
            plansync.page_hash("ENG-001: Scope of Work", storage, []))
        mirrored = mdstorage.to_markdown(storage + footer)
        self.assertNotIn("Published by tk-studio", mirrored)
        before = engage.parse_scope(scope)["sections"]
        after = engage.parse_scope(mirrored)["sections"]
        self.assertEqual([t for t, _ in after], [t for t, _ in before])
        self.assertEqual([t for t, _ in after],
                         list(engage.SCOPE_SECTIONS) + ["Assumptions"])
        # the mirrored scope passes the planner's own check
        engage.check_scope(mirrored, [{"question": "db"}])
        deliverables = engage._subsections(dict(after)["Deliverables"], 3)
        self.assertEqual([t for t, _ in deliverables],
                         ["CSV export", "Date range filter"])
        signals = [line for _, lines in deliverables for line in lines
                   if engage.SIGNAL_RE.match(line)]
        self.assertEqual(signals, [
            "Acceptance signal: the downloaded file holds the filtered rows.",
            "Acceptance signal: a range of one month exports that month "
            "only."])
        for heading in ("### Epic 1: Report exports",
                        "#### Story 1.1: CSV button",
                        "#### Story 1.2: Filtered export"):
            self.assertIn("\n" + heading + "\n", mirrored)
        self.assertIn("- Read access to the reports service by 2026-11-02.",
                      mirrored)
        # converted again, the mirror is the same page body
        self.assertEqual(mdstorage.convert(mirrored, "x.md")[0], storage)

    def test_a_dependency_dated_by_the_date_picker_passes_the_date_rule(self):
        from test_engage import SCOPE
        storage, _ = mdstorage.convert(
            SCOPE, "_bmad-output/engagements/ENG-001/scope.md")
        plain = "Read access to the reports service by 2026-11-02."
        self.assertIn(f"<li>{plain}</li>", storage)
        # the owner re-picked the date in the editor
        storage = storage.replace(
            f"<li>{plain}</li>",
            '<li><p>Read access to the reports service by '
            '<time datetime="2026-11-02" /></p></li>')
        mirrored = mdstorage.to_markdown(storage)
        self.assertIn("- Read access to the reports service by 2026-11-02\n",
                      mirrored)
        self.assertEqual([t for t, _ in engage.parse_scope(mirrored)
                          ["sections"]], list(engage.SCOPE_SECTIONS))
        engage.check_scope(mirrored)  # no `dependency N has no date`


if __name__ == "__main__":
    unittest.main()
