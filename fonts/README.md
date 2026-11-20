# fonts

PDF 用のフォントの設定です。使い方は [docs/font-setup.md](../docs/font-setup.md) を見てください。

- `fonts.conf`：Chromium に `ttf/` の TrueType フォントだけを見せる fontconfig の設定。
- `ttf/`：`mise run setup-fonts` で作るフォント。大きいので Git では管理しません。
- `twemoji/`：`mise run setup-fonts` で取り出す Twemoji の SVG（設定 `"emoji": "twemoji"` で使う）。Git では管理しません。

## ライセンス

`ttf/` のフォントは、このリポジトリのライセンス（MIT）では**ありません**。各フォントのライセンスに従います。ライセンスのファイルは、`mise run setup-fonts` が `ttf/` に一緒に置きます。

| フォント                                  | ライセンス                                            | ライセンスのファイル         |
| ----------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| Noto Sans JP / Noto Serif JP / Noto Emoji | SIL Open Font License 1.1                             | `OFL-NotoSansJP.txt` ほか    |
| UDEV Gothic                               | SIL Open Font License 1.1                             | `LICENSE-UDEVGothic.txt`     |
| Liberation Mono                           | SIL Open Font License 1.1                             | `LICENSE-LiberationMono.txt` |
| DejaVu Sans                               | Bitstream Vera Fonts のライセンスほか（自由に使える） | `LICENSE-DejaVuSans.txt`     |

Noto Sans JP / Noto Serif JP は、可変フォントから太さを固定したものを作っています（改変版）。OFL の予約名（Reserved Font Name）は Noto Sans JP の「Source」だけなので、名前はそのままです。フォントを使って作った PDF は、OFL の対象になりません。

`twemoji/` の絵は、Twemoji（© Twitter, Inc and other contributors）の CC BY 4.0 です（`twemoji/LICENSE-GRAPHICS`。コードは MIT で `twemoji/LICENSE`）。使った PDF には、変換ツールが奥付にクレジットを入れます。

`ttf/` のフォントを配るとき（ほかの人に渡す、Docker イメージに入れるなど）は、ライセンスのファイルも一緒に配ってください。
