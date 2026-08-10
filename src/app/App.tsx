import {
  BarChart3,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  FileText,
  Github,
  KeyRound,
  Loader2,
  MessageCircle,
  Mic,
  Moon,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Undo2,
  Upload,
  Volume2
} from "lucide-react";
import { useEffect, useState } from "react";
import { BUILD_INFO, LINKS } from "./links";
import {
  DEFAULT_COACH_SKILLS,
  GEMINI_MODELS,
  type AppSettings,
  type Chat,
  type ChatMessage,
  type ConversationAnalysis,
  type DailyStat,
  type LearningNote,
  type VocabCard
} from "../domain/models";
import { buildAnalysisPrompt, buildConversationPrompt, buildQuickAssistPrompt, buildTranslationPrompt, parseAssistSuggestions } from "../domain/prompts";
import { deriveChatTitle, localProgress } from "../domain/stats";
import { createChat, db, ensureFirstChat, exportSnapshot, id, loadSettings, recordDailyStat, restoreSnapshot, saveSettings } from "../infrastructure/db";
import { clearPersistentApiKey, clearSessionApiKey, decryptBackupJson, encryptBackupJson, getActiveApiKey, savePersistentApiKey, saveSessionApiKey } from "../infrastructure/crypto";
import { generateWithGemini, parseAnalysis, parseCoachReply, userMessageForError, type LlmError } from "../infrastructure/gemini";
import { loadDailyNews, newsHiddenContext, newsVisibleOpener } from "../infrastructure/news";
import { isPreviewOrigin, isTrustedPersistentOrigin, persistentStorageStatus, requestPersistentStorage } from "../infrastructure/pwa";
import { canRecognizeSpeech, listenOnce, speakCoachText, stopSpeaking } from "../infrastructure/speech";
import type { DailyNewsFeed, DailyNewsItem } from "../domain/schemas";

type Tab = "chats" | "review" | "progress" | "settings";

interface AppData {
  settings: AppSettings;
  chats: Chat[];
  messages: ChatMessage[];
  vocab: VocabCard[];
  notes: LearningNote[];
  stats: DailyStat[];
  analyses: ConversationAnalysis[];
}

const TOPICS = [
  "A small habit that changed your daily life",
  "A movie or game you would recommend",
  "Something you want to learn this year",
  "A place in Japan you would explain to a visitor",
  "A news story you want to understand better"
];

