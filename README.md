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

## 音声モード

- **端末の読み上げ**: ブラウザ・OS標準音声を利用する無料モード。品質は端末により異なる。
- **Gemini TTS**: `gemini-3.1-flash-tts-preview` から受信した音声チャンクを順次再生する。読み上げる本文は利用者のブラウザからGoogleへ直接送信され、同じ返信の再生には端末内キャッシュを使う。
- **読み上げ&マイクオート**: 返信を読み上げた後、英語マイクを自動で起動する補助モード。話し終えたら英マイクを押して送信する。

`public/voice-previews/` には、BYOKey Labが一回だけGemini TTSで生成した各音声の短い例文を同梱します。設定画面での声の試聴は静的ファイルの再生であり、利用者のAPIキーやGemini APIを使用しません。

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
