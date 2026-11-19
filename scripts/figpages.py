"""Collect every figure page of a converted book PDF into a review PDF, one bookmark per figure.

usage:
  uv run --no-project --with pypdf --with pyyaml python scripts/figpages.py <book dir> <book.pdf> <out.pdf>

Raster images are matched in order to the image XObjects drawn on each page.
Mermaid diagrams are located by their node labels in the page text.
The first page is assumed to be the cover image and is skipped.
"""

import collections
import re
import sys
import unicodedata
from pathlib import Path

import yaml
from pypdf import PdfReader, PdfWriter

IMG = re.compile(r"!\[(.*?)\]\(([^)\s]+\.(?:png|jpe?g|gif|webp))")
LABEL = re.compile(
    r'[\[\{\(]"([^"]+)"[\]\}\)]|[\[\{\(]([^"\[\]\{\}\(\)|]{2,})[\]\}\)]|:\s*([^:\n]{2,})$|\bas\s+(.+)$',
    re.M,
)


def normalize(s):
    """Fold CJK compatibility glyphs from PDF text extraction and drop whitespace."""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def load_figures(book_dir):
    """Return (chapters, figs); figs is a list of (chapter_no, kind, caption, labels)."""
    chapters = yaml.safe_load((book_dir / "config.yaml").read_text())["chapters"]
    figs = []
    for no, slug in enumerate(chapters, 1):
        text = (book_dir / f"{slug}.md").read_text()
        in_mermaid, buf = False, []
        for line in text.splitlines():
            if line.startswith("```mermaid"):
                in_mermaid, buf = True, []
                continue
            if in_mermaid:
                if line.startswith("```"):
                    labels = [
                        re.sub(r"<br\s*/?>", " ", next(g for g in m if g)).strip()
                        for m in LABEL.findall("\n".join(buf))
                    ]
                    cap = " / ".join(labels[:2]) or buf[0].strip()
                    figs.append((no, "mermaid", cap, labels))
                    in_mermaid = False
                else:
                    buf.append(line)
                continue
            for alt, _src in IMG.findall(line):
                figs.append((no, "image", alt, []))
    return chapters, figs


def page_texts(reader):
    return [normalize(p.extract_text() or "") for p in reader.pages]


def image_count(page):
    res = page.get("/Resources")
    xo = res.get_object().get("/XObject") if res else None
    if not xo:
        return 0
    return sum(1 for v in xo.get_object().values() if v.get_object().get("/Subtype") == "/Image")


def chapter_starts(reader, n_chapters):
    """Chapter start pages from the outline (the last n top-level entries)."""
    starts = [reader.get_destination_page_number(i) for i in reader.outline if not isinstance(i, list)]
    return starts[-n_chapters:]


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    book_dir, pdf_path, out_path = map(Path, sys.argv[1:4])
    chapters, figs = load_figures(book_dir)
    reader = PdfReader(pdf_path)
    texts = page_texts(reader)

    # Raster images in drawing order (page 1 is the cover image).
    image_pages = [i for i, p in enumerate(reader.pages) if i > 0 for _ in range(image_count(p))]
    chapter_start = chapter_starts(reader, len(chapters))

    results, img_i, missing = [], 0, []
    for no, kind, cap, labels in figs:
        lo = chapter_start[no - 1]
        hi = chapter_start[no] if no < len(chapters) else len(reader.pages)
        page = None
        if kind == "image":
            while img_i < len(image_pages) and image_pages[img_i] < lo:
                img_i += 1
            if img_i < len(image_pages) and image_pages[img_i] < hi:
                page = image_pages[img_i]
                img_i += 1
        else:
            keys = [normalize(lb) for lb in labels if len(lb) >= 2]
            best, score = None, 0
            for i in range(lo, hi):
                s = sum(1 for k in keys if k in texts[i])
                if s > score:
                    best, score = i, s
            page = best
        if page is None:
            missing.append((no, kind, cap))
        else:
            results.append((page, no, kind, cap))

    writer = PdfWriter()
    added = {}
    for page, no, kind, cap in sorted(results):
        if page not in added:
            writer.add_page(reader.pages[page])
            added[page] = len(writer.pages) - 1
        mark = "図" if kind == "image" else "Mermaid"
        writer.add_outline_item(title=f"p.{page + 1} 第{no}章 {mark}：{cap}"[:90], page_number=added[page])
    writer.write(out_path)

    n_img = sum(1 for f in figs if f[1] == "image")
    print(f"figures in markdown: images {n_img}, mermaid {len(figs) - n_img}")
    md_by_ch = collections.Counter(f[0] for f in figs if f[1] == "image")
    pdf_by_ch = collections.Counter(
        next(n for n in range(len(chapters), 0, -1) if chapter_start[n - 1] <= p) for p in image_pages
    )
    for n in sorted(set(md_by_ch) | set(pdf_by_ch)):
        if md_by_ch[n] != pdf_by_ch[n]:
            print("  image count differs: chapter", n, "md", md_by_ch[n], "pdf", pdf_by_ch[n])
    print(f"raster images found in PDF (excluding cover): {len(image_pages)}")
    print(f"located {len(results)}, missing {len(missing)}, pages in review PDF {len(added)}")
    for m in missing:
        print("  missing:", m)


if __name__ == "__main__":
    main()
