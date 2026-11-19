"""Report Mermaid diagrams that may be split across two pages of a converted book PDF.

usage:
  uv run --no-project --with pypdf --with pyyaml python scripts/splitcheck.py <book dir> <book.pdf>

A diagram is located by its node labels; a split shows up as labels found on a
neighbouring page that are missing from the best-matching page.
"""

import sys
from pathlib import Path

from pypdf import PdfReader

from figpages import load_figures, normalize, page_texts


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    book_dir, pdf_path = map(Path, sys.argv[1:3])
    _chapters, figs = load_figures(book_dir)
    texts = page_texts(PdfReader(pdf_path))
    found = 0
    for no, kind, cap, labels in figs:
        if kind != "mermaid":
            continue
        keys = [normalize(lb) for lb in labels if len(lb) >= 3]
        hits = {i: s for i, t in enumerate(texts) if (s := sum(1 for k in keys if k in t))}
        if not hits:
            print("not found", no, cap)
            continue
        best = max(hits, key=hits.get)
        for i in (best - 1, best + 1):
            if hits.get(i) and any(k in texts[i] and k not in texts[best] for k in keys):
                print(f"possible split: ch{no} p.{best + 1}/{i + 1} {cap[:50]}")
                found += 1
    print(f"possible splits: {found}")


if __name__ == "__main__":
    main()
