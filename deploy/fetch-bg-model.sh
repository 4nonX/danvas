#!/usr/bin/env bash
# Mirrors the background-removal model (about 120 MB) into data/static-data,
# so the instance serves it itself instead of fetching it from the library
# vendor's CDN. Version = the @imgly/background-removal installed in this repo.
# Re-runnable: files already present and unchanged are skipped.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 - <<'PY'
import json
lock = json.load(open("../package-lock.json", encoding="utf-8"))
print(lock["packages"]["node_modules/@imgly/background-removal"]["version"])
PY
)
OUT="data/static-data/bg-removal/$VERSION"
echo "Background remover $VERSION -> $OUT"

python3 - "$VERSION" "$OUT" <<'PY'
import hashlib, json, os, sys, urllib.request
version, out = sys.argv[1], sys.argv[2].rstrip("/") + "/"
base = f"https://staticimgly.com/@imgly/background-removal-data/{version}/dist/"
os.makedirs(out, exist_ok=True)
def get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (danvas self-host mirror)"})
    return urllib.request.urlopen(req, timeout=timeout).read()
raw = get(base + "resources.json", 60)
res = json.loads(raw)
# The ONNX runtime and the default "medium" model (isnet_fp16).
keep = [k for k in res if k.startswith("/onnxruntime-web/") or k == "/models/isnet_fp16"]
done = 0
for k in keep:
    for c in res[k]["chunks"]:
        path = out + c["name"]
        if os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() == c["hash"]:
            continue
        data = get(base + c["name"], 300)
        if hashlib.sha256(data).hexdigest() != c["hash"]:
            sys.exit("checksum mismatch: " + c["name"])
        open(path, "wb").write(data)
        done += len(data)
open(out + "resources.json", "wb").write(raw)
print(f"done, {done / 1e6:.0f} MB downloaded")
PY

# The frontend's path must match the version.
if ! grep -q "bg-removal/$VERSION/" ../frontend/src/lib/imageFilters.ts; then
  echo "WARNING: frontend/src/lib/imageFilters.ts expects another version (adjust BG_DATA_PATH)." >&2
fi
