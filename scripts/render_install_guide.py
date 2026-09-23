"""Render the small installation guide into a dependency-free, offline HTML page."""
import html,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def inline(text):
    text=html.escape(text)
    text=re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)',r'<a href="\2">\1</a>',text)
    text=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',text)
    return re.sub(r'`([^`]+)`',r'<code>\1</code>',text)
def render():
    parts=[]; platform_open=False
    for block in (ROOT/'docs/INSTALL.md').read_text().split('\n\n'):
        if block.startswith('# '):parts.append('<h1>'+inline(block[2:])+'</h1>')
        elif block.startswith('## '):
            if platform_open:parts.append('</details>');platform_open=False
            heading=block[3:]
            if heading.startswith(('Chrome —','Edge —','Brave —','Safari —','Edge or Brave —')):
                parts.append('<details class="install-platform"><summary>'+inline(heading)+'</summary>');platform_open=True
            else:parts.append('<h2>'+inline(heading)+'</h2>')
        elif block.startswith('> '):parts.append('<blockquote>'+inline(' '.join(line.removeprefix('> ') for line in block.splitlines()))+'</blockquote>')
        elif block.startswith('1. '):
            items=re.split(r'\n(?=\d+\. )',block)
            parts.append('<ol>'+''.join('<li>'+inline(re.sub(r'^\d+\. ','',i).replace('\n',' '))+'</li>' for i in items)+'</ol>')
        elif block.startswith('| '):
            rows=[r for r in block.splitlines() if not r.startswith('| ---')]
            parts.append('<div class="guide-table" tabindex="0" role="region" aria-label="Comparison table"><table>'+''.join('<tr>'+''.join(('<th scope="col">' if i==0 else '<td>')+inline(c.strip())+('</th>' if i==0 else '</td>') for c in row.strip('|').split('|'))+'</tr>' for i,row in enumerate(rows))+'</table></div>')
        else:parts.append('<p>'+inline(block.replace('\n',' '))+'</p>')
    if platform_open:parts.append('</details>')
    document='''<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#173e37"><title>Install Along · Offline and private</title><link rel="icon" href="./icon.svg"><link rel="stylesheet" href="./style.css"></head><body class="guided-app install-guide"><main><a class="text-button" href="./">← Open Along</a>'''+ '\n'.join(parts)+'''<p><a class="secondary-button" href="./">Open Along and prepare this device</a></p></main></body></html>'''
    (ROOT/'public/install.html').write_text(document)
if __name__=='__main__':render()
