# フォントセットアップ

## まとめ

Linux（WSL を含む）では、最初に1回だけ次を実行してください。

```bash
mise run setup-fonts
```

`fonts/ttf/` に PDF 用の TrueType フォントが入り、以後の `mise run convert` は自動でそのフォントだけを使います。Type 3 フォントの入らない PDF ができます。

## Type 3 フォントの問題

PDF を作る Chromium（Skia）は、次のフォントを **Type 3 フォント**として PDF に入れます。

- OTF/CFF 形式のフォント（`fonts-noto-cjk` の Noto Serif/Sans/Mono CJK JP など）
- カラー絵文字（Noto Color Emoji）

Type 3 フォントは、入稿先によっては受け付けられません（技術書典では「T3_Font」として非承認になりました）。TrueType（glyf）形式で、太さを固定した（可変でない）フォントは、CID TrueType として埋め込まれます。

## mise run setup-fonts がすること

`scripts/setup-fonts.py` が、次のフォントを `fonts/ttf/` に用意します（uv で動きます。uv は `mise install` で入ります）。

| フォント                         | 使うところ                               | 取得元                                                       |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Noto Serif JP（Regular・Bold）   | 本文                                     | google/fonts の可変 TTF から、fontTools で太さを固定して作る |
| Noto Sans JP（Regular・Bold）    | 見出し、日本語の予備                     | 同上                                                         |
| Noto Emoji（Regular）            | 絵文字（白黒）                           | 同上                                                         |
| UDEV Gothic（Regular・Bold）     | コード                                   | UDEV Gothic v2.2.0（通常版）                                 |
| Liberation Mono（Regular・Bold） | コードの予備（以前の版の組み）           | Liberation Fonts 2.1.5                                       |
| DejaVu Sans                      | ほかのフォントにない記号の予備（⋮ など） | DejaVu Fonts 2.37                                            |

- 取ってくるファイルは、コミットや版を固定し、SHA-256 を確かめます。
- 作ったフォントは、TrueType（glyf）であること、可変の情報（fvar）がないこと、ファミリー名と太さが正しいことを確かめます。
- 一時フォルダで全部作ってから `fonts/ttf/` と入れ替え、最後に `manifest.json`（ファイル名と SHA-256 の一覧）を書きます。
- 同じ版の fontTools なら、毎回同じバイト列のフォントになります。
- そろっていれば何もしません。作り直すときは `uv run --script scripts/setup-fonts.py --force` を実行します。
- 用意するフォントの組を変えたときは、`manifest.json` の版（`version`）を上げます。古い版の `fonts/ttf/` は、`mise run setup-fonts` が自動で作り直します。作り直すまでは、変換ツールは「そろっていない」と警告し、`fonts/fonts.conf` を使いません。
- 各フォントのライセンスのファイルも `fonts/ttf/` に置きます（[fonts/README.md](../fonts/README.md)）。

## 変換ツールがフォントを選ぶ順番

Chromium に使わせる fontconfig の設定ファイルは、次の順で決めます（Linux だけ）。

1. 設定の `fontconfigFile`（`null` なら、以下を使わずにシステムの設定）
2. 環境変数 `FONTCONFIG_FILE`
3. `fonts/fonts.conf`（`fonts/ttf/manifest.json` のファイルが全部そろっているとき）
4. システムの設定

`fonts/fonts.conf` は `fonts/ttf/` のフォントだけを読み、システムのフォントは読みません。使うときは、次の1行を出します。

```text
🔤 fontconfig: /…/fonts/fonts.conf を使います（mise run setup-fonts で用意したフォント）
```

`fonts/ttf/` があってもファイルが欠けているときは、警告してシステムの設定を使います。

macOS と Windows の Chromium は fontconfig を使わないので、この仕組みは効きません。入稿用の PDF は Linux（WSL を含む）で作ってください。

## 確かめ方

