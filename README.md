# zenn-book-to-pdf

Zenn book 形式の原稿ディレクトリから、レビュー・配布・印刷に使いやすい PDF を生成する CLI ツールです。

[Zenn CLIで記事・本を管理する方法](https://zenn.dev/zenn/articles/zenn-cli-guide)

Zenn 形式の Markdown / CSS を活かすことが出来るので、表紙・目次・章構成をまとめて組み立て、書籍として読みやすいレイアウトの PDF に変換出来ます。既存の Zenn book ディレクトリをそのまま使えるため、技術同人誌（技術書典の電子書籍など）の制作フローに無理なく組み込めます。

## このプロジェクトでできること

- `config.yaml` と各章の Markdown を読み込み、book の構成をそのまま扱える
- `cover.png` / `cover.jpeg` を表紙画像として検出し、画像表紙・テキスト表紙・目次・各章を含む PDF に変換できる
- ページサイズ、余白、ヘッダー／フッター、フォントなどを調整（指定）できる
- Zenn book 原稿を、オフライン閲覧・レビュー配布・印刷向けの PDF として出力できる

## 前提

- Node.js `>=24.0.0`
- mise

## セットアップ

```bash
mise install
mise run setup
mise run setup-fonts
```

`mise run setup-fonts` は、PDF 用の TrueType フォントを `fonts/ttf/` に用意します（Linux。WSL を含む）。用意すると、変換ツールは自動でそのフォントだけを使い、入稿で問題になる Type 3 フォントの入らない PDF を作ります。詳しくは [docs/font-setup.md](docs/font-setup.md) を見てください。

## 使い方

```bash
mise run convert -- <bookディレクトリ> [出力ファイル.pdf]
```

例:

```bash
mise run convert -- ../zenn-tech-articles/books/my-book output.pdf
```

### コンフィグ指定

```bash
mise run convert -- <bookディレクトリ> [出力ファイル.pdf] --config <configファイル>
```

例:

```bash
mise run convert -- ../zenn-tech-articles/books/my-book output.pdf --config pdf.config.json
```

- `--config` は必ず値を伴います。`--config` 単体、`--config --other`、`--config ""` はエラー終了します。
- `pdf.config.json` はローカル用の設定ファイルとして扱います。
- 共有用テンプレートは [pdf.config.example.json](pdf.config.example.json) を使用し、必要に応じてコピーして `pdf.config.json` を作成してください。
- `--config` で指定した設定ファイルは、カレントディレクトリの `pdf.config.json` を完全に置き換えるのではなく、見つかった設定を順に上書きします。未指定の項目にはデフォルト値が使われます。
- 生成された PDF と `pdf.config.json` は Git 管理しません。本ごとの設定（例：`pdf.config.v2.json`）も `pdf.config*.json` に当たるので Git 管理しません。
- `--config` で指定した設定ファイルが見つからない、または JSON として読めないときは、エラーで終了します（入稿用の設定が黙って効かなくなるのを防ぐため）。カレントディレクトリの `pdf.config.json` が読めないときは、警告して続けます。

### フォントの検査（Type 3 フォント）

PDF を作ったあと、PDF に入ったフォントを調べて、次の1行を出します。

```text
🔤 フォント: 埋め込み 8 書体、Type 3 なし、埋め込みなし なし
```

Type 3 のフォントや、埋め込まれていないフォントがあると、書体名と数を警告します。Type 3 のフォントは、入稿先によっては受け付けられません（技術書典では「T3_Font」として非承認になりました）。原因と対策は [docs/font-setup.md](docs/font-setup.md) を見てください。

入稿用の PDF を作るときは、`--font-check error` を付けると、問題があれば終了コード 1 で止まります。

```bash
mise run convert -- ../zenn-tech-articles/books/my-book output.pdf --config pdf.config.json --font-check error
```

- `--font-check` は、設定ファイルの `fontCheck` より優先します。値は `warn`（既定）/ `error` / `off` です。
- `error` で問題が見つかったときは、PDF を指定した名前ではなく `<名前>.font-error.pdf`（例：`output.font-error.pdf`）に保存します。前に作った PDF は上書きしません。保存した PDF は `pdffonts` や Acrobat Reader で調べられます。
- 検査できなかったとき（PDF を読めないなど）は、`warn` では警告し、`error` では失敗にします。
- 検査は Chromium が作る PDF を対象にしています。863 ページの PDF で約 1 秒かかります。`off` にすると検査を省きます。

### pdf.config.json の設定

`pdf.config.json` では、PDF の用紙サイズ、余白、ヘッダー／フッター、フォント、描画待機設定を調整できます。共有用のひな形は [pdf.config.example.json](pdf.config.example.json) を参照してください。

設定例:

```json
{
  "pageSize": "A5",
  "render": {
    "waitUntil": "domcontentloaded",
    "navigationTimeout": 60000,
    "imageTimeout": 30000
  },
  "margin": {
    "top": "14mm",
    "bottom": "16mm",
    "left": "14mm",
    "right": "14mm"
  },
  "header": {
    "enabled": false,
    "template": "<div></div>"
  },
  "footer": {
    "enabled": false,
    "template": "<div style=\"width:100%;font-size:9px;color:#999;text-align:center;padding:0 25mm;\"><span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>"
  },
  "fonts": {
    "bodyFamily": "'Noto Serif JP', 'Noto Emoji', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
    "headingFamily": "'Noto Sans JP', 'Noto Emoji', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif"
  }
}
```

#### 設定項目

- `pageSize`: PDF の用紙サイズです。デフォルトは `A5` です。`letter` / `legal` / `tabloid` / `ledger` / `a0` / `a1` / `a2` / `a3` / `a4` / `a5` / `a6` を指定できます。
- `margin`: PDF の余白です。`top` / `bottom` / `left` / `right` を `"14mm"` のような文字列で指定します。デフォルトは `top: 14mm`、`bottom: 16mm`、`left: 14mm`、`right: 14mm` です。
- `header`: 各ページのヘッダー設定です。`enabled` を `true` にすると `template` に指定した HTML を表示します。デフォルトでは無効です。
- `footer`: 各ページのフッター設定です。`enabled` を `true` にすると `template` に指定した HTML を表示します。デフォルトでは無効です。ページ番号を表示したい場合は、`template` 内で `<span class="pageNumber"></span>` と `<span class="totalPages"></span>` を使えます。
- `fonts`: 本文と見出しのフォントファミリーです。`bodyFamily` と `headingFamily` に CSS の `font-family` 文字列を指定します。フォント設定の注意は [docs/font-setup.md](docs/font-setup.md) を参照してください。
- `render`: PDF 化前の待機戦略と timeout です。詳細は次の通りです。
- 書名の副題：`config.yaml` の `title` が「書名: 副題」（半角コロンと空白）または「書名：副題」の形なら、2ページ目のタイトルページと奥付では、副題を別の行に小さく出します。PDF の文書情報の書名は、`title` をそのまま使います。
- `summary`: 2ページ目のタイトルページに出す概要です。指定すると `config.yaml` の `summary` の代わりに使います。空文字 `""` にすると概要を出しません。`**太字**` の書き方で、一部を太字にできます（それ以外の Markdown は使えません）。「・」で始まる行は箇条書きとして扱い、折り返した2行目以降を字下げします。Zenn 用の告知（無料範囲など）を PDF に載せたくない場合に使います。
- `pageNumbers`: `true` にすると、各ページの下中央にページ番号を入れます。表紙画像のページには入れません。`footer` の設定と違い、表紙だけ番号を消せます。既定は `false` です。
- `fontCheck`: PDF を作ったあとのフォントの検査です。`warn`（既定。問題があれば警告する）/ `error`（問題があれば終了コード 1 で止まる）/ `off`（検査しない）のいずれかを指定します。ほかの値はエラーになります。詳しくは「フォントの検査（Type 3 フォント）」を見てください。
- `fontconfigFile`: Chromium に使わせる fontconfig の設定ファイル（`fonts.conf`）のパスです。TrueType のフォントだけを見せる `fonts.conf` を指定すると、Type 3 フォントの入らない PDF を作れます（[docs/font-setup.md](docs/font-setup.md)）。相対パスは、その設定ファイルの場所を基準にします。ファイルがなければエラーになります。指定すると、環境変数 `FONTCONFIG_FILE` や、`mise run setup-fonts` で用意した `fonts/fonts.conf` より優先します。`null` にすると、環境変数 `FONTCONFIG_FILE` も `fonts/fonts.conf` も使わず、システムの設定を使います。指定しなければ、`fonts/ttf/` のフォントがそろっているときに `fonts/fonts.conf` を自動で使います。Linux でだけ効きます（macOS と Windows の Chromium は fontconfig を使わないため）。使うときは `🔤 fontconfig: … を使います` と1行出します。
- `colophon`: 最後のページの下に置く奥付です。`title`（省略すると `config.yaml` の書名）、`rows`（`label` と `value` の組の配列）、`note`（任意の一文。情報がいつ時点のものかなど）、`copyright`（罫線の下に右寄せで置く著作権の表示）を書けます。`value` が URL だけならリンクにします。奥付のページにはページ番号を入れません。

```json
"colophon": {
  "rows": [
    { "label": "発行日", "value": "2026年11月21日 第2版" },
    { "label": "著者", "value": "著者名" },
    { "label": "Zenn", "value": "https://zenn.dev/..." }
  ],
  "note": "本書の内容は2026年11月時点の情報に基づいています。",
  "copyright": "© 2026 発行者名"
}
```

#### 描画待機設定

`render` では、HTML 描画の完了をどの条件で待つかを切り替えられます。

```json
{
  "render": {
    "waitUntil": "domcontentloaded",
    "navigationTimeout": 60000,
    "imageTimeout": 30000
  }
}
```

- `waitUntil`: `load` / `domcontentloaded` / `networkidle0` / `networkidle2`
- `navigationTimeout`: `page.setContent()` の timeout ミリ秒
- `imageTimeout`: 画像読込完了待ちの timeout ミリ秒

外部埋め込みが多い book では、`networkidle0` より `domcontentloaded` の方が安定しやすいです。

### 表と改ページ

- Zenn では横スクロールで見せる表を、PDF ではページ幅に収めます。表の中のコードは途中で折り返します。
- 見出しやコードのファイル名だけがページの最後に残らないよう、すぐ後の本文と同じページに置きます。

### mermaid の図

Zenn では mermaid のコードブロックが外部サイトの iframe として埋め込まれるため、そのままでは PDF で空白になります。本ツールは mermaid のコードブロックをページ内で描画し、図として PDF に出力します（`mermaid` パッケージを同梱）。描画に失敗した場合は警告を表示します。

### 表紙画像

book ディレクトリ直下に `cover.png` または `cover.jpeg` を配置すると、PDF の1ページ目に画像表紙として挿入されます。

- 優先順位は `cover.png` → `cover.jpeg` です。
- 2ページ目には従来どおりタイトル・概要付きのテキスト表紙を出力します。
- 1ページ目の画像表紙は余白 0 で全面配置されます。
- 推奨サイズは 幅 500px・高さ 700px です。
- 他サイズの画像でも PDF の表紙として全面配置されます。
- 表紙画像が見つからない場合や読めない場合は、警告の上で従来のテキスト表紙だけを出力します。

### 図の確認（scripts/）

PDF に変換したあと、図が正しく入っているかを確かめるための Python スクリプトです。実行には [uv](https://docs.astral.sh/uv/) を使います。

```bash
# 図のあるページだけを集めた確認用 PDF を作る（図ごとにしおりが付く）
uv run --no-project --with pypdf --with pyyaml python scripts/figpages.py ../zenn-tech-articles/books/my-book output.pdf output-figures.pdf

# mermaid の図がページをまたいで分かれていないか調べる
uv run --no-project --with pypdf --with pyyaml python scripts/splitcheck.py ../zenn-tech-articles/books/my-book output.pdf
```

- `figpages.py` は、Markdown の画像の数と PDF に入った画像の数を章ごとに比べ、違いがあれば表示します。
- 表紙画像を付けた PDF を前提に、1 ページ目は数えません。
- mermaid の図はノードのラベルの文字で探すため、ラベルが短い図は見つからないことがあります。

### 最小の book ディレクトリ構成

```text
my-book/
├── cover.png # 任意
├── config.yaml
└── chapter1.md
```

`config.yaml` の例:

```yaml
title: "My Book"
summary: "サンプル本です"
chapters:
	- chapter1
```

`chapter1.md` の例:

```md
---
title: はじめに
---

# Hello

最初の章です。
```

## 開発コマンド

- 変換実行: `mise run convert -- <bookディレクトリ> [出力ファイル.pdf]`
- テスト: `mise run test`
- フォーマット: `mise run format`
- フォーマット検証: `mise run format_check`
- Lint: `mise run lint`
- Typed Lint: `mise run lint_typed`
- Type Check: `mise run typecheck`

## 品質ゲート（ローカル/CI共通）

```bash
mise run ci
```

## バージョン管理ルール

- `package.json` の `packageManager` と `.mise.toml` の `pnpm` バージョンは常に一致させてください。
- 依存解決は `pnpm-lock.yaml` を正として管理します。

## 補足

- CLI エントリは TypeScript 実装です: `src/index.ts`
- フォント設定の注意は `docs/font-setup.md` を参照してください。
- 描画待機設定は `pdf.config.json` の `render` で調整できます。
