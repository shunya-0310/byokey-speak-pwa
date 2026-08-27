# BYOKey Speak PWA（体験版）

BYOKey Speak PWAは、Gemini専用の登録不要BYOK型英会話PWAです。
ユーザー自身のGemini APIキーを、ユーザーのブラウザからGoogle Gemini APIへ直接送信します。

BYOKey Labは、APIキーを受信、保存、閲覧するためのアプリケーションサーバーやデータベースを持ちません。
APIキー、会話、Vocabulary、進捗、過去の分析結果はブラウザ内に保存されます。

## 体験版の範囲

PWA版は無料の体験版です。Geminiテキスト会話、Quick Assist、端末の音声入力・読み上げ、Vocabulary List、学習記録、コーチ設定、バックアップを利用できます。

- Daily Newsの配信・通知は利用できません。
- 新しい会話分析は利用できません。保存済みの分析結果は削除しません。
- CEFRはA1・A2のみ選べます。保存済みのB1〜C2設定はA2へ安全に切り替えます。
- Gemini TTSは利用できません。保存済みの設定は端末の読み上げへ切り替えます。

Daily News、会話分析、CEFR B1〜C2、Gemini TTSはAndroid製品版で利用できます: https://play.google.com/store/apps/details?id=com.byokeylab.speak

## 重要な注意

クライアント側でAPIキーを扱う構成は、Google公式の一般的なセキュリティ推奨とは異なります。
このPWAは、利用者がリスクを理解し、専用キー、利用制限、請求アラート、利用量確認、キーのローテーションを行う前提で提供します。

ソースコードはGitHubで公開し、データの保存先、通信先、APIキーの取扱いを第三者が確認できるようにします。
ただし、オープンソースであること自体がAPIキーを保護するものではありません。

## 外部通信

- `https://generativelanguage.googleapis.com`: Gemini API呼び出し。

独自API、Supabase、Cloudflare Functions、解析SDK、広告SDKは使いません。

## 音声モード

- **端末の読み上げ**: ブラウザ・OS標準音声を利用する無料モード。品質は端末により異なる。
- **読み上げ&マイクオート**: 返信を読み上げた後、英語マイクを自動で起動する補助モード。話し終えたら英マイクを押して送信する。

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
