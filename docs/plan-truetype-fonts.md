# 計画：Type 3 フォントを出さない・見つける

作成：2026-11-21（同日、4つのモデル（Sonnet、Haiku、Fable、Codex）のレビューを反映して改訂）

## 目的

技術書典21の審査で、「PDF のフォントが埋め込まれていない（`T3_Font`、Type 3 フォント）」として非承認になった。

- **Linux（WSL を含む）で、`mise run setup-fonts` を1回実行すれば、** 変換ツールで作る PDF が、毎回の環境変数なしでも Type 3 フォントを含まないようにする。
- どの OS でも、**Type 3 や埋め込まれていないフォントが入ったときは、PDF を作った時点で気づける**ようにする。

対応範囲：Type 3 を出さない仕組み（PR 2）は Linux だけで保証する。Chromium は macOS では CoreText、Windows では DirectWrite で字を描くため、`FONTCONFIG_FILE` が効かない。macOS と Windows では、検出（PR 1）だけを提供する。

## 背景（分かっていること）

- PDF を作る Chromium（Skia）は、OTF/CFF のフォント（`fonts-noto-cjk` の `.ttc`）とカラー絵文字（Noto Color Emoji）を、Type 3 フォントとして PDF に入れる。
  - 審査で落ちた PDF：`pdffonts` の行は 523 行で、そのうち 520 行が Type 3 だった（Noto Serif/Sans/Mono CJK JP、Noto Color Emoji）。Skia は1つの書体を多数の Type 3 フォントに分けて入れるので、この数は書体の数ではない。
- 今回のフォントと描画の条件では、静的な TrueType（glyf）のフォントは CID TrueType として埋め込まれた。ただし、Skia には TrueType でも Type 3 に落とす経路（可変フォント、合成の太字・斜体の一部など）があるので、「TrueType なら必ず安全」とはしない。最終的な判定は、作った PDF で行う。
- 手元で行った対策（2026-11-21）：
  - Google Fonts の可変 TTF から、fontTools で太さを固定した TTF を作った（Noto Sans JP / Noto Serif JP の Regular・Bold、Noto Emoji）。
  - TrueType のフォントだけを見せる `fonts.conf` を作り、`FONTCONFIG_FILE` で指定して PDF を作った。
  - 結果：863 ページ。フォント 9 個（Type 0）すべてが CID TrueType で埋め込み。Acrobat Reader の「文書のプロパティ → フォント」でも確認した。
  - 絵文字はカラー（Noto Color Emoji）から白黒（Noto Emoji）に変わった。**これは意図した変更**として扱う（カラー絵文字は Type 3 になるため）。
- 今の変換ツールの問題：
  - 既定のフォント（`config-loader.ts`、`md-renderer.ts:372` の予備の値）、`pdf.config.example.json`、テスト用の設定、README の設定の例、`docs/font-setup.md` が、Type 3 になる `Noto Serif/Sans CJK JP` を勧めている。
  - Type 3 が入っても、何も警告しない。
  - `warnIfNotoFontsUnavailable()` は名前に「noto」があるかだけを見るため、Type 3 の原因になる `Noto Sans CJK JP` を「OK」と判定する。
  - 手元の対策は、毎回 `FONTCONFIG_FILE=...` を付けないと効かない。

## 実験で確かめたこと（2026-11-21）

- pdf-lib 1.17.1 で 863 ページ（21MB、間接オブジェクト 47,207 個）の PDF を読み込み、全オブジェクトを調べる時間：約 0.9 秒、メモリ約 240MB（Sonnet・Fable・Codex がそれぞれ測定）。
- 863 ページの PDF のフォント辞書：`/Type0` が 9 個、その子の `/CIDFontType2` が 9 個（どちらも `/Type /Font`）。
- Skia の Type 3 のフォント辞書には `BaseFont` がない。名前は `FontDescriptor` の `FontName`（例：`AAAAAA+NotoSansCJKjp-Regular`）にだけある。
- `pdffonts` は、Type 3 でも `emb` を `yes` と表示する。
- `FONTCONFIG_FILE` の挙動（fontconfig 2.15.0）：
  - 絶対パスで指定すると、`<dir prefix="relative">ttf</dir>` は設定ファイルの場所を基準に読まれる。
  - **相対パスで指定すると、エラーも警告も出ずにシステムの設定に戻る。**
  - 存在しないファイルを指定すると、`Fontconfig error: Cannot load default config file` を出してシステムの設定に戻る。
