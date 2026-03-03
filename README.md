# zenn-book-to-pdf

Zenn book を PDF に変換する CLI ツールです。

## 前提

- Node.js `>=22.12`
- pnpm

`pnpm` が未導入の場合:

```bash
npm install -g pnpm
```

Linux で権限エラーが出る場合:

```bash
npm install -g pnpm --prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"
```

## セットアップ

```bash
pnpm install
```

## 使い方

### 基本

```bash
pnpm run convert -- <bookディレクトリ> [出力ファイル.pdf]
```

例:

```bash
pnpm run convert -- ../zenn-tech-articles/books/my-book output.pdf
```

### コンフィグ指定

```bash
pnpm run convert -- <bookディレクトリ> [出力ファイル.pdf] --config <configファイル>
```

例:

```bash
pnpm run convert -- ../zenn-tech-articles/books/my-book output.pdf --config pdf.config.json
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

- 変換実行: `pnpm run start`
- テスト: `pnpm test`
- フォーマット: `pnpm run format`
- フォーマット検証: `pnpm run format:check`
- Lint: `pnpm run lint`
- Typed Lint: `pnpm run lint:typed`
- Type Check: `pnpm run typecheck`

## 品質ゲート（ローカル/CI共通）

```bash
pnpm run format:check && pnpm run lint && pnpm run lint:typed && pnpm run typecheck && pnpm test
```

## 補足

- CLI エントリは TypeScript 実装です: `src/index.ts`
- フォント設定の注意は `docs/font-setup.md` を参照してください。
