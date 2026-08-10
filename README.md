# BYOKey Speak PWA

BYOKey Speak PWAは、Gemini専用の登録不要BYOK型英会話PWAです。
ユーザー自身のGemini APIキーを、ユーザーのブラウザからGoogle Gemini APIへ直接送信します。

BYOKey Labは、APIキーを受信、保存、閲覧するためのアプリケーションサーバーやデータベースを持ちません。
APIキー、会話、Vocabulary、進捗、分析結果はブラウザ内に保存されます。

## 重要な注意

クライアント側でAPIキーを扱う構成は、Google公式の一般的なセキュリティ推奨とは異なります。
このPWAは、利用者がリスクを理解し、専用キー、利用制限、請求アラート、利用量確認、キーのローテーションを行う前提で提供します。

ソースコードはGitHubで公開し、データの保存先、通信先、APIキーの取扱いを第三者が確認できるようにします。
ただし、オープンソースであること自体がAPIキーを保護するものではありません。

## 外部通信

- `https://generativelanguage.googleapis.com`: Gemini API呼び出し。
- `https://byokey-lab.com/news/daily.json`: Daily News公開JSONの取得。
- `https://raw.githubusercontent.com/shunya-0310/byokey-lab-site/main/public/news/daily.json`: Daily Newsの代替取得。

独自API、Supabase、Cloudflare Functions、解析SDK、広告SDKは使いません。

## 開発

```powershell
pnpm install
pnpm build
pnpm test
```

## 公開

Cloudflare Pagesでは静的ファイルだけを配信します。

- Build command: `pnpm build`
- Output directory: `dist`
- Functions、D1、KV、R2、Web Analyticsは追加しません。
