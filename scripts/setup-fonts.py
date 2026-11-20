# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.68.0"]
# ///
"""PDF 用の TrueType フォントを fonts/ttf/ に用意する。

Chromium（Skia）は OTF/CFF のフォントやカラー絵文字を Type 3 フォントとして PDF に入れる。
ここで作る TrueType（glyf）の静的なフォントだけを fonts/fonts.conf で Chromium に見せると、
Type 3 フォントの入らない PDF を作れる（docs/font-setup.md）。

- Noto Sans JP / Noto Serif JP / Noto Emoji：google/fonts の可変 TTF から、fontTools で
  Regular（400）と Bold（700）の静的なフォントを作る。
- Liberation Mono（コード）と DejaVu Sans（ほかのフォントにない記号の予備）：配布物から取り出す。

取ってくるファイルは、コミットや版を固定し、SHA-256 を確かめる。作るフォントは SOURCE_DATE_EPOCH を
固定するので、同じ版の fontTools なら毎回同じバイト列になる。

使い方: mise run setup-fonts（uv run --script scripts/setup-fonts.py [--force]）
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

GOOGLE_FONTS_COMMIT = "06bfe0d62a98375cb09c942fa18e68bd32cff057"
GOOGLE_FONTS_RAW = f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_COMMIT}"
# google/fonts の上のコミットの日時（2026-11-20T19:59:51Z）。作るフォントの日時に使う。
SOURCE_DATE_EPOCH = "1795723191"

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = ROOT / "fonts"
TTF_DIR = FONTS_DIR / "ttf"
MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1


@dataclass(frozen=True)
class Download:
    url: str
    sha256: str


@dataclass(frozen=True)
class VariableSource:
    """google/fonts の可変 TTF から静的なフォントを作る。"""

    family: str
    download: Download
    license: Download
    weights: tuple[tuple[int, str], ...]


@dataclass(frozen=True)
class ArchiveSource:
    """配布物（tar）から TTF を取り出す。"""

    name: str
    download: Download
    members: tuple[tuple[str, str, str, str], ...]  # (tar の中のパス, 保存名, family, style)
    license_member: str


VARIABLE_SOURCES = (
    VariableSource(
        family="Noto Sans JP",
        download=Download(
            f"{GOOGLE_FONTS_RAW}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
            "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
        ),
        license=Download(
            f"{GOOGLE_FONTS_RAW}/ofl/notosansjp/OFL.txt",
            "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9",
        ),
        weights=((400, "Regular"), (700, "Bold")),
    ),
    VariableSource(
        family="Noto Serif JP",
        download=Download(
            f"{GOOGLE_FONTS_RAW}/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf",
            "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc",
        ),
        license=Download(
            f"{GOOGLE_FONTS_RAW}/ofl/notoserifjp/OFL.txt",
            "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6",
        ),
        weights=((400, "Regular"), (700, "Bold")),
    ),
    VariableSource(
        family="Noto Emoji",
        download=Download(
            f"{GOOGLE_FONTS_RAW}/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf",
            "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551",
        ),
        license=Download(
            f"{GOOGLE_FONTS_RAW}/ofl/notoemoji/OFL.txt",
            "500bb1ccf43df7bbb522112f9133a52b16e1c35e809632f5d8609b179152de5b",
        ),
        weights=((400, "Regular"),),
    ),
)

ARCHIVE_SOURCES = (
    ArchiveSource(
        name="LiberationMono",
        download=Download(
            "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz",
            "7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0",
        ),
        members=(
            ("liberation-fonts-ttf-2.1.5/LiberationMono-Regular.ttf", "LiberationMono-Regular.ttf", "Liberation Mono", "Regular"),
            ("liberation-fonts-ttf-2.1.5/LiberationMono-Bold.ttf", "LiberationMono-Bold.ttf", "Liberation Mono", "Bold"),
        ),
        license_member="liberation-fonts-ttf-2.1.5/LICENSE",
    ),
    ArchiveSource(
        name="DejaVuSans",
        download=Download(
            "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2",
            "fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7",
        ),
        members=(
            ("dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf", "DejaVuSans.ttf", "DejaVu Sans", "Book"),
        ),
        license_member="dejavu-fonts-ttf-2.37/LICENSE",
    ),
)


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(download: Download) -> bytes:
    print(f"  取得: {download.url}")
    with urllib.request.urlopen(download.url, timeout=120) as response:  # noqa: S310（固定の https の URL）
        data = response.read()
    actual = sha256_of(data)
    if actual != download.sha256:
        raise SystemExit(
            f"エラー: SHA-256 が一致しません: {download.url}\n  期待: {download.sha256}\n  実際: {actual}"
        )
    return data


def read_tar_member(archive: bytes, member: str) -> bytes:
    # extractall は使わず、決めたメンバーだけを読む
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        info = tar.getmember(member)
        if not info.isfile():
            raise SystemExit(f"エラー: {member} がファイルではありません")
        extracted = tar.extractfile(info)
        if extracted is None:
            raise SystemExit(f"エラー: {member} を読めません")
        return extracted.read()


def instantiate(variable_ttf: bytes, weight: int, out_path: Path) -> None:
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    font = TTFont(io.BytesIO(variable_ttf))
    axes = {axis.axisTag: axis for axis in font["fvar"].axes}
    location = {tag: (weight if tag == "wght" else axis.defaultValue) for tag, axis in axes.items()}
    static = instancer.instantiateVariableFont(font, location, updateFontNames=True)
    static.save(out_path)


def verify_font(path: Path, family: str, style: str) -> None:
    from fontTools.ttLib import TTFont

    font = TTFont(path)
    problems = []
    if "glyf" not in font:
        problems.append("glyf テーブルがない（TrueType ではない）")
    if "fvar" in font:
        problems.append("fvar テーブルがある（可変フォントのまま）")
    name = font["name"]
    actual_family = name.getDebugName(16) or name.getDebugName(1)
    if actual_family != family:
        problems.append(f"ファミリー名が {actual_family!r}（期待: {family!r}）")
    if style == "Bold" and font["OS/2"].usWeightClass != 700:
        problems.append(f"usWeightClass が {font['OS/2'].usWeightClass}（期待: 700）")
    if problems:
        raise SystemExit(f"エラー: {path.name}: " + "、".join(problems))


def is_complete(ttf_dir: Path) -> bool:
    manifest_path = ttf_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return False
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != MANIFEST_VERSION or manifest.get("googleFontsCommit") != GOOGLE_FONTS_COMMIT:
        return False
    for entry in manifest.get("fonts", []) + manifest.get("licenses", []):
        file = ttf_dir / entry["file"]
        if not file.is_file() or sha256_of(file.read_bytes()) != entry["sha256"]:
            return False
    return True


def build(work_dir: Path) -> None:
    fonts: list[dict[str, str]] = []
    licenses: list[dict[str, str]] = []

    def record(target: list[dict[str, str]], path: Path, **extra: str) -> None:
        target.append({"file": path.name, "sha256": sha256_of(path.read_bytes()), **extra})

    for source in VARIABLE_SOURCES:
        print(f"{source.family}")
        variable = fetch(source.download)
        compact = source.family.replace(" ", "")
        for weight, style in source.weights:
            out = work_dir / f"{compact}-{style}.ttf"
            instantiate(variable, weight, out)
            verify_font(out, source.family, style)
            record(fonts, out, family=source.family, style=style)
            print(f"  作成: {out.name}")
        license_path = work_dir / f"OFL-{compact}.txt"
        license_path.write_bytes(fetch(source.license))
        record(licenses, license_path)

    for source in ARCHIVE_SOURCES:
        print(f"{source.name}")
        archive = fetch(source.download)
        for member, file_name, family, style in source.members:
            out = work_dir / file_name
            out.write_bytes(read_tar_member(archive, member))
            verify_font(out, family, style)
            record(fonts, out, family=family, style=style)
            print(f"  取り出し: {out.name}")
        license_path = work_dir / f"LICENSE-{source.name}.txt"
        license_path.write_bytes(read_tar_member(archive, source.license_member))
        record(licenses, license_path)

    manifest = {
        "version": MANIFEST_VERSION,
        "googleFontsCommit": GOOGLE_FONTS_COMMIT,
        "fonts": fonts,
        "licenses": licenses,
    }
    # 全部そろったことを示すファイル。変換ツールはこれを見て fonts/fonts.conf を使うかを決める。
    (work_dir / MANIFEST_NAME).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF 用の TrueType フォントを fonts/ttf/ に用意する")
    parser.add_argument("--force", action="store_true", help="そろっていても作り直す")
    args = parser.parse_args()

    if not args.force and is_complete(TTF_DIR):
        print(f"フォントはそろっています: {TTF_DIR}（作り直すときは --force）")
        return 0

    # 作るフォントの日時を固定し、毎回同じバイト列にする（fontTools が使う）
    os.environ["SOURCE_DATE_EPOCH"] = SOURCE_DATE_EPOCH
    FONTS_DIR.mkdir(exist_ok=True)
    # 一時フォルダで全部作ってから入れ替える（途中で失敗しても、半端な fonts/ttf/ を残さない）
    work_dir = Path(tempfile.mkdtemp(prefix="ttf-work-", dir=FONTS_DIR))
    try:
        build(work_dir)
        if TTF_DIR.exists():
            shutil.rmtree(TTF_DIR)
        work_dir.chmod(0o755)  # mkdtemp は 0700 で作るので、普通のフォルダと同じにする
        work_dir.rename(TTF_DIR)
    finally:
        if work_dir.exists():
            shutil.rmtree(work_dir)

    print(f"完了: {TTF_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
