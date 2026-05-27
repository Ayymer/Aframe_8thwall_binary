#!/usr/bin/env python3
"""Local dev server with HTTP Range support.

The stdlib http.server does NOT serve HTTP 206 partial content, and iOS
Safari refuses to play <video> elements when the origin can't honour
Range requests. This minimal server fixes that for local AR testing.

Usage:
    python3 scripts/serve.py [PORT]

PORT defaults to $PORT or 8000.
"""
from __future__ import annotations

import mimetypes
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("application/wasm", ".wasm")

_RANGE_RE = re.compile(r"bytes=(\d+)-(\d*)")


class _RangeReader:
    """Wraps an open file so SimpleHTTPRequestHandler.copyfile streams only
    the bytes inside the requested range."""

    def __init__(self, fp, length: int):
        self._fp = fp
        self._remaining = length

    def read(self, n: int = -1) -> bytes:
        if self._remaining <= 0:
            return b""
        if n < 0 or n > self._remaining:
            n = self._remaining
        data = self._fp.read(n)
        self._remaining -= len(data)
        return data

    def close(self) -> None:
        try:
            self._fp.close()
        except Exception:
            pass


class RangeHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_head(self):  # type: ignore[override]
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        if not os.path.exists(path):
            self.send_error(404)
            return None

        ctype = self.guess_type(path)
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404)
            return None

        try:
            fs = os.fstat(f.fileno())
            file_size = fs.st_size
            range_header = self.headers.get("Range")

            if range_header:
                m = _RANGE_RE.match(range_header)
                if not m:
                    f.close()
                    self.send_error(416, "Invalid Range")
                    return None
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else file_size - 1
                if end >= file_size:
                    end = file_size - 1
                if start > end or start >= file_size:
                    f.close()
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    self.end_headers()
                    return None

                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self.send_header(
                    "Last-Modified", self.date_time_string(int(fs.st_mtime))
                )
                self.end_headers()
                f.seek(start)
                return _RangeReader(f, length)

            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(file_size))
            self.send_header(
                "Last-Modified", self.date_time_string(int(fs.st_mtime))
            )
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise


def main() -> None:
    port_arg = os.environ.get("PORT")
    if not port_arg and len(sys.argv) > 1:
        port_arg = sys.argv[1]
    port = int(port_arg or 8000)
    host = "0.0.0.0"
    server = ThreadingHTTPServer((host, port), RangeHTTPRequestHandler)
    print(f"[serve.py] Range-aware server on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve.py] bye")


if __name__ == "__main__":
    main()
