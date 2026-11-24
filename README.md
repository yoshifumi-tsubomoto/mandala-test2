# マンダラ発想法（配布用テンプレート）

3×3 のマスを入れ子にして、考えを広く・深く掘り下げるマンダラ発想法のウェブアプリです。ブラウザだけで動き、Chromebook でも使えます。クラスや班で、同じマンダラに同時に書けます。

- 紹介ページ：https://yoshifumi-tsubomoto.github.io/apps/mandala/
- 体験モード（ログインなし・ブラウザの中だけ）は、紹介ページの「体験モードで開く」から試せます

## 学校で共同編集を使うには

学校ごとに、自分たち専用の共同編集の場（Supabase・Vercel・学校の Google Apps Script）を用意します。
**[導入手順.md](導入手順.md) を生成 AI に貼ると、1ステップずつ案内してくれます。**

## 中身

| フォルダ・ファイル | 中身 |
|---|---|
| `app/` | ブラウザで動くアプリ本体（React + Vite）。Vercel の Root Directory はここ |
| `supabase/setup.sql` | データベースを用意する SQL（最初の1回だけ実行） |
| `supabase/migrations/` | 同じ SQL を番号ごとに分けたもの（新しい版に上げるときは、増えた番号だけを実行） |
| `supabase/functions/school-login/` | 学校のアカウントで入るときの係（Supabase の Edge Function） |
| `gas/school-ticket/` | 学校の Google Apps Script「マンダラ通行証」（Supabase が止まらないしくみと、学校のアカウントでの本人確認） |
| `導入手順.md` | 導入の手順（生成 AI に貼って使う） |

## 気をつけること

- キー（Supabase の secret キー・データベースのパスワード・TICKET_SECRET・ID_SALT）は、このリポジトリに書かないでください。アプリに入れるのは、公開用の publishable キーだけです
- 生徒が書いたマンダラの内容や、生徒の名前・メールアドレスを、このリポジトリに入れないでください
- 「マンダラート」は登録商標です。アプリの名前や画面には使っていません

## 自分のパソコンで動かす（必要なときだけ）

```
cd app
npm install
npm run dev
```

接続先がないとき、または URL に `?demo=1` を付けたときは、体験モードで動きます。

## ライセンス

Apache License 2.0（[LICENSE](LICENSE)）。再利用するときは、著者名（坪本 吉史）と、どの版をもとにしたかを書いてください。
