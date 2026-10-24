"""Markdown -> Confluence storage format, for design-page publish (Story 31.3).

A pure, stdlib-only converter (NFR9): `convert(md, source_path,
titles_by_path) -> (storage, attachments)`. It covers what the studio's
design pages use: YAML frontmatter (stripped), ATX headings, paragraphs with
`**strong**`, `*em*`, `` `code` `` and `~~del~~`, nested `-`/`*`/`+`/`1.`
lists, GFM pipe tables, fenced code (the `code` macro, a `]]>` inside the
body split across CDATA sections), block quotes, rules, links and images.

Links: an absolute URL or an anchor stays an `<a href>`; a relative link to
another published source (a key of `titles_by_path`) becomes an `ac:link`
to that page by title; any other relative link names the repository path as
plain text (it has no address on the site). Images: a relative image is an
`ri:attachment` and is returned in `attachments` (`filename`, project-
relative `path`, percent-decoded) for the caller to upload, a same-basename
image from another path getting a short path-hash suffix; an http(s) one
is an `ri:url`; an absolute path or any other scheme is returned with
`outside: True` for the caller to refuse, never read.
All text is `html.escape`d.

`recompress_png` re-deflates a PNG's IDAT stream losslessly (zlib level 9,
CRCs recomputed) and keeps the result only when it is smaller: the stdlib
cannot resample, so this is the "compress" of the 31-1 carry.

Library only; called by plansync.publish. Never prompts (AD-11).
"""
from __future__ import annotations

import hashlib
import html
import posixpath
import re
import struct
import urllib.parse
import zlib

FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([^`\s]*)[^`]*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
# a closing `#` run is stripped only when it follows whitespace or is the
# whole content (CommonMark): `## Notes on C#` keeps its `C#`
HEADING_CLOSE_RE = re.compile(r"(?:^|\s+)#+$")
RULE_RE = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
ITEM_RE = re.compile(r"^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$")
QUOTE_RE = re.compile(r"^\s{0,3}>\s?(.*)$")
SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")

# a destination is `<...>` (CommonMark: any chars but `<`, `>`, newline —
# spaces allowed) or bare (no space, `)` or `>`); the path is _dest(m)
DEST = r"(?:<([^<>\n]+)>|([^<)\s>][^)\s>]*))"
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(\s*" + DEST + r"(?:\s+\"[^\"]*\")?\s*\)")
LINK_RE = re.compile(r"\[([^\]]+)\]\(\s*" + DEST + r"(?:\s+\"[^\"]*\")?\s*\)")
AUTOLINK_RE = re.compile(r"<(https?://[^>\s]+)>")
CODE_RE = re.compile(r"(`+)(.+?)\1")
PLACEHOLDER = "\x00{}\x00"
PLACEHOLDER_RE = re.compile(r"\x00(\d+)\x00")


def _dest(m: re.Match) -> str:
    """The IMAGE_RE / LINK_RE destination, without any angle brackets."""
    return m.group(2) if m.group(2) is not None else m.group(3)


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# the most raw (inflated) IDAT bytes recompress_png will hold: a larger
# image is left as it is rather than inflated into memory
PNG_MAX_RAW_BYTES = 256 * 1024 * 1024


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


def _cdata(text: str) -> str:
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def strip_frontmatter(md: str) -> str:
    lines = md.split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                return "\n".join(lines[i + 1:])
    return md


class _Converter:
    def __init__(self, source_path: str, titles_by_path: dict[str, str]):
        self.source_dir = posixpath.dirname(source_path)
        self.titles = dict(titles_by_path or {})
        self.attachments: list[dict] = []
        self._held: list[str] = []  # the open inline() call's placeholders

    # ---------------------------------------------------------- inline
    def _resolve(self, target: str) -> str:
        return posixpath.normpath(posixpath.join(self.source_dir, target))

    def _image(self, alt: str, src: str) -> str:
        if re.match(r"^https?:", src, re.IGNORECASE) or src.startswith("//"):
            return (f'<ac:image ac:alt="{_esc(alt)}"><ri:url ri:value='
                    f'"{_esc(src)}"/></ac:image>')
        target = urllib.parse.unquote(src.split("#", 1)[0].split("?", 1)[0])
        # an absolute path or any other scheme (file:, data:, C:) is never
        # read: the caller refuses it by name (`outside`)
        outside = bool(SCHEME_RE.match(src)) or target.startswith(("/", "\\"))
        path = target if outside else self._resolve(target)
        held = next((a for a in self.attachments if a["path"] == path), None)
        if held is None:
            filename = posixpath.basename(path) or "image"
            if any(a["filename"] == filename for a in self.attachments):
                # same basename, another path: a short path-hash suffix keeps
                # each attachment its own file on the page
                stem, dot, ext = filename.rpartition(".")
                tag = hashlib.sha256(path.encode("utf-8")).hexdigest()[:8]
                filename = (f"{stem}-{tag}.{ext}" if dot and stem
                            else f"{filename}-{tag}")
            held = {"filename": filename, "path": path}
            if outside:
                held["outside"] = True
            self.attachments.append(held)
        return (f'<ac:image ac:alt="{_esc(alt)}"><ri:attachment '
                f'ri:filename="{_esc(held["filename"])}"/></ac:image>')

    def _link(self, text: str, href: str) -> str:
        if SCHEME_RE.match(href) or href.startswith(("#", "//")):
            return f'<a href="{_esc(href)}">{self._emphasis(_esc(text))}</a>'
        target = urllib.parse.unquote(href.split("#", 1)[0].split("?", 1)[0])
        path = self._resolve(target) if target else ""
        title = self.titles.get(path)
        if title is not None:
            return (f'<ac:link><ri:page ri:content-title="{_esc(title)}"/>'
                    f'<ac:plain-text-link-body>{_cdata(self._plain(text))}'
                    f'</ac:plain-text-link-body></ac:link>')
        return f"{self._emphasis(_esc(text))} (<code>{_esc(path or href)}</code>)"

    def _plain(self, text: str) -> str:
        """`text` with every held placeholder replaced by its plain text
        (tags stripped, entities unescaped): a CDATA link body is never
        markup."""
        held = self._held
        while PLACEHOLDER_RE.search(text):
            text = PLACEHOLDER_RE.sub(
                lambda m: (html.unescape(re.sub(r"<[^>]*>", "",
                                                held[int(m.group(1))]))
                           if int(m.group(1)) < len(held) else ""), text)
        return text

    @staticmethod
    def _emphasis(escaped: str) -> str:
        escaped = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<strong>\1</strong>", escaped)
        escaped = re.sub(r"(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)", r"<strong>\1</strong>", escaped)
        escaped = re.sub(r"(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])", r"<em>\1</em>", escaped)
        escaped = re.sub(r"(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])", r"<em>\1</em>", escaped)
        return re.sub(r"~~(?=\S)(.+?)(?<=\S)~~", r"<del>\1</del>", escaped)

    def inline(self, text: str) -> str:
        held: list[str] = []
        self._held = held

        def hold(fragment: str) -> str:
            held.append(fragment)
            return PLACEHOLDER.format(len(held) - 1)

        text = text.replace("\x00", "")
        text = CODE_RE.sub(lambda m: hold(f"<code>{_esc(m.group(2).strip())}</code>"), text)
        text = IMAGE_RE.sub(lambda m: hold(self._image(m.group(1), _dest(m))), text)
        text = LINK_RE.sub(lambda m: hold(self._link(m.group(1), _dest(m))), text)
        text = AUTOLINK_RE.sub(lambda m: hold(f'<a href="{_esc(m.group(1))}">'
                                               f'{_esc(m.group(1))}</a>'), text)
        out = self._emphasis(_esc(text))
        while PLACEHOLDER_RE.search(out):
            out = PLACEHOLDER_RE.sub(lambda m: held[int(m.group(1))], out)
        return out

    # ----------------------------------------------------------- blocks
    @staticmethod
    def _cells(line: str) -> list[str]:
        line = line.strip()
        if line.startswith("|"):
            line = line[1:]
        if line.endswith("|") and not line.endswith("\\|"):
            line = line[:-1]
        cells, cur, i = [], "", 0
        while i < len(line):
            if line[i] == "\\" and i + 1 < len(line) and line[i + 1] == "|":
                cur += "|"
                i += 2
                continue
            if line[i] == "|":
                cells.append(cur.strip())
                cur = ""
            else:
                cur += line[i]
            i += 1
        cells.append(cur.strip())
        return cells

    def _table_start(self, lines: list[str], i: int) -> bool:
        """True when lines[i] is a table header: it holds a `|` and the next
        line is a delimiter row with the same cell count (GFM)."""
        if "|" not in lines[i] or i + 1 >= len(lines):
            return False
        sep = lines[i + 1]
        return bool(TABLE_SEP_RE.match(sep)) and "-" in sep \
            and len(self._cells(sep)) == len(self._cells(lines[i]))

    def _table(self, lines: list[str]) -> str:
        header = self._cells(lines[0])
        rows = ["<tr>" + "".join(f"<th>{self.inline(c)}</th>" for c in header) + "</tr>"]
        for line in lines[2:]:
            cells = self._cells(line)
            cells += [""] * (len(header) - len(cells))
            rows.append("<tr>" + "".join(f"<td>{self.inline(c)}</td>"
                                         for c in cells[:len(header)]) + "</tr>")
        return "<table><tbody>" + "".join(rows) + "</tbody></table>"

    def _list(self, items: list[tuple[int, bool, str]]) -> str:
        out: list[str] = []
        stack: list[tuple[int, str]] = []
        for indent, ordered, text in items:
            tag = "ol" if ordered else "ul"
            while stack and indent < stack[-1][0]:
                out.append(f"</li></{stack.pop()[1]}>")
            if stack and indent == stack[-1][0]:
                if stack[-1][1] == tag:
                    out.append("</li><li>" + self.inline(text))
                    continue
                out.append(f"</li></{stack.pop()[1]}>")
            # a deeper item opens a list inside the open item
            out.append(f"<{tag}>")
            stack.append((indent, tag))
            out.append("<li>" + self.inline(text))
        while stack:
            out.append(f"</li></{stack.pop()[1]}>")
        return "".join(out)

    @staticmethod
    def _indent(line: str) -> int:
        return len(line.expandtabs(4)) - len(line.expandtabs(4).lstrip(" "))

    def blocks(self, lines: list[str]) -> list[str]:
        out: list[str] = []
        i, n = 0, len(lines)
        while i < n:
            line = lines[i]
            if not line.strip():
                i += 1
                continue
            fence = FENCE_RE.match(line)
            if fence:
                marker, lang = fence.group(2), fence.group(3)
                body: list[str] = []
                i += 1
                while i < n and not (lines[i].strip().startswith(marker[0] * len(marker))
                                     and not lines[i].strip().strip(marker[0])):
                    body.append(lines[i])
                    i += 1
                i += 1  # the closing fence (or the end)
                param = (f'<ac:parameter ac:name="language">{_esc(lang)}'
                         f'</ac:parameter>' if lang else "")
                out.append('<ac:structured-macro ac:name="code">' + param
                           + "<ac:plain-text-body>" + _cdata("\n".join(body))
                           + "</ac:plain-text-body></ac:structured-macro>")
                continue
            heading = HEADING_RE.match(line)
            if heading:
                level = len(heading.group(1))
                content = HEADING_CLOSE_RE.sub("", heading.group(2))
                out.append(f"<h{level}>{self.inline(content)}</h{level}>")
                i += 1
                continue
            if RULE_RE.match(line):
                out.append("<hr/>")
                i += 1
                continue
            if QUOTE_RE.match(line):
                quoted = []
                while i < n and lines[i].strip() and QUOTE_RE.match(lines[i]):
                    quoted.append(QUOTE_RE.match(lines[i]).group(1))
                    i += 1
                out.append("<blockquote>" + "".join(self.blocks(quoted))
                           + "</blockquote>")
                continue
            if self._table_start(lines, i):
                table = [line, lines[i + 1]]
                i += 2
                while i < n and lines[i].strip() and "|" in lines[i]:
                    table.append(lines[i])
                    i += 1
                out.append(self._table(table))
                continue
            if ITEM_RE.match(line):
                items: list[tuple[int, bool, str]] = []
                while i < n:
                    cur = lines[i]
                    item = ITEM_RE.match(cur)
                    if item and not RULE_RE.match(cur):
                        items.append((self._indent(cur),
                                      item.group(2)[0].isdigit(),
                                      item.group(3)))
                        i += 1
                    elif cur.strip() and self._indent(cur) > 0 \
                            and not FENCE_RE.match(cur):
                        indent, ordered, text = items[-1]
                        items[-1] = (indent, ordered, text + " " + cur.strip())
                        i += 1
                    elif not cur.strip() and i + 1 < n and (
                            ITEM_RE.match(lines[i + 1])
                            or (lines[i + 1].strip()
                                and self._indent(lines[i + 1]) > 0)):
                        i += 1
                    else:
                        break
                out.append(self._list(items))
                continue
            para: list[str] = []
            while i < n and lines[i].strip() and not (
                    FENCE_RE.match(lines[i]) or HEADING_RE.match(lines[i])
                    or RULE_RE.match(lines[i]) or QUOTE_RE.match(lines[i])
                    or (para and ITEM_RE.match(lines[i]))
                    or self._table_start(lines, i)):
                para.append(lines[i].strip())
                i += 1
            if not para:  # a line no rule took: keep it as a paragraph
                para.append(lines[i].strip())
                i += 1
            out.append("<p>" + self.inline(" ".join(para)) + "</p>")
        return out


def convert(md: str, source_path: str,
            titles_by_path: dict[str, str] | None = None) -> tuple[str, list[dict]]:
    """(storage, attachments) for one Markdown source.

    `source_path` is the source's project-relative POSIX path (relative
    links and images resolve against its directory); `titles_by_path` maps
    each published source's project-relative path to its page title.
    `attachments` lists each image once, in order: `filename`, the
    project-relative `path`, and `outside: True` when the reference is an
    absolute path or a non-http(s) scheme (the caller refuses it)."""
    text = strip_frontmatter(md.replace("\r\n", "\n").replace("\r", "\n"))
    conv = _Converter(source_path, titles_by_path or {})
    storage = "".join(conv.blocks(text.split("\n")))
    return storage, conv.attachments


# ---------------------------------------------------------------- PNG

def _chunk(kind: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))


def recompress_png(data: bytes) -> bytes:
    """The PNG with its IDAT stream re-deflated at level 9 (lossless, CRCs
    recomputed), or the input unchanged when that is not smaller or the
    bytes are not a well-formed PNG."""
    if not data.startswith(PNG_SIGNATURE):
        return data
    pos, before, after, idat = len(PNG_SIGNATURE), [], [], []
    try:
        while pos < len(data):
            (length,) = struct.unpack(">I", data[pos:pos + 4])
            kind = data[pos + 4:pos + 8]
            body = data[pos + 8:pos + 8 + length]
            if len(body) != length:
                return data
            pos += 12 + length
            if kind == b"IDAT":
                if after:
                    return data  # IDAT chunks must be consecutive
                idat.append(body)
            elif idat:
                after.append(_chunk(kind, body))
            else:
                before.append(_chunk(kind, body))
            if kind == b"IEND":
                break
        if not idat:
            return data
        inflater = zlib.decompressobj()
        raw = inflater.decompress(b"".join(idat), PNG_MAX_RAW_BYTES)
        if inflater.unconsumed_tail:
            return data  # inflates past the cap: leave it as it is
        raw += inflater.flush()
        if len(raw) > PNG_MAX_RAW_BYTES:
            return data
    except (struct.error, zlib.error):
        return data
    rebuilt = (PNG_SIGNATURE + b"".join(before)
               + _chunk(b"IDAT", zlib.compress(raw, 9)) + b"".join(after))
    return rebuilt if len(rebuilt) < len(data) else data
