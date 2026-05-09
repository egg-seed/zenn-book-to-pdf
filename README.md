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

- Node.js `>=26.0.0`
- mise

## セットアップ

```bash
mise install
mise run setup
```

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
- 生成された PDF と `pdf.config.json` は Git 管理しません。

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
    "bodyFamily": "'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif', 'IPAexMincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
    "headingFamily": "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans', 'IPAexGothic', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif"
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

### 表紙画像

book ディレクトリ直下に `cover.png` または `cover.jpeg` を配置すると、PDF の1ページ目に画像表紙として挿入されます。

- 優先順位は `cover.png` → `cover.jpeg` です。
- 2ページ目には従来どおりタイトル・概要付きのテキスト表紙を出力します。
- 1ページ目の画像表紙は余白 0 で全面配置されます。
- 推奨サイズは 幅 500px・高さ 700px です。
- 他サイズの画像でも PDF の表紙として全面配置されます。
- 表紙画像が見つからない場合や読めない場合は、警告の上で従来のテキスト表紙だけを出力します。

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
