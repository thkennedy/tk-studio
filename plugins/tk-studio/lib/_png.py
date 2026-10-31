"""The studio's stdlib PNG: chunks, the decoder, the alpha mask and the 8-bit
RGB encoder (Story 36.7, DW-85).

A leaf shared by `assets.py` and `playable.py`, so neither imports the other;
`assets.py` re-exports all of these names under its old names
(`assets._png_chunk`, `assets.png_pixels`, ...) and `playable.py` imports the
two it uses (`png_encode`, `png_pixels`).
Stdlib-only (NFR9).
"""
from __future__ import annotations

import struct
import zlib


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))


def png_image(data: bytes):
    """A PNG's decoded image ``(IHDR, decompressed IDAT data)``, or None when
    ``data`` is not a readable PNG; independent of the zlib build."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    offset, ihdr, idat, ended = 8, None, [], False
    while offset + 12 <= len(data):
        length, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + 12 + length
        if end > len(data):
            return None
        body = data[offset + 8:offset + 8 + length]
        if struct.unpack_from(">I", data, end - 4)[0] != zlib.crc32(kind + body) & 0xFFFFFFFF:
            return None
        if kind == b"IHDR":
            ihdr = body
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            ended = True
            break
        offset = end
    if ihdr is None or not idat or not ended:
        return None
    try:
        return ihdr, zlib.decompress(b"".join(idat))
    except zlib.error:
        return None


def png_pixels(data: bytes):
    """``(width, height, channels, pixels)`` of an 8-bit, non-interlaced
    PNG of colour type 0, 2, 4 or 6, its rows un-filtered (types 0 to 4);
    None when ``data`` is anything else."""
    image = png_image(data)
    if image is None:
        return None
    ihdr, raw = image
    if len(ihdr) != 13:
        return None
    width, height, depth, ctype, _comp, _filt, interlace = struct.unpack(">IIBBBBB", ihdr)
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(ctype)
    if depth != 8 or channels is None or interlace != 0 or not width or not height:
        return None
    stride = width * channels
    if len(raw) < height * (stride + 1):
        return None
    out = bytearray(height * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        kind = raw[pos]
        line = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += stride + 1
        if kind == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif kind == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif kind == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif kind == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif kind != 0:
            return None
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, bytes(out)


def alpha_mask(data: bytes):
    """``(width, height, mask)``: one bool per pixel, alpha > 0; None when
    the PNG is unreadable or has no alpha channel (colour type 0 or 2: a
    render without alpha has no silhouette, so the visual gate fails it)."""
    decoded = png_pixels(data)
    if decoded is None:
        return None
    width, height, channels, pixels = decoded
    if channels not in (2, 4):
        return None
    mask = [pixels[i] > 0 for i in range(channels - 1, len(pixels), channels)]
    return width, height, mask


def png_encode(raw: bytes, width: int, height: int) -> bytes:
    """An 8-bit RGB PNG of ``raw`` (each row led by its filter byte), at
    zlib level 9: deterministic for a given zlib."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr)
            + png_chunk(b"IDAT", zlib.compress(raw, 9)) + png_chunk(b"IEND", b""))
