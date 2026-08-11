# Android closed-test ver.7 差分確認メモ

確認日: 2026-08-11  
参照元: `D:\ドキュメント\Codex\byokey-speak-android` versionCode 7 / versionName 0.1.6

## PWAへ採用した差分

| Android ver.7の仕様 | PWAでの対応 |
| --- | --- |
| 会話入力は英語音声、Quick Assistは日本語音声として起動する | 会話画面に `EN Mic` / `JA Mic` を追加し、Quick Assistには日本語音声入力を追加 |
| Full Autoでは音声認識後に送信し、返信を読み上げる | `Full Auto` では音声認識結果を即送信し、返信後に自動読み上げ |
| 手動送信モードでもコーチ返信到着後に読み上げる | `Voice mode` が `off` 以外なら返信を自動読み上げ |
| 入力元を `TYPED` / `VOICE` / `QUICK_ASSIST` / `MIXED` として記録する | 下書き操作に応じて入力元を記録し、Quick Assist + 手入力/音声は `MIXED` として保存 |
| Quick Assistで採用した表現を単語帳へ保存し、通常Vocabularyと分ける | Reviewに `Vocabulary` / `Quick Assist` の切替を追加 |
| Vocabularyは同一表現を統合し、能動使用回数で確認できる | 表現を正規化して重複統合し、ユーザー発話内の使用回数を表示・頻度ソート |

## PWAでは同等採用しない差分

| Android ver.7の仕様 | PWAでの判断 |
| --- | --- |
| TTS完了後に自動で次の音声認識を起動する | ブラウザではユーザー操作なしのマイク再起動が制限されるため、1タップ再開の案内に縮退 |
| AI報告専用Worker/D1へアプリ内送信する | PWA版は「開発側サーバーへ学習データを送らない」方針のため、自動送信せず、報告用メモのコピーと外部フォーム導線を維持 |
| AndroidのOS通知、毎朝6:30配信 | PWAのバックグラウンド定刻通知は同等保証できないため未採用 |

## 検証

- `pnpm.cmd typecheck`
- `pnpm.cmd lint`
- `pnpm.cmd test`
- `pnpm.cmd build`
- `pnpm.cmd e2e`