- Puppeteer の `launch({ env })` は、子プロセスの環境変数を丸ごと置き換える（既定値は `process.env`）。
- 太さを固定した手元の TTF：glyf あり、fvar なし、`fsType=0`、Bold は `usWeightClass=700`。
- ライセンス：3書体とも OFL 1.1。予約名（Reserved Font Name）は、Noto Sans JP が「Source」だけ。Noto Serif JP と Noto Emoji にはない。そのため、太さを固定しても今の名前のままでよい。
- `@font-face` の結果は、下の「`@font-face` の確認」に書く。

## 進め方（PR を4つに分ける）

### PR 1：Type 3 フォントと埋め込まれていないフォントを見つける（先にやる）

PDF を作った直後に PDF の中を調べ、問題があれば知らせる。フォントの設定を変える前でも役に立ち、どの OS でも動くので、最初に入れる。

- `src/font-check.ts`（新規）
  - `pdf-lib` で PDF を読み込み（`updateMetadata: false`）、間接オブジェクトからフォントの辞書を集める。
  - 数える単位は**最上位のフォント**にする。`CIDFontType0` / `CIDFontType2` は単独では数えず、Type 0 の `DescendantFonts` からたどって判定する（`DescendantFonts` は参照の配列のことがあるので `lookup` で解決する）。
  - 分類は次の3つ。
    - **Type 3**：`Subtype` が `Type3`。`FontFile*` を持たないのが正常なので、「埋め込まれていない」の判定には入れない。
    - **埋め込まれていない**：`FontDescriptor` に `FontFile` / `FontFile2` / `FontFile3` がない（Type 0 は子孫で判定する。標準 14 フォントもここに入れる）。
    - **埋め込み済み**：それ以外。
  - 名前は `BaseFont`、なければ `FontDescriptor.FontName` から取る。サブセットの接頭辞（`AAAAAA+`）を外し、**書体名ごとにまとめて**、数とオブジェクト ID を返す。
  - 結果は「検査できた」と「検査できなかった（読み込みの失敗、壊れた参照）」を分ける。
  - 対象は Chromium が作る PDF とする。ページや Form XObject の中に直接書かれたフォントの辞書（参照でないもの）は見ない。この制限はコードのコメントとドキュメントに書く。
- `src/pdf-generator.ts` / `src/index.ts`
  - `renderPdfBuffer()` の後で `font-check` を呼ぶ。
  - 毎回、要約を1行出す。例：`フォント: 埋め込み 9 書体、Type 3 なし、埋め込みなし なし`
  - 問題があるときは、書体名ごとにまとめて警告する。例：`⚠️  Type 3 のフォントがあります: NotoSerifCJKjp-Regular（130 個）、NotoSerifCJKjp-Bold（112 個）…。入稿先によっては受け付けられない可能性があります。docs/font-setup.md を見てください。`
  - 検査できなかったときは、`warn` では警告し、`error` では失敗にする。
- 設定 `fontCheck`（新規）と CLI 引数 `--font-check`
  - 値：`"warn"`（既定）/ `"error"` / `"off"`
  - **`"error"` のとき：** PDF は指定した名前ではなく、`<名前>.font-error.pdf` に保存し、終了コード 1 で終わる。前に作った正しい PDF を上書きせず、問題の PDF を `pdffonts` や Acrobat で調べられるようにするため。
  - `"off"` のときは PDF の読み込み自体を省く（約 1 秒、約 240MB を節約する）。
  - 終了コードは、`process.exit` を直接呼ばずに例外として投げ、既存の `main().catch` に合わせる。
  - `config-loader.ts` の `PdfConfigOverrides`、`normalizeConfigOverrides`、`mergeConfig`、`DEFAULT_CONFIG` に追加し、値が3つのどれでもなければエラーにする（今のままでは知らない項目は黙って捨てられる）。
  - `--config` で明示した設定ファイルが読めない・壊れているときは、警告して続けずにエラーにする（入稿用の `"error"` が黙って `"warn"` に戻るのを防ぐ）。
