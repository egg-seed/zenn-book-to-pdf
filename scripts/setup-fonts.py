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
- UDEV Gothic（コード。日本語1字＝英数字2字で、罫線は英数字と同じ幅）、Liberation Mono（コードの予備）、
  DejaVu Sans（ほかのフォントにない記号の予備）：配布物から取り出す。

取ってくるファイルは、コミットや版を固定し、SHA-256 を確かめる。作るフォントは SOURCE_DATE_EPOCH を
固定するので、同じ版の fontTools なら毎回同じバイト列になる。

Twemoji（カラーの絵文字の SVG）も fonts/twemoji/ に取り出す。設定 emoji: "twemoji" のときに使う。

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
import zipfile
from dataclasses import dataclass
from pathlib import Path

GOOGLE_FONTS_COMMIT = "06bfe0d62a98375cb09c942fa18e68bd32cff057"
GOOGLE_FONTS_RAW = f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_COMMIT}"
# google/fonts の上のコミットの日時（2026-11-20T19:59:51Z）。作るフォントの日時に使う。
SOURCE_DATE_EPOCH = "1795723191"

# Twemoji v17.0.3 のタグのコミット。GitHub のアーカイブはバイト列が変わることがあるので、
# アーカイブではなく、取り出した SVG の一覧（ファイル名と SHA-256）のハッシュを確かめる。
TWEMOJI_COMMIT = "b6b55fef1e8636b540a6d016a4729ca8cdf2e60b"
TWEMOJI_URL = f"https://codeload.github.com/jdecked/twemoji/tar.gz/{TWEMOJI_COMMIT}"
TWEMOJI_SVG_COUNT = 4009
TWEMOJI_SVG_DIGEST = "acf4b1719e91b046d9fd543d7c177705e54188e38e5600f3b591631152e4761d"
TWEMOJI_LICENSES = {
    "LICENSE": "5076b7ec0f98f95aa87a3103bebdcd3852acd88d61fbd99307b8d953024acb67",
    "LICENSE-GRAPHICS": "8ae9438818c26e4873b91d8c6ad620526c011e27e125677f13031eda903f007c",
}
TWEMOJI_MANIFEST_VERSION = 1

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = ROOT / "fonts"
TTF_DIR = FONTS_DIR / "ttf"
TWEMOJI_DIR = FONTS_DIR / "twemoji"
MANIFEST_NAME = "manifest.json"
# フォントの組を変えたら上げる。src/fontconfig.ts の BUNDLED_MANIFEST_VERSION と同じ値にする。
# 古い版の fonts/ttf/ は、そろっていないものとして作り直す（変換ツールも使わない）。
MANIFEST_VERSION = 2


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
    """配布物（tar または zip）から TTF を取り出す。"""

    name: str
    download: Download
    members: tuple[tuple[str, str, str, str], ...]  # (配布物の中のパス, 保存名, family, style)
    # ライセンスは、配布物の中のパス（license_member）か、別に取ってくるファイル（license_download）
    license_member: str | None = None
    license_download: Download | None = None


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

# UDEV Gothic v2.2.0 のタグのコミット。ライセンスは zip に入っていないので、このコミットから取る。
UDEV_GOTHIC_COMMIT = "ca8d6f0a66a3ce39e1e5a6cab27a214d0990630d"