変換ツールは、PDF を作ったあとにフォントを調べて1行出します（README の「フォントの検査（Type 3 フォント）」）。入稿用の PDF は `--font-check error` で作ってください。

```bash
mise run convert -- ../zenn-tech-articles/books/my-book output.pdf --font-check error
```

字の検査は、PDF を作る前に、フォントにない字（豆腐になる字）を探します（README の「字の検査（豆腐）」）。入稿用の PDF は `--glyph-check error` も付けて作ってください。

```bash
mise run convert -- ../zenn-tech-articles/books/my-book output.pdf --font-check error --glyph-check error
```

自分で確かめるときは次のとおりです。

```bash
pdffonts output.pdf | grep -c "Type 3"   # 0 なら Type 3 はない
```

Acrobat Reader では、「ファイル → プロパティ → フォント」で、各フォントが「埋め込みサブセット」になっていて、種類が「Type 3」でないことを確かめます。

## 既定のフォント

```json
{
  "fonts": {
    "bodyFamily": "'Noto Serif JP', 'Noto Emoji', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
    "headingFamily": "'Noto Sans JP', 'Noto Emoji', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
    "codeFamily": "'UDEV Gothic', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace, 'Noto Emoji'"
  }
}
```

ヒラギノ（macOS）と游明朝・メイリオ（Windows）は、Noto JP を入れていない環境の予備です。変換の前に、本文、見出し、コードの先頭のフォントが TrueType として見つかるかを `fc-match` で確かめ、見つからないとき、または TrueType でない（CFF など。Type 3 になる）ときは警告します。

## コードのフォント

コードは UDEV Gothic（通常版）で描きます。英数字は JetBrains Mono、日本語は BIZ UDゴシックをもとにした、日本語1文字が英数字のちょうど2文字分のフォントです。

- 日本語のコメントのあるコードや、ディレクトリの構成の図（`├── app/  # 日本語のコメント`）の桁がそろいます。
- 罫線（`─│├└`）は英数字と同じ幅です。HackGen や BIZ UDゴシックは罫線が日本語と同じ幅なので、図の横線が間延びし、桁がずれます。
- 35（英数字：日本語＝3:5）、LG（合字あり）、JPDOC（一部の記号が日本語と同じ幅）は使いません。
- 以前の版の組み（英数字が Liberation Mono）に戻す方法は、README の `codeFamily` を見てください。

## 注意

- **絵文字は白黒になります。** カラー絵文字（Noto Color Emoji）は Type 3 になるため、白黒の Noto Emoji を使います。
- **用意したフォントにない字は、豆腐（□）になります。** ハングルや、簡体字だけの字などです。システムのフォントを読まないので、Type 3 にはなりませんが、字が抜けます。字の検査で見つかります（次の「豆腐（フォントにない字）」）。
- `fonts-noto-cjk`（Noto Serif/Sans CJK JP）は Type 3 になるので、入稿用の PDF には使わないでください。画面で読むための PDF には使えます。

## 豆腐（フォントにない字）

字の検査で「フォントにない字」が出たときは、次の順で直します。

1. **原稿の字を直す。** 簡体字（们 など）を日本の字にする、記号を似た字に変えるなど。たいていはこれで済みます。
2. **フォントを足す。** どうしても必要な字なら、その字を含む TrueType（glyf）のフォントを `scripts/setup-fonts.py` で `fonts/ttf/` に用意し、`fonts/fonts.conf` の予備（`append_last`）に足します。CFF（OTF）のフォントは Type 3 になるので使えません。足したあとは、フォントの検査で Type 3 がないことを確かめてください。
3. **画像にする。** 1 も 2 もできない字は、その部分を画像にします。

字の検査は、fontconfig で見えるフォントの字の一覧（`fc-list`）と、本の字を比べています。`fonts/fonts.conf` のように見えるフォントを決めているときは、「どのフォントにもない字」が、そのまま「豆腐になる字」です。