- テスト
  - `tests/unit/font-check.test.ts`（新規）：pdf-lib で次の PDF を作って確かめる。
    - Type 3 の辞書（`BaseFont` なし、`FontDescriptor.FontName` あり）を持つ PDF → Type 3 として、名前つきで見つかる。
    - 埋め込まれていない標準フォント（Helvetica）→ 埋め込みなしとして見つかる。
    - Type 0 → CIDFontType2 → FontFile2 の PDF（pdf-lib の低レベルの API で辞書を組み立てる。fontkit や TTF の fixture は要らない）→ 問題なし、1 書体として数える。
    - 壊れた PDF → 「検査できなかった」になる。
    - 直接書かれたフォント辞書は対象外であること。
  - `tests/unit/config-loader.test.ts`：`fontCheck` の読み込みと、間違った値でのエラー。
  - `tests/e2e/convert.e2e.test.ts`：要約の行が出ること。`fontCheck: "error"` で問題があるときに終了コード 1 と `.font-error.pdf` になること（CI のフォントの状況によらない形にする）。
- 合格の条件
  - 審査で落ちた PDF と同じ条件（`FONTCONFIG_FILE` なし）で作った PDF で、Type 3 が書体名つきで報告される。
  - 今の PDF（863 ページ）では「Type 3 なし、埋め込みなし なし」になり、フォントの数の合計が `pdffonts` の行数（9。書体名では 8）と一致する。
  - 863 ページの PDF の検査が、Node 24 で数秒以内に終わる（時間とメモリを PR に書く）。

### PR 2a：設定で fontconfig の設定ファイルを指定できるようにする

仕組みだけを入れる。既定は「指定なし＝今までどおり」なので、今の利用者には影響しない。これが入れば、手元の `fonts.conf` を設定ファイルで指定でき、毎回の `FONTCONFIG_FILE=` が要らなくなる。

- 設定 `fontconfigFile`（新規）
  - 値：ファイルのパス、または `null`（使わない）。
  - 相対パスは**設定ファイルの場所を基準に**絶対パスにしてから使う（相対パスのまま渡すと、黙って無視されるため）。
  - 指定したファイルがないときは、警告して続けずにエラーにする。
  - 使うときは `fontconfig: /…/fonts.conf を使います` と1行出す。
  - Linux 以外では使わず、その旨を1行出す。
- 優先順位：設定の `fontconfigFile` ＞ 外から渡された環境変数 `FONTCONFIG_FILE` ＞ （PR 2b で入れる）`fonts/fonts.conf` の自動検出 ＞ システムの設定。
- `puppeteer.launch()` に渡す環境変数を作る関数を切り出す：`{ ...process.env, FONTCONFIG_FILE: 絶対パス }` を返す。`warnIfNotoFontsUnavailable()` の `fc-list` にも同じ環境変数を渡す。
- テスト：既存の環境変数が残ること、`FONTCONFIG_FILE` が絶対パスで上書きされること、優先順位、相対パスの解決、ファイルがないときのエラー、Linux 以外では使わないこと。
- 合格の条件：手元の `pdf.config.v2.json` に `fontconfigFile` を書き、`FONTCONFIG_FILE=` を付けずに作った PDF が、今の PDF と同じになる（863 ページ、`pdffonts` の結果が同じ）。

### PR 2b：フォントを準備するスクリプトと、既定の変更

利用者に見える変更（既定のフォント、白黒の絵文字）をここに集め、PR の説明に書く。

- `fonts/fonts.conf`（新規、リポジトリに入れる）
  - `<dir prefix="relative">ttf</dir>` で `fonts/ttf/` だけを読む。**システムのフォントの場所は書かない**（dejavu と liberation の場所は Debian/Ubuntu のもので、他のディストリビューションにはないため）。
  - キャッシュの場所は `<cachedir prefix="xdg">zenn-book-to-pdf/fontconfig</cachedir>` にする（リポジトリの中には作らない）。
  - serif / sans-serif / monospace / emoji の割り当てと、日本語・絵文字の予備（Noto Sans JP → Noto Emoji）を書く。
