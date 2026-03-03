# zenn-book-to-pdf

Zenn book を PDF に変換する CLI ツールです。

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
