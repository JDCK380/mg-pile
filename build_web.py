"""Build the standalone single-file web console: dist/index.html.

Usage: python build_web.py
"""
from pathlib import Path
import base64

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'


def render() -> str:
    html = (WEB / 'template.html').read_text(encoding='utf-8')
    icon = 'data:image/png;base64,' + base64.b64encode((WEB / 'favicon.png').read_bytes()).decode()
    return (html.replace('__ICON__', icon)
                .replace('/*__PROTOCOL__*/', (WEB / 'protocol.js').read_text(encoding='utf-8'))
                .replace('/*__APP__*/', (WEB / 'app.js').read_text(encoding='utf-8')))


if __name__ == '__main__':
    out = ROOT / 'dist' / 'index.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(render(), encoding='utf-8')
    print('Built', out)