ARCHIVE_SOURCES = (
    ArchiveSource(
        name="UDEVGothic",
        download=Download(
            "https://github.com/yuru7/udev-gothic/releases/download/v2.2.0/UDEVGothic_v2.2.0.zip",
            "c104c171f6ed8922ca52d74cd915a271e427f1e884e51431aae71d99e8b3b47b",
        ),
        # 通常版を使う（35 は英数字と日本語の幅が 3:5、LG は合字あり、JPDOC は罫線などが全角）
        members=(
            ("UDEVGothic_v2.2.0/UDEVGothic-Regular.ttf", "UDEVGothic-Regular.ttf", "UDEV Gothic", "Regular"),
            ("UDEVGothic_v2.2.0/UDEVGothic-Bold.ttf", "UDEVGothic-Bold.ttf", "UDEV Gothic", "Bold"),
        ),
        license_download=Download(
            f"https://raw.githubusercontent.com/yuru7/udev-gothic/{UDEV_GOTHIC_COMMIT}/LICENSE",
            "3e04c747c9c9535224f6163a290caf022877759db5183a00aef6134d3f5643f0",
        ),
    ),
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


def read_archive_member(archive: bytes, member: str) -> bytes:
    # extractall は使わず、決めたメンバーだけを読む
    if zipfile.is_zipfile(io.BytesIO(archive)):
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            info = zf.getinfo(member)
            if info.is_dir():
                raise SystemExit(f"エラー: {member} がファイルではありません")
            return zf.read(info)
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


def svg_digest(entries: list[tuple[str, str]]) -> str:
    """SVG の一覧（ファイル名と SHA-256）のハッシュ。src/emoji.ts と同じ計算。"""
    lines = "".join(f"{name}\0{sha}\n" for name, sha in sorted(entries))
    return hashlib.sha256(lines.encode()).hexdigest()


def fetch_unpinned(url: str) -> bytes:
    print(f"  取得: {url}")
    with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310（固定の https の URL）
        return response.read()


def build_twemoji(work_dir: Path) -> None:
    print("Twemoji")
    archive = fetch_unpinned(TWEMOJI_URL)
    prefix = f"twemoji-{TWEMOJI_COMMIT}/"
    svg_dir = work_dir / "svg"
    svg_dir.mkdir()
    entries: list[tuple[str, str]] = []
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for info in tar.getmembers():
            if not (info.isfile() and info.name.startswith(prefix + "assets/svg/") and info.name.endswith(".svg")):
                continue
            name = info.name[len(prefix + "assets/svg/"):]
            if "/" in name or not all(c in "0123456789abcdef-." for c in name.removesuffix(".svg")):
                raise SystemExit(f"エラー: 思っていない名前の SVG です: {name}")
            data = tar.extractfile(info).read()  # type: ignore[union-attr]
            (svg_dir / name).write_bytes(data)
            entries.append((name, sha256_of(data)))
        for license_name, expected in TWEMOJI_LICENSES.items():
            data = tar.extractfile(prefix + license_name).read()  # type: ignore[union-attr]
            if sha256_of(data) != expected:
                raise SystemExit(f"エラー: Twemoji の {license_name} の SHA-256 が一致しません")
            (work_dir / license_name).write_bytes(data)
    digest = svg_digest(entries)
    if len(entries) != TWEMOJI_SVG_COUNT or digest != TWEMOJI_SVG_DIGEST:
        raise SystemExit(
            f"エラー: Twemoji の SVG の中身が一致しません（{len(entries)} 個、{digest}）\n"
            f"  期待: {TWEMOJI_SVG_COUNT} 個、{TWEMOJI_SVG_DIGEST}"
        )
    print(f"  取り出し: svg/（{len(entries)} 個）")
    manifest = {
        "version": TWEMOJI_MANIFEST_VERSION,
        "commit": TWEMOJI_COMMIT,
        "svgCount": len(entries),
        "svgDigest": digest,
    }
    (work_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def is_twemoji_complete(twemoji_dir: Path) -> bool:
    manifest_path = twemoji_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return False
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != TWEMOJI_MANIFEST_VERSION or manifest.get("commit") != TWEMOJI_COMMIT:
        return False
    svg_dir = twemoji_dir / "svg"
    if not svg_dir.is_dir():
        return False
    entries = [(f.name, sha256_of(f.read_bytes())) for f in svg_dir.iterdir() if f.is_file()]
    return len(entries) == TWEMOJI_SVG_COUNT and svg_digest(entries) == TWEMOJI_SVG_DIGEST


def build_into(target: Path, builder, prefix: str) -> None:  # type: ignore[no-untyped-def]
    """一時フォルダで全部作ってから target と入れ替える（途中で失敗しても、半端なフォルダを残さない）。"""
    FONTS_DIR.mkdir(exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix=prefix, dir=FONTS_DIR))
    try:
        builder(work_dir)
        if target.exists():
            shutil.rmtree(target)
        work_dir.chmod(0o755)  # mkdtemp は 0700 で作るので、普通のフォルダと同じにする
        work_dir.rename(target)
    finally:
        if work_dir.exists():
            shutil.rmtree(work_dir)
    print(f"完了: {target}")


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
            out.write_bytes(read_archive_member(archive, member))
            verify_font(out, family, style)
            record(fonts, out, family=family, style=style)
            print(f"  取り出し: {out.name}")
        license_path = work_dir / f"LICENSE-{source.name}.txt"
        if source.license_download is not None:
            license_path.write_bytes(fetch(source.license_download))
        elif source.license_member is not None:
            license_path.write_bytes(read_archive_member(archive, source.license_member))
        else:
            raise SystemExit(f"エラー: {source.name} のライセンスの取り方が決まっていません")
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
    parser = argparse.ArgumentParser(
        description="PDF 用の TrueType フォントを fonts/ttf/ に、Twemoji の SVG を fonts/twemoji/ に用意する"
    )
    parser.add_argument("--force", action="store_true", help="そろっていても作り直す")
    args = parser.parse_args()

    if not args.force and is_complete(TTF_DIR):
        print(f"フォントはそろっています: {TTF_DIR}（作り直すときは --force）")
    else:
        # 作るフォントの日時を固定し、毎回同じバイト列にする（fontTools が使う）
        os.environ["SOURCE_DATE_EPOCH"] = SOURCE_DATE_EPOCH
        build_into(TTF_DIR, build, "ttf-work-")

    if not args.force and is_twemoji_complete(TWEMOJI_DIR):
        print(f"Twemoji はそろっています: {TWEMOJI_DIR}（作り直すときは --force）")
    else:
        build_into(TWEMOJI_DIR, build_twemoji, "twemoji-work-")
    return 0


if __name__ == "__main__":
    sys.exit(main())
