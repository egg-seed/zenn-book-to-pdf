# フォントセットアップ（Noto Serif CJK JP / Noto Sans CJK JP）

このプロジェクトでは、技術書向けの推奨フォントとして以下を使います。

- 本文: `Noto Serif CJK JP`
- 見出し: `Noto Sans CJK JP`（太字）

## Linux でのインストール例

### Debian / Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk
```

### WSL (Ubuntu) での注意点

WSL は Windows 側フォントを自動利用しないため、WSL 内にフォントを明示インストールしてください。

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk fontconfig
fc-cache -fv
```

### Fedora

```bash
sudo dnf install -y google-noto-cjk-fonts
```

### Arch Linux

```bash
sudo pacman -S --needed noto-fonts-cjk
```

## インストール確認

```bash
fc-list | grep -Ei "Noto Sans JP|Noto Serif JP|Noto Sans CJK JP|Noto Serif CJK JP"
```

出力に `Noto Sans CJK JP` と `Noto Serif CJK JP`（または `Noto * JP`）が含まれていれば利用可能です。

## 設定例

`pdf.config.json` の `fonts` で指定できます。

```json
{
  "fonts": {
    "bodyFamily": "'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif', 'IPAexMincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
    "headingFamily": "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans', 'IPAexGothic', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif"
  }
}
```

フォントが未導入の場合、実行時に警告を表示し、PDF生成は継続されます（フォールバックフォントで出力）。
