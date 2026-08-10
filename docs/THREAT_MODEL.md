# BYOKey Speak PWA 脅威モデル

確認日: 2026-08-11

## 最も重要なリスク

公開PWAの同一オリジンへ悪意あるJavaScriptが混入すると、ブラウザ内のAPIキーが利用される可能性があります。
Web Cryptoで暗号化しても、実行中の正当なアプリコードはキーを復号してGeminiへ送信できるため、抽出可能性をゼロにはできません。

## 対策

- 外部スクリプトを実行しない。
- CSPで`script-src 'self'`、`connect-src`をGeminiと公開JSONに限定する。
- lockfileを固定し、依存を監査する。
- GitHub公開コードとAboutのcommit SHAを対応させる。
- APIキーをURL、ログ、Service Worker cache、バックアップ、共有本文へ含めない。
- 永続保存とsession-onlyを選べるようにする。
- 専用Geminiキー、利用制限、請求アラート、利用量確認、ローテーションを案内する。

## 残余リスク

- GoogleがCORS、認証、APIキー方針を変更すると通信できなくなる。
- ブラウザまたは利用者操作でIndexedDBが削除される。
- iOSやFirefoxでは音声入力、通知、PWA更新の挙動に差がある。
- 静的ホストは通常のアクセスログを処理しうる。
