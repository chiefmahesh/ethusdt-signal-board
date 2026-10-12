"""Build index.html: inline src/engine.js into src/page.src.html and wrap it in a full HTML document.

The wrapper adds the charset and the mobile viewport tag. Without the viewport tag,
phone browsers render the page as a zoomed-out 980px desktop layout.
"""
from pathlib import Path

root = Path(__file__).parent
page = (root / "src" / "page.src.html").read_text(encoding="utf-8")
engine = (root / "src" / "engine.js").read_text(encoding="utf-8")
body = page.replace("/*ENGINE*/", engine)

doc = (
    "<!doctype html>\n"
    '<html lang="en">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="color-scheme" content="light dark">\n'
    "<style>html{-webkit-text-size-adjust:100%;text-size-adjust:100%}"
    ":root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n"
    "</head>\n<body>\n" + body + "\n</body>\n</html>\n"
)
(root / "index.html").write_text(doc, encoding="utf-8")
print("Built index.html")