- `fonts/ttf/`：フォントのファイルを置く場所。`.gitignore` に入れる（1つ 5〜8MB で、合計約 28MB）。
- `fonts/README.md`（新規）：使う書体、取得元とコミット、ライセンス（OFL 1.1）、「このフォルダのフォントは MIT ではない」こと。
- `scripts/setup-fonts.py`（新規）と、`.mise.toml` のタスク `setup-fonts`
  - `.mise.toml` の `[tools]` に uv を足す。fontTools は PEP 723 のインラインメタデータで版を固定する。
  - google/fonts のコミットを固定し、可変 TTF（Noto Sans JP、Noto Serif JP、Noto Emoji）と各書体の `OFL.txt` を取ってくる（URL の `[wght]` はエンコードする）。
  - 取ってきたファイルの SHA-256 を、スクリプトに書いた値と比べる。
  - **等幅フォント（Liberation Mono）も取ってきて `fonts/ttf/` に置く**（システムのフォントを読まないため）。書体を変えるかは PR 3 で決める。
  - fontTools で Regular（400）と Bold（700）の固定版を作る。すべての軸を固定する。
  - 作ったフォントを確かめる：glyf があること、fvar がないこと、name テーブルのファミリー名が `fonts.conf` の指定と同じこと、Bold の `usWeightClass` が 700 であること。
  - 一時フォルダで作り、全部そろったら `fonts/ttf/` に移す。最後に、そろったことを示すファイル（manifest：ファイル名と SHA-256 の一覧）を書く。
- `fonts/fonts.conf` の自動検出
  - Linux で、`fonts/ttf/` の manifest があり、manifest のファイルが全部そろっているときだけ使う。フォルダがあるだけでは使わない。
  - 探す場所はツールの置き場所（`import.meta.url`）を基準にする（どのフォルダから実行しても同じになるように）。
  - `fontconfigFile: null` で使わないようにできる。
- 既定のフォント（`config-loader.ts`、`md-renderer.ts` の予備の値、`pdf.config.example.json`、テスト用の設定、README の例）
  - `bodyFamily`：`'Noto Serif JP', 'Noto Emoji', 'Hiragino Mincho ProN', 'Yu Mincho', serif`
  - `headingFamily`：`'Noto Sans JP', 'Noto Emoji', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif`
  - macOS と Windows の予備は残す（Noto を入れていない環境で、見た目が悪くならないように）。
  - コード用の CSS に残っているカラー絵文字の指定を外す。
- 豆腐（字の抜け）の検出：`src/glyph-check.ts`（新規）
  - ~~`setup-fonts` で `fonts/ttf/coverage.json`（字の一覧）を書き出す~~ → 実装では、Chromium と同じ fontconfig の設定（環境変数）で `fc-list --format=%{charset}` を実行し、見えるフォントの字の一覧を取る。`fonts/ttf/` の 8 ファイルで、fontTools の cmap と同じ一覧になることを確かめた（違いは制御文字の U+0000 と U+000D だけ）。`coverage.json` が古くなる心配がなく、`fontconfigFile` やシステムの設定でも同じ方法で調べられる。
  - 変換する前に、組み立てた HTML のテキスト（本文、目次、奥付、設定に書いた文字、Mermaid のラベル）を1字ずつ調べ、一覧にない字を集める。結合文字（Mn）、書式文字（Cf。ZWJ を含む）、異体字セレクタ（U+FE0E、U+FE0F）は対象外にする。
  - 足りない字は、字、文字コード、Unicode の名前、章の名前、出てくる回数を、字ごとにまとめて出す。例：`⚠️  フォントにない字が 4 種類あります（豆腐になります）：U+D55C 한（第3章、1回）…`
  - 設定 `glyphCheck`：`"warn"`（既定）/ `"error"` / `"off"`。`fontCheck` と同じ扱いにする（`"error"` のときは変換を始めずに終了コード 1）。
  - Linux 以外では検出を行わず、その旨を1行出す。Linux では、どの fontconfig の設定（`fonts/fonts.conf`、`fontconfigFile`、システム）でも `fc-list` で調べる。`fc-list` を使えないときは、`warn` では警告し、`error` では止める。
  - Unicode の名前は、Node.js に一覧がないので出さない（文字コードと字を出す）。
  - CLI の `--glyph-check` も足す（`--font-check` と同じ）。
  - テスト：一覧にある字・ない字・対象外の字（ZWJ、U+FE0F、結合文字）の判定、章の名前と回数の集計、`"error"` のときの終了コード。
  - 豆腐が見つかったときの対処は `docs/font-setup.md` に書く：まず原稿の字を直す（簡体字を日本の字にするなど）。どうしても必要な字なら、その字を含む TrueType のフォントを `setup-fonts` で足し、`fonts.conf` の予備に加える（足したあとも PR 1 の検出で Type 3 がないことを確かめる）。それもできないものは画像にする。
