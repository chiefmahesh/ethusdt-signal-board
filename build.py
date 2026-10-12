"""Build index.html by inlining src/engine.js into src/page.src.html."""
from pathlib import Path

root = Path(__file__).parent
page = (root / "src" / "page.src.html").read_text(encoding="utf-8")
engine = (root / "src" / "engine.js").read_text(encoding="utf-8")
(root / "index.html").write_text(page.replace("/*ENGINE*/", engine), encoding="utf-8")
print("Built index.html")
