# Release Checklist

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm e2e`
- [ ] 本番オリジンからGemini APIの接続テスト
- [ ] DevTools Networkで許可通信先のみ確認
- [ ] Aboutのcommit SHAとGitHub公開コードの対応確認
- [ ] `_headers`のCSP反映確認
- [ ] Chrome Androidでインストール確認
- [ ] iOS Safariでホーム画面追加とデータ維持確認
- [ ] バックアップにAPIキーが含まれないことを確認
- [ ] Google、MDN、Cloudflareの一次情報を公開直前に再確認
