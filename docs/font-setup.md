# フォントセットアップ

## 入稿用の PDF では Type 3 フォントに注意する

PDF を作る Chromium（Skia）は、次のフォントを **Type 3 フォント**として PDF に入れます。

- OTF/CFF 形式のフォント（`fonts-noto-cjk` の Noto Serif/Sans/Mono CJK JP など）
- カラー絵文字（Noto Color Emoji）

Type 3 フォントは、入稿先によっては受け付けられません（技術書典では「T3_Font」として非承認になりました）。TrueType（glyf）形式で、太さを固定した（可変でない）フォントは、CID TrueType として埋め込まれます。

変換ツールは PDF を作ったあとにフォントを調べ、Type 3 のフォントがあれば警告します（README の「フォントの検査（Type 3 フォント）」）。入稿用の PDF は `--font-check error` で作ってください。

### 確かめ方

```bash
pdffonts output.pdf | grep -c "Type 3"   # 0 なら Type 3 はない
```

Acrobat Reader では、「ファイル → プロパティ → フォント」で、各フォントが「埋め込みサブセット」になっていて、種類が「Type 3」でないことを確かめます。

### いまの対策（手作業）

TrueType のフォントだけを Chromium に見せると、Type 3 は入りません。今は手作業で次のように準備します（この手順を変換ツールに組み込む予定です）。

1. Google Fonts の可変 TTF（Noto Sans JP、Noto Serif JP、Noto Emoji）から、fontTools の `instancer` で Regular（400）と Bold（700）の固定版を作ります。
2. そのフォントと、TrueType の等幅フォント（Liberation Mono など）だけを読み込む `fonts.conf` を作ります。
3. 設定ファイルの `fontconfigFile` に `fonts.conf` のパスを書いて変換します（例：`"fontconfigFile": "/path/to/fonts.conf"`。相対パスは設定ファイルの場所が基準）。環境変数 `FONTCONFIG_FILE` で指定することもできます。どちらも Linux でだけ効きます。
4. 設定の `fonts` は、`'Noto Serif JP'` と `'Noto Sans JP'` を先頭にし、`'Noto Emoji'` を続けます。

この方法では、絵文字は白黒になります。

## 以下は Noto CJK を使う場合の手順です

ここから下の手順で入る Noto Serif/Sans CJK JP は、Type 3 フォントになります。画面で読むための PDF には使えますが、入稿用の PDF には上の対策を使ってください。

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