- `src/index.ts` の `warnIfNotoFontsUnavailable()`
  - 使う fontconfig の設定で `fc-match` を呼び、`Noto Serif JP`、`Noto Sans JP`、`Noto Emoji`、`monospace`、`serif:bold` が、`fonts/ttf/` のファイル（TrueType）になるかを確かめる。
  - 案内の文言を、`fonts-noto-cjk` から `mise run setup-fonts` に変える。Linux 以外では別の案内にする。
- ドキュメント
  - `docs/font-setup.md` を書き直す：Type 3 の問題、`mise run setup-fonts`、確かめ方（`pdffonts` と Acrobat Reader）、「入稿用の PDF は Linux / WSL で作る」、白黒の絵文字、用意したフォントにない字（ハングル、簡体字だけの字など）は豆腐（□）になる。
  - README：最初の使い方に `mise run setup-fonts` を足す。設定項目に `fontconfigFile` と `fontCheck` を足す。
- 合格の条件（比べる基準：今の 863 ページの PDF と、その `pdffonts` の結果。どちらも残しておく）
  - `FONTCONFIG_FILE` も `fontconfigFile` も指定せずに、新しい clone で `mise run setup-fonts` → `mise run convert` で作った PDF で、次を満たす。
    - Type 3 が 0 個、埋め込みなしが 0 個。
    - 豆腐の検出で、足りない字が 0 字（今の原稿で 0 字であることは確認済み）。
    - `pdffonts` に Noto Serif JP、Noto Sans JP、Noto Emoji、Liberation Mono があり、それ以外の書体がない（予定外のフォントに落ちていない）。
    - ページ数が 863。
    - `pdftotext` の差分が今の PDF と同じ（字が抜けていない）。
  - 見た目の確認：本文、見出し、太字、斜体、コード（日本語のコメント、絵文字）、罫線の図（`─│┌┐` など）と ▶、Mermaid の図の文字、ページ番号（フッター）。
  - レイアウトの確認（白紙のページ、図の分断、見出しの1文字残り）が今と変わらない。

### PR 3：コードのフォント（2026-11-21 に決めた）

- 決めたこと：既定を **UDEV Gothic v2.2.0 の通常版**（Regular・Bold）にする。`setup-fonts` で用意し、設定 `fonts.codeFamily` で変えられる。
  - 候補ごとに fastapi-for-starters-v2 を作って比べた。3書体とも Type 3 なし、豆腐なし、837 ページ。
  - HackGen と BIZ UDゴシックは罫線（`─│`）が全角で、ディレクトリの構成の図の横線が間延びし、日本語のコメントの桁がずれた。UDEV Gothic は罫線が半角で、図もコメントの桁もそろった。
  - 既定を今変えるか（Codex は賛成、Sonnet は「選べるだけにして次の更新で」）は、ユーザーが「今すぐ既定にする」を選んだ。承認済みの PDF は作り直さない。次に本を更新するときは 837 ページの組みを全体で確かめる。
  - 以前の組み（863 ページ）は `"codeFamily": "'Liberation Mono', 'Noto Sans JP', 'Noto Emoji', monospace"` で作れる（承認済みの PDF と文字、フォント、画像が同じになることを確かめた）。
  - `manifest.json` の版を 2 に上げた。古い `fonts/ttf/` は、変換ツールが「そろっていない」と扱い、`setup-fonts` が自動で作り直す。
- 以下は、決める前に書いたこと。

- 今は、英数字が Liberation Mono、日本語が Noto Sans JP。字幅が「日本語1文字＝英数字2文字」にそろわない。
- 候補：UDEV Gothic、HackGen、BIZ UDゴシック（どれも TrueType で配布。BIZ UD は google/fonts に静的な TTF がある）。
- 候補ごとに PDF を作り、ディレクトリの構成の図・日本語のコメントの入ったコード・Type 3 の有無を比べてから決める。
- ページ数が変わるので、次に版を更新するときに合わせて行う。

## `@font-face` の確認（2026-11-21 に実験）

`FONTCONFIG_FILE` を使わず（システムの設定には fonts-noto-cjk とカラー絵文字がある）、CSS の `@font-face` で太さを固定した TTF を読み込ませて、PDF を作った。

### 読み込み方

