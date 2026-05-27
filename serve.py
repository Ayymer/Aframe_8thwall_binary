#!/usr/bin/env python3
"""Local HTTPS static server for AR testing on phone."""

import http.server
import os
import socket
import ssl

PORT = 5501
DIR = os.path.dirname(os.path.abspath(__file__))


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


os.chdir(DIR)
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(("0.0.0.0", PORT), handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain("cert.pem", "key.pem")
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

ip = local_ip()
url = f"https://{ip}:{PORT}/"

print()
print("  Painting AR — test server running")
print("  " + "=" * 40)
print(f"  Phone URL:  {url}")
print(f"  QR page:    {url}qr.html")
print("  " + "=" * 40)
print("  Press Ctrl+C to stop")
print()

httpd.serve_forever()
