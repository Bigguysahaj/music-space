#!/usr/bin/env python3
"""Apply the small, repeatable local library extension before building."""
import gzip
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'vendor/yue2.cpp'
source = root / 'tools/yue-server.cpp'
text = source.read_text()
marker = '    // Music Space: expose only the configured output directory.'
if marker not in text:
    anchor = '    g_svr = &svr;'
    assert anchor in text, 'Upstream server changed; review the library extension.'
    text = text.replace(anchor, anchor + '''

    // Music Space: expose only the configured output directory.
    if (const char * outputs = std::getenv("MUSIC_SPACE_OUTPUT_DIR")) {
        svr.set_mount_point("/outputs", outputs);
    }
''', 1)
    source.write_text(text)
asset = root / 'tools/public/index.html.gz'
html = gzip.decompress(asset.read_bytes()).decode()
if 'id="music-space-library"' not in html:
    link = '''<a id="music-space-library" href="/outputs/" style="position:fixed;right:18px;bottom:18px;z-index:99999;background:#153c32;color:#d5ffe9;border:1px solid #62a58a;border-radius:12px;padding:12px 18px;font:600 14px system-ui;text-decoration:none;box-shadow:0 3px 18px #0006">♫ Saved music</a>'''
    assert '</body>' in html
    asset.write_bytes(gzip.compress(html.replace('</body>', link + '</body>').encode(), mtime=0))