| 方法                                                                                                   | 結果                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `file://` の URL                                                                                       | 読み込めない（`page.setContent()` のページは `about:blank` のため）。                                                      |
| data URI（base64）                                                                                     | 読み込める。小さな HTML で約 4 秒かかる（5 書体で約 40MB の HTML になる）。                                                |
| 架空の URL（`https://fonts.invalid/…`）を Puppeteer の `setRequestInterception` で横取りし、TTF を返す | 読み込める。約 0.5 秒。**`Access-Control-Allow-Origin: *` のヘッダーを付けないと読み込めない**（フォントは CORS の対象）。 |

### 本1冊（fastapi-for-starters-v2）での結果

- 横取りの方法で、本文・見出しを `@font-face` の書体にし、`FONTCONFIG_FILE` なしで作った。全体で約 20 秒、メモリ約 660MB。
- 最初は Type 3 が残った。原因は CDP の `CSS.getPlatformFontsForNode` で突き止めた。
  1. **コードのファイル名（`.code-block-filename`）：** zenn-content-css の `font-family` のままだったため、日本語がシステムの `Noto Sans Mono CJK JP`（Type 3）になった。→ コードと同じ `font-family` を指定して直った。
  2. **異体字セレクタ U+FE0F 付きの絵文字（`⚡️` など）：** `font-family` の先に白黒の絵文字があっても、Chromium はカラー絵文字（Type 3）を選んだ。`font-variant-emoji: text` では直らなかった。→ 本文の U+FE0F を取り除いて直った。
- 直したあと：**Type 3 が 0 個**、フォント 8 書体（Noto Sans JP R/B、Noto Serif JP R/B、Noto Emoji、Liberation Mono R/B、DejaVu Sans）すべてが CID TrueType。
  - DejaVu Sans はフッター（ページ番号）。フッターは別の文書として描かれるので、`@font-face` が効かない（フッターの中に `@font-face` を書いても、data URI でも効かなかった）。システムのフォントが使われる。
  - Liberation Mono はシステムのフォント（コード用の `font-family` の先頭）。
- ページ数は **856**（fontconfig の方法では 863）。5 ページ目から1行の字数が少し増え、本全体が組み直された。ウェブフォントは字の幅を整数に丸めないため、と推測している（未確認）。白紙のページと見出しの1行残りは、今の PDF と同じ数（白紙 2、見出しの残り 1）。

### 小さな HTML で分かったこと

- 日本語、太字、斜体（合成の斜体）、記号（✓ → ▶ ※ ① と罫線）、絵文字（国旗、ZWJ の家族）は、`@font-face` の書体に入った。
- `@font-face` の書体にない字（ハングル、簡体字だけの字）は、システムのフォントに落ちる。今の環境では WenQuanYi Zen Hei（TrueType）だったが、環境によっては Type 3 になりうる。

### 2つの方法の比べ

|                      | fontconfig（`FONTCONFIG_FILE`）            | `@font-face`                                                |
| -------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| 効く OS              | Linux だけ                                 | どの OS でも効くはず（macOS と Windows では未確認）         |
| フッター             | 効く                                       | 効かない（システムのフォント）                              |
| 用意した書体にない字 | 用意したフォントの中で探す（なければ豆腐） | システムのフォントに落ちる（Type 3 になりうる）             |
| 追加で要る作業       | 環境変数の受け渡し、`fonts.conf`           | リクエストの横取り、コードのファイル名の CSS、U+FE0F の除去 |
| ページ数（この本）   | 863                                        | 856                                                         |

### 結論

- **fontconfig を主にする（PR 2b は fontconfig の方法で作る）。**
  - fontconfig はシステムのフォントを一切見せないので、Type 3 になるフォントが選ばれる道そのものがない。`@font-face` は、漏れる箇所（コードのファイル名、U+FE0F の絵文字、フッター、用意した書体にない字）を1つずつふさぐ方法で、新しい CSS のクラスや文字が出てくると、また漏れうる。
  - fontconfig の弱点（用意した書体にない字が豆腐になる）は、PR 2b の「豆腐の検出」で見つける。
  - 863 ページで、技術書典に出す PDF として確認済み。
- `@font-face` は「あとで考えること」に回す。macOS や Windows で入稿用の PDF を作る必要が出たときに、補強として入れる。
- どちらの方法でも、最終的な判定は PR 1 の検出で行う。

## 豆腐（字の抜け）の確認（2026-11-21 に実験）

fontconfig の方法では、用意したフォントのどれにもない字は、システムのフォントに落ちずに豆腐（□、`.notdef`）になる。Type 3 ではないので、PR 1 の検出では見つからない。

