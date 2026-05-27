#!/bin/bash
# Pack project for Firebase Studio zip import (no GitHub push needed).
set -e
cd "$(dirname "$0")"
OUT="painting-ar.zip"
zip -r "$OUT" . \
  -x ".git/*" \
  -x "*.pem" \
  -x "serve.py" \
  -x "qr.html" \
  -x "painting-ar.zip" \
  -x "pack-for-firebase.sh" \
  -x ".DS_Store"
echo ""
echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
echo "Import at https://idx.google.com → Import a project → Upload zip"
