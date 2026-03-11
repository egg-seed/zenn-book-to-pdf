# zenn-book-to-pdf

Zenn book 形式の原稿ディレクトリから、レビュー・配布・印刷に使いやすい PDF を生成する CLI ツールです。

Zenn 向けの Markdown / CSS を活かしながら、表紙・目次・章構成をまとめて組み立て、書籍らしいレイアウトの PDF に変換できます。既存の Zenn book 原稿をベースに、技術同人誌のレビュー用・頒布用 PDF を素早く作りたいときに向いています。

## このプロジェクトでできること

- `config.yaml` と章 Markdown を読み込み、book の構成をそのまま扱える
- 表紙・目次・各章を含む HTML を組み立てて PDF に変換できる
- 画像埋め込み、ページサイズ、余白、ヘッダー / フッター、フォントを調整できる
- Zenn book 原稿を、オフライン閲覧・レビュー配布・印刷向けの PDF として出力できる

## 前提

- Node.js `>=22.12`
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
- 生成された PDF と `pdf.config.json` は Git 管理しません。

### 描画待機設定

`pdf.config.json` の `render` で、PDF 化前の待機戦略と timeout を切り替えられます。

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

### 最小の book ディレクトリ構成

```text
my-book/
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