- 方法：原稿の文字を1字ずつ、`fonts.conf` で見えるフォント（5 書体の TTF と、dejavu・liberation）の cmap に入っているかで調べた（fontTools、約 23,700 字）。結合文字（Mn）、書式文字（Cf）、異体字セレクタは対象外にした。
- 結果：fastapi-for-starters-v2 の原稿では、**足りない字は 0 字**（今の 863 ページの PDF に豆腐はない）。
- 見つけられるかの確認：`한국어 们 𠮷 ✓ 🦀` を書いた試しのファイルで、ハングル 3 字と「们」を、ファイル名と行番号つきで見つけた。「𠮷」（Noto Serif/Sans JP にある）と「🦀」（Noto Emoji にある）は、正しく対象外になった。
- 時間：フォントの読み込みを含めて数秒。
- この方法は、fontconfig で見えるフォントが決まっている（閉じ込めている）から成り立つ。「どのフォントにもない字」が、そのまま「豆腐になる字」になる。

## 決めたこと

- `fontCheck` の既定値は `"warn"`。入稿用の設定か `--font-check error` で `"error"` にする（4つのモデルの意見が一致）。
- `"error"` のときは `<名前>.font-error.pdf` に保存し、終了コード 1 にする。
- `fonts/fonts.conf` は、Linux で、フォントが全部そろっている（manifest で確かめる）ときだけ既定で使う。`fontconfigFile: null` で使わないようにできる。
- PR 2 は 2a（仕組み）と 2b（フォントの準備と既定の変更）に分ける。
- Type 3 を出さない方法は fontconfig を主にする。`@font-face` はあとで考える（理由は「`@font-face` の確認」の結論）。
- 豆腐は、PR 2b の豆腐の検出（`glyphCheck`、既定は `"warn"`）で見つける。
- 絵文字は白黒（Noto Emoji）にする。カラーにしたいときは、絵文字を SVG の画像に置き換える方式を別の課題として考える。
- 手元の `~/.local/share/zenn-book-to-pdf-fonts/` は、次の順で片付ける。
  1. 消す前に、フォントと `fonts.conf` のハッシュを記録し、別の場所に控えを取る。
  2. PR 2b の `setup-fonts` で作り直し、作った PDF を今の PDF と比べる（`pdffonts`、ページ数、`pdftotext` の差分。バイト単位の一致は求めない）。
  3. 技術書典の再提出が承認され、2. が確かめられたら消す（2026-11-21 に消した）。`~/.cache/zenn-book-to-pdf-fontconfig` も一緒に消す。
  4. zenn-tech-articles 側のメモ（`FONTCONFIG_FILE` でビルドする手順）も同時に直す。

## 元に戻す方法

- PR 1：PR を差し戻すか、`fontCheck: "off"` にする。
- PR 2a：`fontconfigFile` を指定しなければ今までどおり。
- PR 2b：`fontconfigFile: null` で自動検出を止めると、今までのシステムの設定に戻る。既定のフォントの変更は1つのコミットにまとめ、そのコミットだけ戻せるようにする。

## 順番

1. PR 1（検出）：技術書典の再提出のあとすぐ。
2. PR 2a（仕組み）：小さい。単体テストだけで出せる。
3. PR 2b（フォントの準備と既定の変更）：PR 1 の検出を使って、直ったことを確かめる。
4. PR 3（コードのフォント）：2026-11-21 に既定を UDEV Gothic にした（上の「PR 3」）。

## あとで考えること

- macOS や Windows で入稿用の PDF を作る必要が出たら、`@font-face`（リクエストの横取りで TTF を返す）を補強として入れる。実験の結果と、必要な追加の作業（コードのファイル名の CSS、U+FE0F の除去、CORS のヘッダー）は「`@font-face` の確認」に書いた。ページ数が変わる（この本では 863 → 856）ので、入れるのは版を更新するときにする。
- 作ったフォントを GitHub Release や npm パッケージで配る（利用者に Python と fontTools を要らなくする）。配るときは OFL の全文と著作権表示を同梱する。
- 入稿用の参照環境としての Dockerfile（Chromium、fontconfig、フォントを固定する）。
- CI で `setup-fonts` を動かし（フォントをキャッシュする）、本物の Chromium の出力で Type 3 が 0 個であることを確かめる e2e。
- CDP の `CSS.getPlatformFontsForNode` で、実際に使われた書体を集めて、予定外の書体を警告する。
