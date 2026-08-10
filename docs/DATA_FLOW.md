# BYOKey Speak PWA データフロー

確認日: 2026-08-11

| データ | ブラウザ保存 | 外部送信先 | BYOKey Labのアプリサーバー | バックアップ |
| --- | --- | --- | --- | --- |
| Gemini APIキー | 暗号化IndexedDBまたはsession memory | Google Gemini API | 送信しない | 含めない |
| 会話本文 | IndexedDB | Google Gemini API | 送信しない | 含める |
| Coach Skills | IndexedDB | Google Gemini API | 送信しない | 含める |
| CEFR | IndexedDB | Google Gemini API | 送信しない | 含める |
| Vocabulary・学習メモ | IndexedDB | 通常は送信しない | 送信しない | 含める |
| 会話分析対象 | IndexedDB | 利用者操作時にGoogle Gemini API | 送信しない | 結果を含める |
| Daily News | IndexedDB cache | 公開JSONをGET | 利用者データを送らない | 含めない |
| 音声 | 原則保存しない | ブラウザの音声認識サービスの場合がある | 送信しない | 含めない |

APIキー、会話本文、Coach Skills、学習履歴は、BYOKey Labが運営するアプリケーションサーバーやデータベースへ送信されません。
AI処理に必要なデータは、利用者のブラウザからGoogle Gemini APIへ直接送信されます。
静的ファイルを配信するホスティング事業者は、一般的なWeb配信に伴うアクセス情報を処理する場合があります。
