# BYOKey Speak PWA SEO / Analytics setup

更新日: 2026-08-14

## 1. 今回コード側で用意したもの

- `index.html` に title / description / canonical / OGP / Twitter card を追加。
- JavaScriptが無効でも概要が読めるSEO fallback textを `#root` 内に追加。
- `public/robots.txt` を追加。
- `public/sitemap.xml` を追加。
- `manifest.webmanifest` の説明文を検索・インストール画面向けに拡張。
- Cloudflare Web Analytics が動くようにCSPで `static.cloudflareinsights.com` と `cloudflareinsights.com` を許可。
- GA4等を後から入れた場合に、PWAインストール関連イベントを送れるように `trackAnalyticsEvent()` を追加。

## 2. Google Search Console 登録

目的: Google検索にサイトを認識してもらい、検索パフォーマンスやインデックス状況を確認する。

推奨プロパティ:

- 可能なら `byokey-lab.com` のドメインプロパティ
- すぐ始めるなら `https://speak.byokey-lab.com/` のURLプレフィックス

手順:

1. [Google Search Console](https://search.google.com/search-console) を開く。
2. プロパティを追加する。
3. ドメインプロパティの場合は、表示されたDNS TXTレコードをCloudflare DNSに追加して所有権確認する。
4. URLプレフィックスの場合は、Search Consoleの案内に従って所有権確認する。
5. `サイトマップ` に以下を登録する。

```text
https://speak.byokey-lab.com/sitemap.xml
```

6. `URL検査` で以下を入力し、公開URLをテストしてから `インデックス登録をリクエスト` する。

```text
https://speak.byokey-lab.com/
```

公式情報では、単一URLはURL検査から再クロールを依頼でき、複数URLや監視にはSitemapsレポートを使う、と説明されている。

## 3. PV数を見る方法

### 推奨: Cloudflare Web Analytics

理由:

- Cloudflare Pagesと相性が良い。
- PV、訪問者、Core Web Vitalsなどを見る用途に向いている。
- BYOKey Speakの思想上、Google Analyticsより先に検討しやすい。

手順:

1. Cloudflare dashboard を開く。
2. `Workers & Pages` に移動。
3. `byokey-speak-pwa` プロジェクトを開く。
4. `Metrics` を開く。
5. `Web Analytics` の `Enable` を押す。
6. 次回デプロイ後、Cloudflareが自動でJavaScript snippetを挿入する。

注意:

- 今回、CSP側ではCloudflare Web Analyticsの実行に必要なドメインを許可済み。
- Cloudflare公式ドキュメントでは、Pagesプロジェクトは `Workers & Pages` → 対象プロジェクト → `Metrics` → `Enable` でWeb Analyticsを有効化できる、とされている。

## 4. インストール数を見る方法

PWAのインストールは、通常のPV計測だけでは十分に見えない。

今回のPWAでは、GA4等の `gtag` が存在する場合だけ、以下のイベントを送るようにした。

| イベント名 | 意味 |
| --- | --- |
| `pwa_install_prompt_available` | ブラウザがPWAインストール可能と判断した |
| `pwa_install_prompt_choice` | アプリ内インストールボタンを押した後、ユーザーが `accepted` または `dismissed` を選んだ |
| `pwa_installed` | ブラウザがインストール完了を通知した |

現時点ではGA4タグを入れていないため、外部送信は発生しない。

GA4でインストール数まで見る場合:

1. [Google Analytics](https://analytics.google.com/) を開く。
2. GA4プロパティを作成する。
3. Webデータストリームに `https://speak.byokey-lab.com/` を登録する。
4. Measurement ID（`G-` で始まるID）を取得する。
5. BYOKey Speakのプライバシーポリシーに、Google AnalyticsへPVや操作イベントが送信される旨を追記する。
6. CSPにGoogle Analytics用ドメインを追加する。
7. `index.html` にGoogle tagを追加する。
8. GA4のRealtimeまたはDebugViewで、上記イベントが届くか確認する。

注意:

- MDNでは `beforeinstallprompt` は非標準でChromium系ブラウザ中心の機能と説明されている。
- そのため、`pwa_install_prompt_choice` はAndroid Chrome等では取りやすいが、すべてのブラウザで完全に取れるとは限らない。
- `appinstalled` もブラウザ実装に依存するため、インストール数は「推定値」として扱う。

## 5. BYOKey Speakとしてのおすすめ

まずは以下の順番が安全。

1. Search Consoleに登録する。
2. Cloudflare Web Analyticsを有効化してPV・表示速度を見る。
3. インストール数が必要になった段階でGA4を追加する。

GA4を入れる場合は、利用者への説明が変わる。

現在のBYOKey Speakは、APIキーや会話データをBYOKey Labのサーバーへ送らない設計である。一方、GA4を追加すると、PVやイベント情報はGoogle Analyticsへ送信される。そのため、プライバシーポリシーとアプリ内Aboutには、計測のために外部サービスへ送信される情報を明記する必要がある。

## 6. 参照元

- [Google Search Central: Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google Search Console Help: Getting started with Search Console](https://support.google.com/webmasters/answer/10267942)
- [Google Analytics Help: Set up Analytics for a website and/or app](https://support.google.com/analytics/answer/14183469)
- [Google Analytics Help: Measurement ID](https://support.google.com/analytics/answer/12270356?hl=ja-JP)
- [Cloudflare Web Analytics docs: Get started](https://developers.cloudflare.com/web-analytics/get-started/)
- [MDN: BeforeInstallPromptEvent.userChoice](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent/userChoice)
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
