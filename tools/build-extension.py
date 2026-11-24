"""Packs the browser extension into public/downloads/ and updates the download box on public/extension.html.
Run from the project folder after changing anything in extension/chat-printer-exporter/:
    python tools/build-extension.py
"""
import hashlib, json, pathlib, re, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'extension' / 'chat-printer-exporter'
OUT = ROOT / 'public' / 'downloads'
PAGE = ROOT / 'public' / 'extension.html'
version = json.loads((SRC / 'manifest.json').read_text(encoding='utf-8'))['version']
name = f'chat-printer-exporter-{version}.zip'
OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob('chat-printer-exporter-*.zip'):
    old.unlink()
target = OUT / name
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(SRC.rglob('*')):
        if p.is_file():
            info = zipfile.ZipInfo('chat-printer-exporter/' + p.relative_to(SRC).as_posix(), date_time=(2026, 11, 23, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, p.read_bytes())
sha = hashlib.sha256(target.read_bytes()).hexdigest()
size_kb = max(1, round(target.stat().st_size / 1024))
(OUT / (name + '.sha256')).write_text(f'{sha}  {name}\n')
if PAGE.exists():
    t = PAGE.read_text(encoding='utf-8')
    t = re.sub(r'(<span id="ext-version">).*?(</span>)', rf'\g<1>{version}\g<2>', t)
    t = re.sub(r'(<span id="ext-size">).*?(</span>)', rf'\g<1>{size_kb} KB\g<2>', t)
    t = re.sub(r'(<code id="ext-sha"[^>]*>).*?(</code>)', rf'\g<1>{sha}\g<2>', t)
    t = re.sub(r'(<a class="cta" id="ext-dl" href=")[^"]*(")', rf'\g<1>/downloads/{name}\g<2>', t)
    PAGE.write_text(t, encoding='utf-8')
print('Built', target.relative_to(ROOT), size_kb, 'KB', 'sha256', sha)