const ONBOARDING = [
  {
    title: "BYOKey Speak",
    body: "Geminiと英語、日本語、混在文で会話できます。BYOKey Speak自体に月額利用料はありません。Gemini APIの利用料は、利用者自身のGoogleアカウントへ利用量に応じて請求されます。",
    image: "/images/onboarding/onboarding_bg_1.jpg"
  },
  {
    title: "BYOKの流れ",
    body: "Google AI Studioで専用APIキーを作り、このPWAに入力します。会話はあなたのブラウザからGemini APIへ直接送信され、BYOKey Labのアプリケーションサーバーを経由しません。",
    image: "/images/onboarding/onboarding_bg_2.jpg"
  },
  {
    title: "APIキーの重要な注意",
    body: "APIキーはGemini API利用権限に紐づく重要な情報です。Googleは本番のブラウザやモバイルアプリなど、クライアント側にAPIキーを露出する構成を一般には推奨していません。本PWAはBYOK方式として、利用者自身がこのリスクを理解し、自分のキーを自分の責任で入力する設計です。専用キー、利用制限、請求アラート、利用量確認、定期的なローテーションを行ってください。この説明は2026年8月11日時点の情報です。",
    image: "/images/onboarding/onboarding_bg_3.jpg"
  },
  {
    title: "保存とデータフロー",
    body: "APIキー、会話、Vocabulary List、進捗はこのブラウザ内へ保存します。BYOKey Labは通常利用時のAPIキー、会話、学習データを収集しません。静的ホスティング事業者は一般的なWebアクセス情報を処理しうるため、暗号化バックアップも定期的に作ってください。",
    image: "/images/onboarding/onboarding_bg_4.jpg"
  },
  {
    title: "開始前の同意",
    body: "SettingsでGeminiモデル、APIキー、CEFR、Coach Skillsを設定できます。リスクと外部送信を理解した場合だけGemini送信が有効になります。後で設定することもできます。",
    image: "/images/onboarding/onboarding_bg_5.jpg"
  }
];

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>((new URLSearchParams(location.search).get("tab") as Tab) || "chats");
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [news, setNews] = useState<{ feed?: DailyNewsFeed; notice?: string }>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [assist, setAssist] = useState<{ open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> }>({ open: false, stuck: "", suggestions: [] });
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  async function reload() {
    const [settings, chats, messages, vocab, notes, stats, analyses] = await Promise.all([
      loadSettings(),
      db.chats.orderBy("updatedAt").reverse().toArray(),
      db.messages.orderBy("createdAt").toArray(),
      db.vocabCards.orderBy("createdAt").reverse().toArray(),
      db.learningNotes.orderBy("createdAt").reverse().toArray(),
      db.dailyStats.toArray(),
      db.analyses.orderBy("createdAt").reverse().toArray()
    ]);
    setData({ settings, chats, messages, vocab, notes, stats, analyses });
    document.documentElement.dataset.theme = settings.theme;
    setShowOnboarding(!settings.onboardingDone);
    if (!activeChatId) {
      const selected = settings.lastOpenedChatId && chats.some((chat) => chat.id === settings.lastOpenedChatId)
        ? settings.lastOpenedChatId
        : chats[0]?.id ?? await ensureFirstChat();
      setActiveChatId(selected);
    }
  }

  useEffect(() => {
    void reload();
    void loadDailyNews().then(({ feed, notice }) => setNews({ feed, notice })).catch(() => setNews({ notice: "Daily Newsを読み込めませんでした。" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.theme = data.settings.theme;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.theme]);

  if (!data) {
    return <div className="app"><main className="main"><div className="panel row"><Loader2 className="spin" /> Loading BYOKey Speak...</div></main></div>;
  }

  const currentData = data;
  const activeChat = currentData.chats.find((chat) => chat.id === activeChatId);
  const chatMessages = currentData.messages.filter((message) => message.chatId === activeChatId);
  const progress = localProgress(currentData.stats, currentData.messages, currentData.vocab);
  const canSendToGemini = currentData.settings.consentVersion >= 1 && currentData.settings.hasApiKey;

  async function updateSettings(patch: Partial<AppSettings>) {
    const next = { ...currentData.settings, ...patch };
    await saveSettings(next);
    await reload();
  }

  async function selectChat(chatId: string) {
    setActiveChatId(chatId);
    await updateSettings({ lastOpenedChatId: chatId });
  }

  async function newChat(title = "New chat", origin: Chat["origin"] = "FREE_CHAT", newsContext?: string, opener?: string) {
    const chat = createChat(title, origin, newsContext);
    await db.chats.put(chat);
    if (opener) {
      await db.messages.put({ id: id("msg"), chatId: chat.id, role: "coach", text: opener, inputSource: "NONE", usedQuickAssist: false, createdAt: Date.now() });
    }
    setDraft("");
    await selectChat(chat.id);
    await reload();
  }

  async function sendMessage(source: ChatMessage["inputSource"] = "TYPED", text = draft) {
    const trimmed = text.trim();
    if (!trimmed || !activeChat) return;
    setError("");
    if (!canSendToGemini) {
      setActiveTab("settings");
      setError("Gemini送信には、同意とAPIキー設定が必要です。");
      return;
    }
    const apiKey = await getActiveApiKey(currentData.settings.apiKeyMode);
    if (!apiKey) {
      setActiveTab("settings");
      setError("APIキーを再入力してください。");
      return;
    }
    const now = Date.now();
    const userMessage: ChatMessage = {
      id: id("msg"),
      chatId: activeChat.id,
      role: "user",
      text: trimmed,
      inputSource: source,
      usedQuickAssist: source === "QUICK_ASSIST" || source === "MIXED",
      createdAt: now
    };
    setDraft("");
    setBusy("Geminiが返答中です");
    await db.messages.put(userMessage);
    if (activeChat.title === "New chat") await db.chats.update(activeChat.id, { title: deriveChatTitle(trimmed) });
    await db.chats.update(activeChat.id, { updatedAt: now });
    await recordDailyStat({ turns: 1 });
    await reload();
    try {
      const prompt = buildConversationPrompt({
        messages: [...chatMessages, userMessage],
        latestUserMessage: trimmed,
        level: currentData.settings.englishLevel,
        coachSkills: currentData.settings.coachSkills,
        webSearchEnabled: webSearch,
        newsContext: activeChat.newsContext
      });
      const result = await generateWithGemini({ apiKey, model: currentData.settings.model, prompt, webSearchEnabled: webSearch });
      const reply = parseCoachReply(result.text, result.sources);
      const coachText = [
        `Natural reply: ${reply.reply}`,
        reply.coachNote ? `Coach notes: ${reply.coachNote}` : "",
        reply.japaneseExplanation ? `Japanese explanation: ${reply.japaneseExplanation}` : "",
        reply.betterOptions.length ? `Better options:\n${reply.betterOptions.join("\n")}` : ""
      ].filter(Boolean).join("\n\n");
      await db.messages.put({ id: id("msg"), chatId: activeChat.id, role: "coach", text: coachText, inputSource: "NONE", usedQuickAssist: false, sources: result.sources, createdAt: Date.now() });
      for (const item of reply.vocabulary) {
        await db.vocabCards.put({ id: id("vocab"), expression: item.expression, meaning: item.meaning, source: "Coach", chatId: activeChat.id, favorite: false, usageCount: 0, reviewed: false, createdAt: Date.now() });
      }
      if (reply.coachNote || reply.betterOptions.length) {
        await db.learningNotes.put({ id: id("note"), chatId: activeChat.id, sourceMessage: trimmed, coachNotes: reply.coachNote ?? "", betterOptions: reply.betterOptions.join("\n"), japaneseNote: reply.japaneseExplanation ?? "", reviewed: false, createdAt: Date.now() });
      }
      await reload();
    } catch (caught) {
      const llmError = caught as LlmError;
      setError(llmError.message || userMessageForError("unknown"));
    } finally {
      setBusy("");
    }
  }

  async function runAssist() {
    if (!assist.stuck.trim() || !activeChat) return;
    if (!canSendToGemini) {
      setActiveTab("settings");
      setError("Quick Assistには、同意とAPIキー設定が必要です。");
      return;
    }
    setBusy("Quick Assistを生成中です");
    try {
      const apiKey = await getActiveApiKey(currentData.settings.apiKeyMode);
      const prompt = buildQuickAssistPrompt({ messages: chatMessages, currentDraft: draft, stuckText: assist.stuck, level: currentData.settings.englishLevel, coachSkills: currentData.settings.coachSkills });
      const result = await generateWithGemini({ apiKey, model: currentData.settings.model, prompt });
      setAssist((current) => ({ ...current, suggestions: parseAssistSuggestions(result.text) }));
      await recordDailyStat({ assistUses: 1 });
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function undoLastTurn() {
    const lastUser = [...chatMessages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    const after = chatMessages.filter((message) => message.createdAt >= lastUser.createdAt);
    await db.messages.bulkDelete(after.map((message) => message.id));
    setDraft(lastUser.text);
    await reload();
  }

  async function translateMessage(message: ChatMessage) {
    const apiKey = await getActiveApiKey(currentData.settings.apiKeyMode);
    if (!apiKey) return setError("APIキーを再入力してください。");
    setBusy("翻訳中です");
    try {
      const result = await generateWithGemini({ apiKey, model: currentData.settings.model, prompt: buildTranslationPrompt(message.text) });
      await db.messages.put({ id: id("msg"), chatId: message.chatId, role: "system", text: `日本語訳:\n${result.text}`, inputSource: "NONE", usedQuickAssist: false, createdAt: Date.now() });
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function exportBackup() {
    setError("");
    if (backupPassphrase.length < 8) return setError("バックアップ用パスフレーズは8文字以上で入力してください。");
    const snapshot = await exportSnapshot();
    const encrypted = await encryptBackupJson(JSON.stringify(snapshot), backupPassphrase);
    const blob = new Blob([encrypted], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `byokey-speak-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("APIキーを含まない暗号化バックアップを書き出しました。");
  }

  async function restoreBackup(file?: File) {
    if (!file) return;
    if (backupPassphrase.length < 8) return setError("復元用パスフレーズは8文字以上で入力してください。");
    try {
      const plain = await decryptBackupJson(await file.text(), backupPassphrase);
      await restoreSnapshot(JSON.parse(plain));
      await reload();
      setNotice("バックアップを復元しました。APIキーは復元対象外です。");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <div className="app">
      {showOnboarding && <Onboarding settings={data.settings} onDone={async (consented) => {
        await updateSettings({ onboardingDone: true, consentVersion: consented ? 1 : 0, consentAt: consented ? new Date().toISOString() : undefined });
        setShowOnboarding(false);
      }} />}
      <header className="topbar">
        <div className="brand">
          <img src="/images/splash_logo.webp" alt="" />
          <div>
            <h1>BYOKey Speak</h1>
            <p>Gemini-only local-first PWA</p>
          </div>
        </div>
        <button className="icon-button" title="テーマ切替" onClick={() => updateSettings({ theme: data.settings.theme === "dark" ? "light" : "dark" })}>
          {data.settings.theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </header>
      {isPreviewOrigin() && <div className="preview-banner small">プレビュー環境です。個人の本番APIキーを入力しないでください。</div>}
      <main className="main">
        {(notice || news.notice) && <p className="panel small">{notice || news.notice}</p>}
        {error && <p className="panel small danger">{error}</p>}
        {busy && <p className="panel small row"><Loader2 size={16} /> {busy}</p>}
        {activeTab === "chats" && <ChatsTab
          chats={data.chats}
          activeChat={activeChat}
          messages={chatMessages}
          news={news.feed}
          settings={data.settings}
          draft={draft}
          setDraft={setDraft}
          webSearch={webSearch}
          setWebSearch={setWebSearch}
          onNewChat={() => newChat()}
          onTopic={(topic) => newChat(topic, "TOPIC", undefined, `Natural reply: Let's talk about this: ${topic}\n\nWhat do you think first?`)}
          onNews={(item) => newChat(item.headline, "DAILY_NEWS", newsHiddenContext(item), newsVisibleOpener(item, data.settings.coachSkills))}
          onSelectChat={selectChat}
          onRename={async (chat) => {
            const title = prompt("チャット名", chat.title)?.trim();
            if (title) {
              await db.chats.update(chat.id, { title, updatedAt: Date.now() });
              await reload();
            }
          }}
          onPin={async (chat) => {
            await db.chats.update(chat.id, { pinned: !chat.pinned });
            await reload();
          }}
          onDelete={async (chat) => {
            if (!confirm("このチャットを削除しますか。")) return;
            await db.chats.delete(chat.id);
            await db.messages.where("chatId").equals(chat.id).delete();
            setActiveChatId("");
            await reload();
          }}
          onSend={() => sendMessage()}
          onUndo={undoLastTurn}
          onAssist={() => setAssist({ open: true, stuck: "", suggestions: [] })}
          onTranslate={translateMessage}
          onSpeak={(message) => speakCoachText(message.text, data.settings.voiceGender)}
          onMic={async () => {
            try {
              const spoken = await listenOnce("en-US");
              setDraft((current) => `${current}${current ? " " : ""}${spoken}`);
            } catch (caught) {
              setError((caught as Error).message);
            }
          }}
        />}
        {activeTab === "review" && <ReviewTab vocab={data.vocab} notes={data.notes} onReload={reload} />}
        {activeTab === "progress" && <ProgressTab progress={progress} analyses={data.analyses} canAnalyze={canSendToGemini} onAnalyze={async () => {
          const userMessages = data.messages.filter((message) => message.role === "user");
          if (userMessages.length < 20) {
            setError(`会話分析にはあと${20 - userMessages.length}発話必要です。`);
            return;
          }
          const apiKey = await getActiveApiKey(data.settings.apiKeyMode);
          if (!apiKey) return setError("APIキーを再入力してください。");
          const contexts = userMessages.slice(-100).map((message) => {
            const coach = data.messages.find((candidate) => candidate.chatId === message.chatId && candidate.role === "coach" && candidate.createdAt > message.createdAt);
            return { userText: message.text, coachText: coach?.text.slice(0, 600), inputSource: message.inputSource, usedQuickAssist: message.usedQuickAssist };
          });
          setBusy("会話分析中です");
          try {
            const result = await generateWithGemini({ apiKey, model: data.settings.model, prompt: buildAnalysisPrompt({ contexts, level: data.settings.englishLevel, coachSkills: data.settings.coachSkills }) });
            await db.analyses.put({ id: id("analysis"), createdAt: Date.now(), periodStart: userMessages[0].createdAt, periodEnd: Date.now(), userMessageCount: contexts.length, provider: "Gemini", model: data.settings.model, result: parseAnalysis(result.text) });
            await reload();
          } catch (caught) {
            setError((caught as Error).message);
          } finally {
            setBusy("");
          }
        }} onPractice={(promptText) => newChat(promptText, "TOPIC", undefined, `Natural reply: Great. Let's practice this theme: ${promptText}`)} />}
        {activeTab === "settings" && <SettingsTab
          settings={data.settings}
          apiKeyDraft={apiKeyDraft}
          setApiKeyDraft={setApiKeyDraft}
          backupPassphrase={backupPassphrase}
          setBackupPassphrase={setBackupPassphrase}
          onSettings={updateSettings}
          onSaveApiKey={async () => {
            if (!apiKeyDraft.trim()) return setError("APIキーを入力してください。");
            const mode = data.settings.apiKeyMode;
            if (mode === "persistent") {
              if (!isTrustedPersistentOrigin()) return setError("このオリジンでは永続APIキー保存を既定で無効にしています。session-onlyを選んでください。");
              await savePersistentApiKey(apiKeyDraft.trim());
            } else {
              saveSessionApiKey(apiKeyDraft.trim());
            }
            await updateSettings({ hasApiKey: true });
            setApiKeyDraft("");
            setNotice(mode === "persistent" ? "APIキーをこのブラウザ内に暗号化保存しました。" : "APIキーをこのセッションだけ保存しました。");
          }}
          onClearApiKey={async () => {
            await clearPersistentApiKey();
            clearSessionApiKey();
            await updateSettings({ hasApiKey: false });
          }}
          onTestConnection={async () => {
            const apiKey = apiKeyDraft.trim() || await getActiveApiKey(data.settings.apiKeyMode);
            if (!apiKey) return setError("接続テストにはAPIキーが必要です。");
            setBusy("接続テスト中です");
            try {
              await generateWithGemini({ apiKey, model: data.settings.model, prompt: "Reply with exactly: OK" });
              setNotice("Geminiへの接続に成功しました。");
            } catch (caught) {
              setError((caught as Error).message);
            } finally {
              setBusy("");
            }
          }}
          onRequestPersist={async () => {
            const granted = await requestPersistentStorage();
            await updateSettings({ persistentStorageGranted: granted });
            setNotice(granted ? "ブラウザの永続ストレージが許可されました。" : "永続ストレージは許可されませんでした。バックアップを併用してください。");
          }}
          onCheckPersist={async () => {
            const granted = await persistentStorageStatus();
            setNotice(granted ? "現在、永続ストレージとして扱われています。" : "永続ストレージではありません。");
          }}
          onExport={exportBackup}
          onRestore={restoreBackup}
          onReplayOnboarding={() => setShowOnboarding(true)}
          onResetCoachSkills={() => updateSettings({ coachSkills: DEFAULT_COACH_SKILLS })}
          onClearLearning={async () => {
            if (!confirm("会話、Vocabulary、進捗、分析を削除しますか。APIキーは残ります。")) return;
            await Promise.all([db.chats.clear(), db.messages.clear(), db.vocabCards.clear(), db.learningNotes.clear(), db.dailyStats.clear(), db.analyses.clear()]);
            await reload();
          }}
        />}
      </main>
      <nav className="tabbar" aria-label="Main">
        <TabButton tab="chats" active={activeTab} setActive={setActiveTab} icon={<MessageCircle size={20} />} label="Chats" />
        <TabButton tab="review" active={activeTab} setActive={setActiveTab} icon={<BookOpen size={20} />} label="Review" />
        <TabButton tab="progress" active={activeTab} setActive={setActiveTab} icon={<BarChart3 size={20} />} label="Progress" />
        <TabButton tab="settings" active={activeTab} setActive={setActiveTab} icon={<Settings size={20} />} label="Settings" />
      </nav>
      {assist.open && <AssistModal
        assist={assist}
        setAssist={setAssist}
        runAssist={runAssist}
        adopt={async (english) => {
          setDraft((current) => `${current}${current ? " " : ""}${english}`);
          await db.vocabCards.put({ id: id("vocab"), expression: english, meaning: assist.suggestions.find((item) => item.english === english)?.note ?? "", source: "QuickAssist", chatId: activeChatId, favorite: false, usageCount: 0, reviewed: false, createdAt: Date.now() });
          setAssist({ open: false, stuck: "", suggestions: [] });
          await reload();
        }}
      />}
    </div>
  );
}

function TabButton(props: { tab: Tab; active: Tab; setActive: (tab: Tab) => void; icon: React.ReactNode; label: string }) {
  return <button aria-current={props.active === props.tab ? "page" : undefined} onClick={() => props.setActive(props.tab)}>{props.icon}<span>{props.label}</span></button>;
}

function Onboarding(props: { settings: AppSettings; onDone: (consented: boolean) => void }) {
  const [page, setPage] = useState(0);
  const [consented, setConsented] = useState(false);
  const current = ONBOARDING[page];
  return <div className="onboarding" style={{ backgroundImage: `url(${current.image})` }}>
    <section className="onboarding-card">
      <p className="muted">Page {page + 1} / 5</p>
      <h1>{current.title}</h1>
      <p>{current.body}</p>
      {page === 2 && <p className="small"><a href={LINKS.googleApiKeyDocs} target="_blank" rel="noreferrer">Google公式のAPIキー資料 <ExternalLink size={14} /></a></p>}
      {page === 4 && <label className="row"><input style={{ width: "auto" }} type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /> リスクと外部送信を理解しました</label>}
      <div className="row">
        <button className="ghost" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>戻る</button>
        <button className="ghost" onClick={() => props.onDone(false)}>後で設定する</button>
        {page < 4 ? <button className="primary" onClick={() => setPage((value) => value + 1)}>次へ</button> : <button className="primary" disabled={!consented} onClick={() => props.onDone(true)}>開始</button>}
      </div>
    </section>
  </div>;
}

function ChatsTab(props: {
  chats: Chat[];
  activeChat?: Chat;
  messages: ChatMessage[];
  news?: DailyNewsFeed;
  settings: AppSettings;
  draft: string;
  setDraft: (value: string) => void;
  webSearch: boolean;
  setWebSearch: (value: boolean) => void;
  onNewChat: () => void;
  onTopic: (topic: string) => void;
  onNews: (item: DailyNewsItem) => void;
  onSelectChat: (chatId: string) => void;
  onRename: (chat: Chat) => void;
  onPin: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
  onSend: () => void;
  onUndo: () => void;
  onAssist: () => void;
  onTranslate: (message: ChatMessage) => void;
  onSpeak: (message: ChatMessage) => void;
  onMic: () => void;
}) {
  return <div className="grid two-col">
    <aside className="stack">
      <div className="panel stack">
        <div className="section-title"><h2>Daily News</h2><span className="small muted">公開JSON</span></div>
        <div className="news-scroll">
          {props.news?.items.map((item) => <article className="card stack" key={item.id}>
            <strong>{item.headline}</strong>
            <span className="small muted">{item.summary}</span>
            <button onClick={() => props.onNews(item)}>このニュースで話す</button>
          </article>) ?? <p className="muted">読み込み中です。</p>}
        </div>
      </div>
      <div className="panel stack">
        <div className="section-title"><h2>Chats</h2><button className="icon-button primary" title="New Chat" onClick={props.onNewChat}><Plus size={18} /></button></div>
        <div className="topics">
          {TOPICS.map((topic) => <button key={topic} className="ghost" onClick={() => props.onTopic(topic)}>{topic}</button>)}
        </div>
        {props.chats.map((chat) => <div className="row nowrap" key={chat.id}>
          <button className="chat-list-item" onClick={() => props.onSelectChat(chat.id)}>{chat.pinned ? "★ " : ""}{chat.title}<br /><span className="small muted">{chat.origin}</span></button>
          <button className="icon-button ghost" title="Pin" onClick={() => props.onPin(chat)}><Pin size={16} /></button>
          <button className="icon-button ghost" title="Rename" onClick={() => props.onRename(chat)}><FileText size={16} /></button>
          <button className="icon-button danger ghost" title="Delete" onClick={() => props.onDelete(chat)}><Trash2 size={16} /></button>
        </div>)}
      </div>
    </aside>
    <section className="panel stack">
      <div className="section-title">
        <h2>{props.activeChat?.title ?? "New chat"}</h2>
        <div className="row">
          <label className="row small"><input style={{ width: "auto" }} type="checkbox" checked={props.webSearch} onChange={(event) => props.setWebSearch(event.target.checked)} /> <Search size={15} /> Web検索</label>
          <button className="icon-button ghost" title="Undo" onClick={props.onUndo}><Undo2 size={17} /></button>
          <button className="icon-button ghost" title="Stop TTS" onClick={stopSpeaking}><Volume2 size={17} /></button>
        </div>
      </div>
      <div className="messages" aria-live="polite">
        {props.messages.length === 0 && <p className="message system">New Chatです。英語、日本語、混在文で話しかけられます。</p>}
        {props.messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          <div>{message.text}</div>
          {message.sources?.length ? <div className="small stack">{message.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>)}</div> : null}
          {message.role === "coach" && <div className="row">
            <button className="ghost" onClick={() => props.onSpeak(message)}><Volume2 size={16} /> 読み上げ</button>
            <button className="ghost" onClick={() => props.onTranslate(message)}>翻訳</button>
          </div>}
        </article>)}
      </div>
      <div className="composer">
        <textarea rows={3} value={props.draft} onChange={(event) => props.setDraft(event.target.value)} placeholder="Type in English, Japanese, or both..." />
        <div className="row">
          <button onClick={props.onAssist}><Sparkles size={16} /> Quick Assist</button>
          <button disabled={!canRecognizeSpeech()} onClick={props.onMic}><Mic size={16} /> Mic</button>
          <button className="primary" onClick={props.onSend}><Send size={16} /> Send</button>
        </div>
      </div>
    </section>
  </div>;
}

function ReviewTab(props: { vocab: VocabCard[]; notes: LearningNote[]; onReload: () => void }) {
  const [expression, setExpression] = useState("");
  const [meaning, setMeaning] = useState("");
  return <div className="grid two-col">
    <section className="panel stack">
      <div className="section-title"><h2>Vocabulary List</h2><span className="small">{props.vocab.length} cards</span></div>
      <div className="split">
        <input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="expression" />
        <input value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="meaning" />
      </div>
      <button className="primary" onClick={async () => {
        if (!expression.trim()) return;
        await db.vocabCards.put({ id: id("vocab"), expression: expression.trim(), meaning: meaning.trim(), source: "Manual", favorite: false, usageCount: 0, reviewed: false, createdAt: Date.now() });
        setExpression("");
        setMeaning("");
        await props.onReload();
      }}>手動追加</button>
      {props.vocab.map((card) => <article className="card stack" key={card.id}>
        <div className="section-title"><h3>{card.expression}</h3><span>{card.favorite ? "★" : "☆"}</span></div>
        <p className="muted">{card.meaning || "意味は未設定です。"}</p>
        <div className="row">
          <button className="ghost" onClick={async () => { await db.vocabCards.update(card.id, { favorite: !card.favorite }); await props.onReload(); }}><Star size={15} /> Favorite</button>
          <button className="ghost" onClick={async () => { await db.vocabCards.update(card.id, { reviewed: true }); await recordDailyStat({ reviewsDone: 1 }); await props.onReload(); }}><Check size={15} /> Reviewed</button>
          <button className="danger ghost" onClick={async () => { await db.vocabCards.delete(card.id); await props.onReload(); }}><Trash2 size={15} /> Delete</button>
        </div>
      </article>)}
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Learning Notes</h2><span className="small">{props.notes.length} notes</span></div>
      {props.notes.map((note) => <article className="card stack" key={note.id}>
        <strong>{note.sourceMessage}</strong>
        <p className="small">{note.coachNotes}</p>
        <p className="small muted">{note.betterOptions}</p>
      </article>)}
    </section>
  </div>;
}

function ProgressTab(props: { progress: ReturnType<typeof localProgress>; analyses: ConversationAnalysis[]; canAnalyze: boolean; onAnalyze: () => void; onPractice: (prompt: string) => void }) {
  const latest = props.analyses[0];
  return <div className="stack">
    <section className="panel">
      <div className="section-title"><h2>Progress</h2><button className="primary" disabled={!props.canAnalyze} onClick={props.onAnalyze}>会話を分析</button></div>
      <div className="split">
        <Metric label="Streak" value={`${props.progress.streak}日`} />
        <Metric label="Turns" value={`${props.progress.userTurns}`} />
        <Metric label="Vocabulary" value={`${props.progress.savedExpressions}`} />
        <Metric label="Reviewed" value={`${props.progress.reviewedCount}`} />
        <Metric label="Quick Assist" value={`${props.progress.assistUses}`} />
        <Metric label="Avg length" value={`${props.progress.averageUserLength}字`} />
      </div>
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Your English Profile</h2><span className="small muted">ユーザー操作時だけGeminiへ送信</span></div>
      {!latest && <p className="muted">20発話以上で分析できます。分析結果はこのブラウザ内へ保存されます。</p>}
      {latest && <>
        <p className="small muted">{new Date(latest.createdAt).toLocaleString()} / {latest.userMessageCount}発話 / CEFR {latest.result.estimatedCefr}</p>
        <p>{latest.result.summary}</p>
        <div className="split">
          <ProfileList title="強み" items={latest.result.strengths.map((item) => item.title || item.comment)} />
          <ProfileList title="次の練習" items={latest.result.nextFocus} />
          <ProfileList title="レベルアップ" items={latest.result.levelUpPlan} />
        </div>
        {latest.result.recurringPatterns.map((pattern) => <article className="card" key={pattern.title}>
          <strong>{pattern.title}</strong>
          <p className="small">{pattern.nextAction}</p>
        </article>)}
        <div className="row">{latest.result.practicePrompts.slice(0, 3).map((prompt) => <button key={prompt} onClick={() => props.onPractice(prompt)}>{prompt}</button>)}</div>
      </>}
    </section>
  </div>;
}

function Metric(props: { label: string; value: string }) {
  return <div className="card"><p className="small muted">{props.label}</p><strong>{props.value}</strong></div>;
}

function ProfileList(props: { title: string; items: string[] }) {
  return <div className="card"><strong>{props.title}</strong>{props.items.length ? props.items.map((item) => <p className="small" key={item}>{item}</p>) : <p className="small muted">まだありません。</p>}</div>;
}

function SettingsTab(props: {
  settings: AppSettings;
  apiKeyDraft: string;
  setApiKeyDraft: (value: string) => void;
  backupPassphrase: string;
  setBackupPassphrase: (value: string) => void;
  onSettings: (patch: Partial<AppSettings>) => void;
  onSaveApiKey: () => void;
  onClearApiKey: () => void;
  onTestConnection: () => void;
  onRequestPersist: () => void;
  onCheckPersist: () => void;
  onExport: () => void;
  onRestore: (file?: File) => void;
  onReplayOnboarding: () => void;
  onResetCoachSkills: () => void;
  onClearLearning: () => void;
}) {
  return <div className="stack">
    <section className="panel stack">
      <div className="section-title"><h2><KeyRound size={18} /> Gemini API Key</h2><span className="small">{props.settings.hasApiKey ? "保存済み" : "未設定"}</span></div>
      <p className="small muted">BYOKey LabはAPIキーを受信、保存、閲覧するためのアプリケーションサーバーやデータベースを持たず、通常利用時に利用者のAPIキーを保存・把握しません。コードはGitHubで公開し、データの保存先、通信先、APIキーの取扱いを確認できるようにしています。</p>
      <p className="small"><ShieldAlert size={15} /> クライアント側にAPIキーを入力する構成は、Google公式の一般的なセキュリティ推奨とは異なります。理解・納得できる方のみ利用してください。</p>
      <div className="split">
        <select value={props.settings.apiKeyMode} onChange={(event) => props.onSettings({ apiKeyMode: event.target.value as AppSettings["apiKeyMode"] })}>
          <option value="persistent">このブラウザに保存</option>
          <option value="session">このセッションだけ</option>
        </select>
        <input type="password" autoComplete="off" value={props.apiKeyDraft} onChange={(event) => props.setApiKeyDraft(event.target.value)} placeholder="Gemini API key" />
      </div>
      <div className="row">
        <button className="primary" onClick={props.onSaveApiKey}>保存</button>
        <button onClick={props.onTestConnection}>接続テスト</button>
        <button className="danger ghost" onClick={props.onClearApiKey}>APIキー削除</button>
        <a href={LINKS.googleAiStudio} target="_blank" rel="noreferrer">Google AI Studio <ExternalLink size={14} /></a>
      </div>
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Conversation Settings</h2></div>
      <div className="grid settings-grid">
        <label>Model<select value={props.settings.model} onChange={(event) => props.onSettings({ model: event.target.value })}>{GEMINI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " (Recommended)" : ""}</option>)}</select></label>
        <label>CEFR<select value={props.settings.englishLevel} onChange={(event) => props.onSettings({ englishLevel: event.target.value as AppSettings["englishLevel"] })}>{["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => <option key={level}>{level}</option>)}</select></label>
        <label>Voice mode<select value={props.settings.voiceMode} onChange={(event) => props.onSettings({ voiceMode: event.target.value as AppSettings["voiceMode"] })}><option value="off">Off</option><option value="manual">手動送信</option><option value="fullAuto">Full Auto</option></select></label>
        <label>Voice<select value={props.settings.voiceGender} onChange={(event) => props.onSettings({ voiceGender: event.target.value as AppSettings["voiceGender"] })}><option value="female">Female</option><option value="male">Male</option></select></label>
      </div>
      <label>Coach Skills<textarea rows={10} value={props.settings.coachSkills} onChange={(event) => props.onSettings({ coachSkills: event.target.value })} /></label>
      <div className="row">
        <button onClick={props.onResetCoachSkills}><RotateCcw size={15} /> Reset Skills</button>
        <button onClick={() => props.onSettings({ soundEffectsEnabled: !props.settings.soundEffectsEnabled })}>{props.settings.soundEffectsEnabled ? "効果音 ON" : "効果音 OFF"}</button>
      </div>
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Backup & Local Data</h2></div>
      <p className="small muted">暗号化バックアップにはAPIキーを含めません。機種変更や別ブラウザではAPIキーを再入力してください。</p>
      <input type="password" value={props.backupPassphrase} onChange={(event) => props.setBackupPassphrase(event.target.value)} placeholder="8文字以上のバックアップ用パスフレーズ" />
      <div className="row">
        <button onClick={props.onExport}><Download size={15} /> Export</button>
        <label><span className="buttonlike"><Upload size={15} /> Restore</span><input hidden type="file" accept="application/json" onChange={(event) => props.onRestore(event.target.files?.[0])} /></label>
        <button onClick={props.onRequestPersist}>永続ストレージ要求</button>
        <button onClick={props.onCheckPersist}>保存状態確認</button>
        <button className="danger ghost" onClick={props.onClearLearning}>学習データ削除</button>
      </div>
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Help & About</h2></div>
      <div className="split">
        <InfoLink href={LINKS.apiGuide} label="API設定ガイド" />
        <InfoLink href={LINKS.privacy} label="Privacy Policy" />
        <InfoLink href={LINKS.terms} label="Terms" />
        <InfoLink href={LINKS.support} label="Support" />
        <InfoLink href={LINKS.github} label="GitHub Source" icon={<Github size={15} />} />
      </div>
      <p className="small muted">Version {BUILD_INFO.version} / Commit {BUILD_INFO.commitSha} / Build {BUILD_INFO.buildTime}</p>
      <button onClick={props.onReplayOnboarding}>初回案内を再表示</button>
    </section>
  </div>;
}

function InfoLink(props: { href: string; label: string; icon?: React.ReactNode }) {
  return <a className="card row" href={props.href} target="_blank" rel="noreferrer">{props.icon ?? <ExternalLink size={15} />} {props.label}</a>;
}

function AssistModal(props: {
  assist: { open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> };
  setAssist: (value: { open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> }) => void;
  runAssist: () => void;
  adopt: (english: string) => void;
}) {
  return <div className="modal-backdrop">
    <section className="modal stack">
      <div className="section-title"><h2>Quick Assist</h2><button className="icon-button ghost" onClick={() => props.setAssist({ open: false, stuck: "", suggestions: [] })}>×</button></div>
      <textarea rows={3} value={props.assist.stuck} onChange={(event) => props.setAssist({ ...props.assist, stuck: event.target.value })} placeholder="日本語でも英語でも、言いたいことを書いてください。" />
      <button className="primary" onClick={props.runAssist}><Sparkles size={15} /> 候補を出す</button>
      {props.assist.suggestions.map((suggestion) => <article className="card stack" key={suggestion.english}>
        <strong>{suggestion.english}</strong>
        <span className="small muted">{suggestion.note}</span>
        <button onClick={() => props.adopt(suggestion.english)}>入力欄へ追記</button>
      </article>)}
    </section>
  </div>;
}
