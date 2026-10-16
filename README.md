# Enclosing Fold

カーソルが本文の中にあっても、そのカーソルを含む見出しやリストのセクションを畳める Obsidian プラグインです。

## 背景

Obsidian 標準の折りたたみには次の制約があります。

- `Toggle fold` と `Fold more` は、カーソルがある**行**から始まる範囲しか畳みません。本文の行にカーソルがあると何も起きません。
- 畳んだ範囲の中にカーソルが入ると、Obsidian はその折りたたみをすぐに解除します。

このプラグインは、カーソルを囲むセクションを探し、カーソルをその先頭行へ移してから畳みます。

## コマンド

| ID | 名前 | 動作 |
| --- | --- | --- |
| `enclosing-fold:fold` | Fold section around cursor | カーソルを囲む、まだ畳まれていないうち最も内側のセクションを畳む。繰り返すと親セクションを順に畳む |
| `enclosing-fold:unfold` | Unfold section at cursor | カーソル行から始まる折りたたみを開く |
| `enclosing-fold:toggle` | Toggle fold of section around cursor | カーソル行が畳まれていれば開き、そうでなければ `fold` と同じ動作をする |
| `enclosing-fold:fold-recursive` | Fold section around cursor recursively | カーソルを囲む最も内側のセクションと、その中の畳める範囲をすべて畳む（vim の `zC`） |
| `enclosing-fold:unfold-recursive` | Unfold section around cursor recursively | カーソル行の折りたたみ（無ければカーソルを囲むセクション）の中の折りたたみをすべて開く（vim の `zO`） |
| `enclosing-fold:fold-headings` | Fold all headings | ノート内の見出しセクションをすべて畳む。リストの折りたたみ状態は変えない |
| `enclosing-fold:unfold-headings` | Unfold all headings | 見出しの折りたたみだけをすべて開く。リストの折りたたみは残す |

畳む対象は、Obsidian が畳めると判断する範囲（見出し、子を持つリスト項目など）です。
`fold-headings` / `unfold-headings` は、開始行がリスト項目（`-` `*` `+` `1.` `1)` で始まる行）でない範囲、つまり見出しだけを対象にします。

Obsidian 標準の `Fold all` / `Unfold all` は見出しとリストを区別せず、`Fold more` / `Fold less` は 1 段ずつしか開閉しないため、これらのコマンドを用意しています。

## ホットキー

設定 → ホットキーで「Enclosing Fold」を検索し、好きなキーを割り当ててください。vim のノーマルモードでも挿入モードでも動きます。

## vim キー（obsidian-vimrc-support）

`.obsidian.vimrc` の折りたたみの設定を次のように置き換えます。

```vim
exmap encfold obcommand enclosing-fold:fold
exmap encunfold obcommand enclosing-fold:unfold
exmap enctoggle obcommand enclosing-fold:toggle
nmap zc :encfold<CR>
nmap zo :encunfold<CR>
nmap za :enctoggle<CR>

exmap encfoldr obcommand enclosing-fold:fold-recursive
exmap encunfoldr obcommand enclosing-fold:unfold-recursive
exmap foldheadings obcommand enclosing-fold:fold-headings
exmap unfoldheadings obcommand enclosing-fold:unfold-headings
nmap zC :encfoldr<CR>
nmap zO :encunfoldr<CR>
nmap zH :foldheadings<CR>
nmap zh :unfoldheadings<CR>
```

vimrc は Obsidian の起動時に一度だけ読み込まれます。変更したら Obsidian を再起動してください。

## vim モードでの折りたたみ行の挙動修正

vim モードが有効なときは、設定なしで次の 2 つの修正が常に働きます。

- **折りたたみ行の右端でカーソルが動かなくなる問題を修正します。** マウスクリックなどで、ノーマルモードのカーソルが折りたたみ範囲の終端に置かれることがあります。終端は隠れた最終行の末尾ですが、画面上は折りたたみ行の右端に表示されます。この位置では `h` / `l` / `k` が効きません。本プラグインは、カーソルを折りたたみ行の最後の文字へ移します。
- **折りたたみ行で `o` を押したとき、新しい行を折りたたみの最終行の次に開きます**（vim と同じ挙動）。折りたたみは閉じたまま残ります。標準の動作では、新しい行が見出し行の直後、つまり折りたたみの中に入ります。`O` は標準どおり、見出しの上に行を開きます。

## ビルド

```sh
npm install
npm run build   # main.js を生成
npm test
```

`main.js` と `manifest.json` を Vault の `.obsidian/plugins/enclosing-fold/` に置いて有効にしてください。
