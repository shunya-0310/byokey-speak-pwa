import {
  BarChart3,
  BookOpen,
  Download,
  ExternalLink,
  Github,
  Globe2,
  Headphones,
  KeyRound,
  Loader2,
  MessageCircle,
  Mic,
  MoreVertical,
  Pause,
  Pin,
  Plus,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  Upload,
  Volume2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUILD_INFO, LINKS } from "./links";
import {
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
import { countActiveVocabularyUse, deriveChatTitle, localProgress } from "../domain/stats";
import {
  createChat,
  db,
  deleteEquivalentVocabCard,
  ensureFirstChat,
  exportSnapshot,
  id,
  loadSettings,
  mergeEquivalentVocabCards,
  recordDailyStat,
  restoreSnapshot,
  saveSettings,
  saveVocabCard,
  setEquivalentVocabFavorite
} from "../infrastructure/db";
import { clearPersistentApiKey, clearSessionApiKey, decryptBackupJson, encryptBackupJson, getActiveApiKey, savePersistentApiKey, saveSessionApiKey } from "../infrastructure/crypto";
import { generateWithGemini, parseAnalysis, parseCoachReply, userMessageForError, type LlmError } from "../infrastructure/gemini";
import { loadDailyNews, newsHiddenContext, newsVisibleOpener } from "../infrastructure/news";
import { isPreviewOrigin, isTrustedPersistentOrigin } from "../infrastructure/pwa";
import { canRecognizeSpeech, listenOnce, speakCoachText, stopSpeaking } from "../infrastructure/speech";
import { playAppSound, primeAppSounds, type AppSound } from "../infrastructure/sound";
import type { DailyNewsFeed, DailyNewsItem } from "../domain/schemas";

type Tab = "chats" | "review" | "progress" | "settings";
type ChatPage = "list" | "conversation";
type SettingsStatus = { section: "api" | "conversation" | "backup" | "about" | "system" | "coach" | "data" | "help"; kind: "ok" | "error" | "info"; text: string } | null;
type SettingsSection = "system" | "coach" | "backup" | "data" | "help" | "about";
type SplashMode = "initial" | "postOnboarding" | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface AppData {
  settings: AppSettings;
  chats: Chat[];
  messages: ChatMessage[];
  vocab: VocabCard[];
  notes: LearningNote[];
  stats: DailyStat[];
  analyses: ConversationAnalysis[];
}

const ONBOARDING = [
  {
    title: "BYOKey Speakへようこそ",
    body: "BYOKey SpeakはGoogleのAIモデル「Gemini」を使って英会話を楽しむブラウザアプリです。一般的なAI英会話では実現できない、あなた専属のコーチ像を「あなたの言葉で」「自由に」設定して会話を楽しむことができます。誰か偉人を呼び出して会話をするのも面白いかもしれませんね！会話のレベルはCEFR A1~C2まで対応しており、これも自由に設定可能です。",
    image: "/images/onboarding/onboarding_bg_1.jpg"
  },
  {
    title: "BYOKの流れ",
    body: "BYOKとはBring Your Own Keyの略です。「APIキー」と呼ばれる合鍵を作成し、これを利用して会話をする仕組みです。Googleアカウントがあれば簡単に作成でき、使用量に応じて料金がかかる従量課金制となっています。APIキーの取得方法はアプリ内ヘルプから閲覧可能です。なお、会話はあなたのブラウザからGemini APIへ直接送信され、BYOKey Labのサーバーは経由しません。また、BYOKey LabがあなたのAPIキーを取得・保存、問い合わせることはありません。利用料の参考情報は以下のサイトをご参照ください。ただし、費用は会話の回数だけでなく文章量や使い方によっても異なるため、都度Google Cloud コンソールにて利用料を確認するようにしてください。",
    image: "/images/onboarding/onboarding_bg_2.jpg"
  },
  {
    title: "APIキーの重要な注意",
    body: "APIキーはGemini API利用権限に紐づく重要な情報です。GoogleはブラウザやモバイルアプリなどにAPIキーを入力して使用する構成をセキュリティリスクの観点から一般には推奨していません。本アプリはBYOK方式として、利用者自身がこのリスクを理解し、自分のキーを自分の責任で入力する設計です。安全に利用するためには、①本アプリ専用のAPIキーを作成し、②利用制限（上限）を設定し、③随時利用量の確認を行い、④定期的にAPIキーを更新することを推奨します。この説明は2026年8月11日時点の情報です。",
    image: "/images/onboarding/onboarding_bg_3.jpg"
  },
  {
    title: "データの保存について",
    body: "あなたのAPIキー、会話履歴、単語メモ、学習の進み具合は、この端末のブラウザ内に保存されます。BYOKey Labのサーバーへ送られるものではありません。ただし、アプリをアンインストールしたり、ブラウザのキャッシュやサイトデータを削除したり、別の端末へ移ったりすると、保存した内容をそのまま使えなくなることがあります。大切な学習データは、アプリ内のバックアップ機能で書き出し、必要なときに復元できます。バックアップにはAPIキーを含めないため、APIキーだけは新しい端末やブラウザで再入力してください。",
    image: "/images/onboarding/onboarding_bg_4.jpg"
  },
  {
    title: "さあ、はじめましょう",
    body: "設定画面からGeminiモデルの選択、APIキーの設定、会話レベル／コーチの性格などの設定を行いましょう。BYOKによる一段上の体験を実感してください。ご利用にあたっては前段のリスクとAI利用による会話内容の外部送信についての同意をお願いいたします。",
    image: "/images/onboarding/onboarding_bg_5.jpg"
  }
];

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>((new URLSearchParams(location.search).get("tab") as Tab) || "chats");
  const [chatPage, setChatPage] = useState<ChatPage>("list");
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [draftUndoStack, setDraftUndoStack] = useState<string[]>([]);
  const [draftSource, setDraftSource] = useState<ChatMessage["inputSource"]>("TYPED");
  const [webSearch, setWebSearch] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [news, setNews] = useState<{ feed?: DailyNewsFeed; notice?: string }>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [assist, setAssist] = useState<{ open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> }>({ open: false, stuck: "", suggestions: [] });
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>(null);
  const [splashMode, setSplashMode] = useState<SplashMode>("initial");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(() => localStorage.getItem("byokey-install-banner-dismissed") === "1");

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
    setData({ settings, chats, messages, vocab: mergeEquivalentVocabCards(vocab), notes, stats, analyses });
    document.documentElement.dataset.theme = settings.theme;
    const hasExistingLocalData = settings.onboardingDone || settings.hasApiKey || chats.length > 0 || messages.length > 0 || vocab.length > 0 || notes.length > 0 || stats.length > 0 || analyses.length > 0;
    setShowOnboarding(!hasExistingLocalData);
    if (!activeChatId) {
      const selected = settings.lastOpenedChatId && chats.some((chat) => chat.id === settings.lastOpenedChatId)
        ? settings.lastOpenedChatId
        : chats[0]?.id ?? await ensureFirstChat();
      setActiveChatId(selected);
    }
  }

  async function refreshNews(manual = false) {
    if (manual) setBusy("Daily Newsを更新中です");
    try {
      const { feed, notice } = await loadDailyNews();
      setNews({ feed, notice });
      if (manual) setNotice("Daily Newsを更新しました。");
    } catch {
      setNews({ notice: "Daily Newsを読み込めませんでした。" });
      if (manual) setError("Daily Newsを読み込めませんでした。");
    } finally {
      if (manual) setBusy("");
    }
  }

  function playSound(sound: Parameters<typeof playAppSound>[0]) {
    playAppSound(sound, currentData.settings.soundEffectsEnabled);
  }

  useEffect(() => {
    void reload();
    void refreshNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.theme = data.settings.theme;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.theme]);

  useEffect(() => {
    if (!data?.settings.soundEffectsEnabled) return;
    primeAppSounds(true);
  }, [data?.settings.soundEffectsEnabled]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 2000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallBannerDismissed(false);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!data) {
    return <div className="app">
      <SplashOverlay onFinished={() => setSplashMode(null)} />
    </div>;
  }

  const currentData = data;
  const activeChat = currentData.chats.find((chat) => chat.id === activeChatId);
  const chatMessages = currentData.messages.filter((message) => message.chatId === activeChatId);
  const progress = localProgress(currentData.stats, currentData.messages, currentData.vocab);
  const canSendToGemini = currentData.settings.consentVersion >= 1 && currentData.settings.hasApiKey;
  const showInstallBanner = !installBannerDismissed && !isStandaloneDisplay();

  if (splashMode === "initial") {
    return <div className="app"><SplashOverlay onFinished={() => setSplashMode(null)} /></div>;
  }

  function handleGlobalInteractionSound(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest("button,a,.buttonlike");
    if (!control || control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true") return;
    primeAppSounds(currentData.settings.soundEffectsEnabled);
    const sound = (control as HTMLElement).dataset.sound;
    if (sound === "none") return;
    playAppSound((sound as AppSound) || "select", currentData.settings.soundEffectsEnabled);
  }

  function showSettingsStatus(status: NonNullable<SettingsStatus>) {
    setSettingsStatus(status);
    if (status.kind === "error") {
      setError(status.text);
    } else {
      setNotice(status.text);
    }
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const next = { ...currentData.settings, ...patch };
    await saveSettings(next);
    await reload();
  }

  async function selectChat(chatId: string) {
    setActiveChatId(chatId);
    setChatPage("conversation");
    setDraftUndoStack([]);
    await updateSettings({ lastOpenedChatId: chatId });
  }

  async function newChat(title = "New chat", origin: Chat["origin"] = "FREE_CHAT", newsContext?: string, opener?: string, sources?: ChatMessage["sources"]) {
    playSound("decision");
    const chat = createChat(title, origin, newsContext);
    await db.chats.put(chat);
    if (opener) {
      await db.messages.put({ id: id("msg"), chatId: chat.id, role: "coach", text: opener, inputSource: "NONE", usedQuickAssist: false, sources, createdAt: Date.now() });
    }
    setDraft("");
    setDraftUndoStack([]);
    setDraftSource("TYPED");
    await selectChat(chat.id);
    await reload();
  }

  function rememberDraftForUndo(value: string) {
    setDraftUndoStack((stack) => {
      if (stack[stack.length - 1] === value) return stack;
      return [...stack.slice(-24), value];
    });
  }

  function updateDraftFromUser(value: string) {
    if (value !== draft) rememberDraftForUndo(draft);
    setDraft(value);
    setDraftSource(value.trim() ? mergeInputSource(draftSource, "TYPED") : "TYPED");
  }

  function appendToDraft(addition: string, source: ChatMessage["inputSource"]) {
    if (!addition.trim()) return;
    rememberDraftForUndo(draft);
    setDraft((current) => `${current}${current ? " " : ""}${addition.trim()}`);
    setDraftSource((current) => mergeInputSource(current, source));
  }

  function undoDraftInput() {
    const previous = draftUndoStack[draftUndoStack.length - 1];
    if (previous === undefined) return;
    setDraft(previous);
    setDraftUndoStack((stack) => stack.slice(0, -1));
    setDraftSource(previous.trim() ? "TYPED" : "TYPED");
  }

  async function cycleVoiceMode() {
    const next = nextVoiceMode(currentData.settings.voiceMode);
    playSound("select");
    await updateSettings({ voiceMode: next });
    setNotice(next === "off" ? "Voice Mode: Off" : next === "manual" ? "Voice Mode: マニュアル送信" : "Voice Mode: フルオート");
  }

  function stopCurrentSpeech() {
    stopSpeaking();
    setSpeakingMessageId(null);
  }

  function speakMessage(message: ChatMessage, afterEnd?: () => void) {
    const ok = speakCoachText(message.text, currentData.settings.voiceGender, () => {
      setSpeakingMessageId((current) => current === message.id ? null : current);
      afterEnd?.();
    }, currentData.settings.voiceRate);
    if (ok) {
      setSpeakingMessageId(message.id);
    } else {
      setNotice("このブラウザは読み上げに対応していません。");
    }
  }

  async function startAutoEnglishMic(mode: AppSettings["voiceMode"], baseSource: ChatMessage["inputSource"] = "VOICE") {
    if (mode === "off") return;
    try {
      const spoken = await listenOnce("en-US");
      if (mode === "fullAuto") {
        await sendMessage(mergeInputSource(baseSource, "VOICE"), spoken);
      } else {
        appendToDraft(spoken, "VOICE");
      }
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function sendMessage(source: ChatMessage["inputSource"] = draftSource, text = draft) {
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
    setDraftUndoStack([]);
    setDraftSource("TYPED");
    setBusy("Geminiが返答中です");
    await db.messages.put(userMessage);
    playSound("messageSend");
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
      const coachMessage: ChatMessage = { id: id("msg"), chatId: activeChat.id, role: "coach", text: coachText, inputSource: "NONE", usedQuickAssist: false, sources: result.sources, createdAt: Date.now() };
      await db.messages.put(coachMessage);
      playSound("messageReceive");
      for (const item of reply.vocabulary) {
        await saveVocabCard({ expression: item.expression, meaning: item.meaning, source: "Chats", chatId: activeChat.id });
      }
      if (reply.coachNote || reply.betterOptions.length) {
        await db.learningNotes.put({ id: id("note"), chatId: activeChat.id, sourceMessage: trimmed, coachNotes: reply.coachNote ?? "", betterOptions: reply.betterOptions.join("\n"), japaneseNote: reply.japaneseExplanation ?? "", reviewed: false, createdAt: Date.now() });
      }
      await reload();
      if (currentData.settings.voiceMode !== "off") {
        speakMessage(coachMessage, () => {
          void startAutoEnglishMic(currentData.settings.voiceMode);
        });
      }
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
    if (backupPassphrase.length < 8) return showSettingsStatus({ section: "backup", kind: "error", text: "バックアップ用パスフレーズは8文字以上で入力してください。" });
    const snapshot = await exportSnapshot();
    const encrypted = await encryptBackupJson(JSON.stringify(snapshot), backupPassphrase);
    const blob = new Blob([encrypted], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `byokey-speak-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showSettingsStatus({ section: "backup", kind: "ok", text: "APIキーを含まない暗号化バックアップを書き出しました。" });
  }

  async function restoreBackup(file?: File) {
    if (!file) return;
    if (backupPassphrase.length < 8) return showSettingsStatus({ section: "backup", kind: "error", text: "復元用パスフレーズは8文字以上で入力してください。" });
    try {
      const plain = await decryptBackupJson(await file.text(), backupPassphrase);
      await restoreSnapshot(JSON.parse(plain));
      await reload();
      showSettingsStatus({ section: "backup", kind: "ok", text: "バックアップを復元しました。APIキーは復元対象外です。" });
    } catch (caught) {
      showSettingsStatus({ section: "backup", kind: "error", text: (caught as Error).message });
    }
  }

  async function reportMessage(message: ChatMessage) {
    const previousUser = [...currentData.messages]
      .filter((candidate) => candidate.chatId === message.chatId && candidate.role === "user" && candidate.createdAt < message.createdAt)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const reportText = [
      "BYOKey Speak Gemini API response report",
      `Date: ${new Date(message.createdAt).toISOString()}`,
      `Model: ${currentData.settings.model}`,
      previousUser ? `Previous user message:\n${previousUser.text}` : "",
      `Model response:\n${message.text}`,
      message.sources?.length ? `Sources:\n${message.sources.map((source) => `${source.title || compactUrl(source.url)} - ${source.url}`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(reportText);
      setNotice("報告用メモをクリップボードにコピーしました。Googleの報告フォームを開きます。");
    } catch {
      setNotice("Googleの報告フォームを開きます。必要な内容を手動で転記してください。");
    }
    window.open(LINKS.googleCloudAbuseReport, "_blank", "noopener,noreferrer");
  }

  if (showOnboarding) {
    return <Onboarding onDone={async (consented) => {
      await updateSettings({ onboardingDone: true, consentVersion: consented ? 1 : 0, consentAt: consented ? new Date().toISOString() : undefined });
      setShowOnboarding(false);
      setSplashMode("postOnboarding");
    }} />;
  }

  return (
    <div className="app" onPointerDownCapture={handleGlobalInteractionSound}>
      {splashMode && <SplashOverlay onFinished={() => setSplashMode(null)} />}
      <header className="app-hero" aria-label="BYOKey Speak">
        <h1>BYOKey Speak</h1>
        <div className="hero-rule"><span>✦</span></div>
      </header>
      {showInstallBanner && <section className="install-banner" aria-live="polite">
        <div>
          <strong>ホーム画面にインストール</strong>
          <p>BYOKey Speakはインストールして使うと、アプリ版に近い表示で起動できます。</p>
        </div>
        <div className="row nowrap">
          {installPrompt
            ? <button className="primary" onClick={async () => {
                await installPrompt.prompt();
                const choice = await installPrompt.userChoice;
                if (choice.outcome === "accepted") setInstallPrompt(null);
              }}>インストール</button>
            : <span className="small muted">ブラウザメニューから「ホーム画面に追加」を選んでください。</span>}
          <button className="icon-button ghost" title="閉じる" onClick={() => { localStorage.setItem("byokey-install-banner-dismissed", "1"); setInstallBannerDismissed(true); }}>×</button>
        </div>
      </section>}
      {isPreviewOrigin() && <div className="preview-banner small">プレビュー環境です。個人の本番APIキーを入力しないでください。</div>}
      {(notice || error || busy) && <div className="toast-region" aria-live="polite">
        {notice && <p className="toast small">{notice}</p>}
        {error && <p className="toast small danger">{error}</p>}
        {busy && <p className="toast small row"><Loader2 size={16} /> {busy}</p>}
      </div>}
      <main className="main">
        {news.notice && <p className="panel small">{news.notice}</p>}
        {activeTab === "chats" && <ChatsTab
          chats={data.chats}
          activeChat={activeChat}
          messages={chatMessages}
          allMessages={data.messages}
          news={news.feed}
          draft={draft}
          setDraftFromUser={updateDraftFromUser}
          settings={data.settings}
          webSearch={webSearch}
          setWebSearch={setWebSearch}
          page={chatPage}
          canUndoDraft={draftUndoStack.length > 0}
          speakingMessageId={speakingMessageId}
          onBackToChats={() => setChatPage("list")}
          onNewChat={() => newChat()}
          onNews={(item) => newChat(item.headline, "DAILY_NEWS", newsHiddenContext(item), newsVisibleOpener(item, data.settings.coachSkills), item.sources)}
          onSelectChat={selectChat}
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
          onUndo={undoDraftInput}
          onAssist={() => setAssist({ open: true, stuck: "", suggestions: [] })}
          onVoiceModeCycle={cycleVoiceMode}
          onTranslate={translateMessage}
          onReport={reportMessage}
          onSpeak={(message) => speakMessage(message)}
          onStopSpeak={stopCurrentSpeech}
          onMic={async (language) => {
            try {
              const spoken = await listenOnce(language);
              const next = `${draft}${draft ? " " : ""}${spoken}`.trim();
              if (data.settings.voiceMode === "fullAuto") {
                await sendMessage(mergeInputSource(draftSource, "VOICE"), next);
              } else {
                appendToDraft(spoken, "VOICE");
              }
            } catch (caught) {
              setError((caught as Error).message);
            }
          }}
        />}
        {activeTab === "review" && <ReviewTab vocab={data.vocab} messages={data.messages} onReload={reload} />}
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
          status={settingsStatus}
          onSettings={updateSettings}
          onDailyNewsNotificationToggle={async (enabled) => {
            if (enabled && "Notification" in window && Notification.permission === "default") {
              const permission = await Notification.requestPermission();
              if (permission !== "granted") {
                await updateSettings({ dailyNewsNotificationsEnabled: false });
                showSettingsStatus({ section: "system", kind: "error", text: "通知が許可されませんでした。ブラウザ設定から許可できます。" });
                return;
              }
            }
            if (enabled && "Notification" in window && Notification.permission === "denied") {
              await updateSettings({ dailyNewsNotificationsEnabled: false });
              showSettingsStatus({ section: "system", kind: "error", text: "通知がブロックされています。ブラウザ設定から許可してください。" });
              return;
            }
            await updateSettings({ dailyNewsNotificationsEnabled: enabled });
            showSettingsStatus({ section: "system", kind: "ok", text: enabled ? "Daily News通知をONにしました。PWAではブラウザの通知許可と起動状態により動作が制限されます。" : "Daily News通知をOFFにしました。" });
          }}
          onSaveApiKey={async () => {
            if (!apiKeyDraft.trim()) return showSettingsStatus({ section: "api", kind: "error", text: "APIキーを入力してください。" });
            const mode = data.settings.apiKeyMode;
            if (mode === "persistent") {
              if (!isTrustedPersistentOrigin()) return showSettingsStatus({ section: "api", kind: "error", text: "このオリジンではブラウザ保存を既定で無効にしています。session-onlyを選んでください。" });
              await savePersistentApiKey(apiKeyDraft.trim());
            } else {
              saveSessionApiKey(apiKeyDraft.trim());
            }
            await updateSettings({ hasApiKey: true });
            setApiKeyDraft("");
            showSettingsStatus({ section: "api", kind: "ok", text: mode === "persistent" ? "APIキーをこのブラウザ内に保存しました。欄は安全のため空にしています。" : "APIキーをこのセッションだけ保存しました。欄は安全のため空にしています。" });
          }}
          onClearApiKey={async () => {
            await clearPersistentApiKey();
            clearSessionApiKey();
            await updateSettings({ hasApiKey: false });
            showSettingsStatus({ section: "api", kind: "info", text: "保存済みのAPIキーを削除しました。" });
          }}
          onTestConnection={async () => {
            const apiKey = apiKeyDraft.trim() || await getActiveApiKey(data.settings.apiKeyMode);
            if (!apiKey) return showSettingsStatus({ section: "api", kind: "error", text: "接続テストにはAPIキーが必要です。" });
            setBusy("接続テスト中です");
            try {
              await generateWithGemini({ apiKey, model: data.settings.model, prompt: "Reply with exactly: OK" });
              showSettingsStatus({ section: "api", kind: "ok", text: "Geminiへの接続に成功しました。" });
            } catch (caught) {
              showSettingsStatus({ section: "api", kind: "error", text: (caught as Error).message });
            } finally {
              setBusy("");
            }
          }}
          onExport={exportBackup}
          onRestore={restoreBackup}
          onReplayOnboarding={() => setShowOnboarding(true)}
          onClearLearning={async () => {
            if (!confirm("会話、Vocabulary、進捗、分析を削除しますか。APIキーは残ります。")) return;
            await Promise.all([db.chats.clear(), db.messages.clear(), db.vocabCards.clear(), db.learningNotes.clear(), db.dailyStats.clear(), db.analyses.clear()]);
            await reload();
            showSettingsStatus({ section: "data", kind: "info", text: "学習データを削除しました。APIキーは残っています。" });
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
          appendToDraft(english, "QUICK_ASSIST");
          await saveVocabCard({ expression: english, meaning: assist.suggestions.find((item) => item.english === english)?.note ?? "", source: "QuickAssist", chatId: activeChatId });
          setAssist({ open: false, stuck: "", suggestions: [] });
          await reload();
        }}
        onMic={async () => {
          try {
            const spoken = await listenOnce("ja-JP");
            setAssist((current) => ({ ...current, stuck: `${current.stuck}${current.stuck ? " " : ""}${spoken}` }));
          } catch (caught) {
            setError((caught as Error).message);
          }
        }}
      />}
    </div>
  );
}

function TabButton(props: { tab: Tab; active: Tab; setActive: (tab: Tab) => void; icon: React.ReactNode; label: string }) {
  return <button aria-current={props.active === props.tab ? "page" : undefined} onClick={() => props.setActive(props.tab)}>{props.icon}<span>{props.label}</span></button>;
}

function SplashOverlay(props: { onFinished: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(props.onFinished, 1000);
    return () => window.clearTimeout(timer);
  }, [props.onFinished]);
  return <div className="splash-overlay" aria-label="BYOKey Speak loading">
    <div className="splash-logo-wrap">
      <span className="splash-light splash-light-a" />
      <span className="splash-light splash-light-b" />
      <span className="splash-flash" />
    </div>
  </div>;
}

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function mergeInputSource(current: ChatMessage["inputSource"], next: ChatMessage["inputSource"]): ChatMessage["inputSource"] {
  if (next === "NONE" || next === "UNKNOWN") return current;
  if (current === "NONE" || current === "UNKNOWN") return next;
  if (current === next) return current;
  return "MIXED";
}

function nextVoiceMode(current: AppSettings["voiceMode"]): AppSettings["voiceMode"] {
  if (current === "off") return "manual";
  if (current === "manual") return "fullAuto";
  return "off";
}

function Onboarding(props: { onDone: (consented: boolean) => void }) {
  const [page, setPage] = useState(0);
  const [consented, setConsented] = useState(false);
  const current = ONBOARDING[page];
  return <div className="onboarding" style={{ backgroundImage: `url(${current.image})` }} onPointerDownCapture={() => primeAppSounds()}>
    <section className="onboarding-card">
      <p className="muted">Page {page + 1} / 5</p>
      <h1>{current.title}</h1>
      <p>{current.body}</p>
      {page === 1 && <p className="small"><a href={LINKS.officialSite} target="_blank" rel="noreferrer">BYOKey Lab公式サイト <ExternalLink size={14} /></a></p>}
      {page === 2 && <p className="small"><a href={LINKS.googleApiKeyDocs} target="_blank" rel="noreferrer">Google公式のAPIキー資料 <ExternalLink size={14} /></a></p>}
      {page === 4 && <label className="row"><input style={{ width: "auto" }} type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /> リスクと外部送信について理解しました</label>}
      <div className="row">
        <button className="ghost" disabled={page === 0} onClick={() => { playAppSound("pages"); setPage((value) => value - 1); }}>戻る</button>
        <button className="ghost" onClick={() => props.onDone(false)}>後で設定する</button>
        {page < 4 ? <button className="primary" onClick={() => { playAppSound("pages"); setPage((value) => value + 1); }}>次へ</button> : <button className="primary" disabled={!consented} onClick={() => { playAppSound("decision"); props.onDone(true); }}>開始</button>}
      </div>
    </section>
  </div>;
}

function ChatsTab(props: {
  chats: Chat[];
  activeChat?: Chat;
  messages: ChatMessage[];
  allMessages: ChatMessage[];
  news?: DailyNewsFeed;
  draft: string;
  setDraftFromUser: (value: string) => void;
  settings: AppSettings;
  webSearch: boolean;
  setWebSearch: (value: boolean) => void;
  page: ChatPage;
  canUndoDraft: boolean;
  speakingMessageId: string | null;
  onBackToChats: () => void;
  onNewChat: () => void;
  onNews: (item: DailyNewsItem) => void;
  onSelectChat: (chatId: string) => void;
  onPin: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
  onSend: () => void;
  onUndo: () => void;
  onAssist: () => void;
  onVoiceModeCycle: () => void;
  onTranslate: (message: ChatMessage) => void;
  onReport: (message: ChatMessage) => void;
  onSpeak: (message: ChatMessage) => void;
  onStopSpeak: () => void;
  onMic: (language: "en-US" | "ja-JP") => void;
}) {
  const newsItems = props.news?.items ?? [];
  const newsCategories = Array.from(new Map(newsItems.map((item) => [item.category, newsCategoryLabel(item)])).entries());
  const [selectedCategory, setSelectedCategory] = useState<string | null>(newsCategories[0]?.[0] ?? null);
  const [newsPage, setNewsPage] = useState(0);
  const newsCarouselRef = useRef<HTMLDivElement | null>(null);
  const activeCategory = selectedCategory && newsCategories.some(([category]) => category === selectedCategory)
    ? selectedCategory
    : newsItems[newsPage]?.category ?? newsCategories[0]?.[0] ?? null;
  const visibleNews = newsItems;

  function scrollNewsToPage(index: number, behavior: ScrollBehavior = "smooth") {
    const carousel = newsCarouselRef.current;
    const card = carousel?.querySelector<HTMLElement>(".daily-news-card");
    if (!carousel || !card) return;
    const gap = parseFloat(getComputedStyle(carousel).columnGap || "0");
    carousel.scrollTo({ left: index * (card.offsetWidth + gap), behavior });
  }

  function updateNewsPageFromScroll() {
    const carousel = newsCarouselRef.current;
    if (!carousel) return;
    const card = carousel.querySelector<HTMLElement>(".daily-news-card");
    if (!card) return;
    const gap = parseFloat(getComputedStyle(carousel).columnGap || "0");
    const pageWidth = card.offsetWidth + gap;
    const nextPage = Math.max(0, Math.min(newsItems.length - 1, Math.round(carousel.scrollLeft / Math.max(1, pageWidth))));
    setNewsPage(nextPage);
    if (newsItems[nextPage]) setSelectedCategory(newsItems[nextPage].category);
  }

  if (props.page === "conversation") {
    return <section className="panel stack chat-page">
      <div className="conversation-title">
        <button className="back-button ghost" onClick={props.onBackToChats}>←</button>
        <h2>{props.activeChat?.title ?? "New chat"}</h2>
      </div>
      <div className="messages focused" aria-live="polite">
        {props.messages.length === 0 && <p className="message system">New Chatです。英語、日本語、混在文で話しかけられます。</p>}
        {props.messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          <div>{renderTextWithCompactLinks(message.text)}</div>
          {message.sources?.length ? <div className="source-list small">{message.sources.map((source) => <a key={`${source.title}-${source.url}`} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {source.title && !source.title.startsWith("http") ? source.title : compactUrl(source.url)}</a>)}</div> : null}
          {message.role === "coach" && <div className="message-actions">
            <button className="icon-button ghost" title={props.speakingMessageId === message.id ? "読み上げ停止" : "読み上げ"} onClick={() => props.speakingMessageId === message.id ? props.onStopSpeak() : props.onSpeak(message)}>{props.speakingMessageId === message.id ? <Pause size={17} /> : <Volume2 size={17} />}</button>
            <button className="icon-button ghost" title="翻訳" onClick={() => props.onTranslate(message)}>文</button>
            <button className="icon-button ghost" title="回答を報告" onClick={() => props.onReport(message)}><ShieldAlert size={17} /></button>
          </div>}
        </article>)}
      </div>
      <div className="composer">
        {props.settings.voiceMode !== "off" && <p className="voice-mode-hint small">{props.settings.voiceMode === "manual" ? "✦ マニュアル送信: 読み上げ後に英語マイクが起動します" : "✦ フルオート: 音声入力が終わると自動で送信します"}</p>}
        <div className="composer-actions" aria-label="Conversation tools">
          <button className={`icon-button ghost voice-mode-button ${props.settings.voiceMode !== "off" ? "active" : ""}`} title="Voice Mode切替" onClick={props.onVoiceModeCycle}>
            <Headphones size={20} />
            {props.settings.voiceMode !== "off" && <span className="mode-badge">{props.settings.voiceMode === "manual" ? "→" : "⇔"}</span>}
          </button>
          <button className="icon-button ghost" title="Quick Assist" onClick={props.onAssist}><Sparkles size={20} /></button>
          <button className={`icon-button ghost ${props.webSearch ? "active" : ""}`} title="Web検索" onClick={() => props.setWebSearch(!props.webSearch)}><Globe2 size={20} /></button>
          <button className="icon-button ghost" title="入力をひとつ戻す" disabled={!props.canUndoDraft} onClick={props.onUndo}><Undo2 size={20} /></button>
        </div>
        <div className="composer-input-row">
          <textarea rows={1} value={props.draft} onChange={(event) => props.setDraftFromUser(event.target.value)} placeholder="Let's talk!" />
          <button className="voice-mini" disabled={!canRecognizeSpeech()} title="English voice input" onClick={() => props.onMic("en-US")}><Mic size={19} /><span>英</span></button>
          <button className="voice-mini" disabled={!canRecognizeSpeech()} title="Japanese voice input" onClick={() => props.onMic("ja-JP")}><Mic size={19} /><span>日</span></button>
          <button className="send-mini primary" title="Send" onClick={props.onSend}><Send size={22} /></button>
        </div>
      </div>
    </section>;
  }

  return <div className="stack chats-screen">
      <div className="chats-headline">
        <h2>✦ Chats</h2>
        <button className="new-chat-pill" onClick={props.onNewChat}><Plus size={26} /> New Chat</button>
      </div>
      <section className="daily-news-section stack" aria-label="Daily News">
        <div className="daily-news-title-row">
          <div>
            <h3>TODAY&apos;S WORLD</h3>
            <p>{props.news?.date ?? new Date().toISOString().slice(0, 10)}</p>
          </div>
        </div>
        {newsCategories.length > 0 && <div className="news-category-row" role="tablist" aria-label="News categories">
          {newsCategories.map(([category, label]) => <button
            key={category}
            className={category === activeCategory ? "primary" : "ghost"}
            onClick={() => {
              const nextPage = Math.max(0, newsItems.findIndex((item) => item.category === category));
              setSelectedCategory(category);
              setNewsPage(nextPage);
              window.requestAnimationFrame(() => scrollNewsToPage(nextPage));
            }}
          >{label}</button>)}
        </div>
        }
        <p className="news-delivery-note">ニュースは毎朝6時半頃に配信されます。</p>
        <div className="news-scroll android-news-scroll" ref={newsCarouselRef} onScroll={updateNewsPageFromScroll}>
          {visibleNews.map((item) => <DailyNewsCard item={item} key={item.id} onTalk={() => props.onNews(item)} />)}
          {!newsItems.length && <p className="muted">読み込み中です。</p>}
        </div>
        {visibleNews.length > 1 && <div className="pager-dots" aria-hidden="true">
          {visibleNews.map((item, index) => <button className={index === newsPage ? "active" : ""} key={item.id} onClick={() => {
            setNewsPage(index);
            setSelectedCategory(item.category);
            scrollNewsToPage(index);
          }} aria-label={`News ${index + 1}`} />)}
        </div>}
      </section>
      <div className="chat-history stack">
        {props.chats.map((chat) => {
          const latest = latestChatMessage(chat.id, props.allMessages);
          return <article className="chat-history-card" key={chat.id}>
            <button className="chat-list-item" onClick={() => props.onSelectChat(chat.id)}>
              <strong>{chat.pinned ? "★ " : ""}{chat.title}</strong>
              <span>{latest ? chatPreview(latest) : chat.origin}</span>
              <small>{new Date(latest?.createdAt ?? chat.updatedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
            </button>
            <div className="chat-history-actions">
              <button className="icon-button ghost" title="Pin" onClick={() => props.onPin(chat)}><Pin size={16} /></button>
              <button className="icon-button danger ghost" title="Delete" onClick={() => props.onDelete(chat)}><Trash2 size={16} /></button>
              <MoreVertical size={18} />
            </div>
          </article>;
        })}
      </div>
  </div>;
}

function DailyNewsCard(props: { item: DailyNewsItem; onTalk: () => void }) {
  const source = props.item.sources[0];
  return <article className="daily-news-card">
    <div className="daily-news-card-main">
      <div className="source-icon" aria-hidden="true">{sourceIconText(source?.url ?? props.item.headline)}</div>
      <div>
        <p className="news-card-category">{newsCategoryLabel(props.item)}</p>
        <h4>{props.item.headline}</h4>
      </div>
    </div>
    <p className="news-summary">{props.item.summary}</p>
    <div className="daily-news-actions">
      {source && <a className="buttonlike source-button" href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Source</a>}
      <button className="primary talk-button" onClick={props.onTalk}><MessageCircle size={18} /> Talk</button>
    </div>
  </article>;
}

function newsCategoryLabel(item: DailyNewsItem) {
  if (item.categoryLabel) return item.categoryLabel;
  const labels: Record<string, string> = {
    politics_economy: "Politics & Economy",
    technology: "Technology",
    sports: "Sports",
    entertainment: "Entertainment"
  };
  return labels[item.category] ?? item.category;
}

function sourceIconText(raw: string) {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return host[0]?.toUpperCase() ?? "N";
  } catch {
    return raw.trim()[0]?.toUpperCase() ?? "N";
  }
}

function latestChatMessage(chatId: string, messages: ChatMessage[]) {
  return messages.filter((message) => message.chatId === chatId).sort((a, b) => b.createdAt - a.createdAt)[0];
}

function chatPreview(message: ChatMessage) {
  const prefix = message.role === "coach" ? "Natural reply: " : "";
  return `${prefix}${message.text.replace(/\s+/g, " ").slice(0, 84)}`;
}

function ReviewTab(props: { vocab: VocabCard[]; messages: ChatMessage[]; onReload: () => void }) {
  const [expression, setExpression] = useState("");
  const [meaning, setMeaning] = useState("");
  const [collection, setCollection] = useState<"vocabulary" | "quickAssist">("vocabulary");
  const [sort, setSort] = useState<"date" | "alphabet" | "frequency" | "favorite">("alphabet");
  const [showAdd, setShowAdd] = useState(false);
  const [activeRail, setActiveRail] = useState<{ letter: string; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cardsWithUsage = countActiveVocabularyUse(props.messages, props.vocab);
  const collectionCards = cardsWithUsage.filter((card) => collection === "quickAssist" ? card.source === "QuickAssist" : card.source !== "QuickAssist");
  const effectiveSort = collection === "quickAssist" && sort === "frequency" ? "date" : sort;
  const sortedCards = [...collectionCards].sort((a, b) => {
    if (effectiveSort === "alphabet") return a.expression.localeCompare(b.expression);
    if (effectiveSort === "frequency") return b.usageCount - a.usageCount || a.expression.localeCompare(b.expression);
    if (effectiveSort === "favorite") return Number(b.favorite) - Number(a.favorite) || a.expression.localeCompare(b.expression);
    return b.createdAt - a.createdAt;
  }).filter((card) => effectiveSort !== "favorite" || card.favorite);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  function cardLetter(card: VocabCard) {
    return (card.expression.trim().match(/[A-Za-z]/)?.[0] ?? "").toUpperCase();
  }

  function scrollToLetter(letter: string, behavior: ScrollBehavior = "auto") {
    setSort("alphabet");
    const target = sortedCards.find((card) => cardLetter(card) >= letter) ?? sortedCards.find((card) => cardLetter(card));
    if (!target) return;
    window.requestAnimationFrame(() => {
      const container = listRef.current;
      const element = document.getElementById(`vocab-card-${target.id}`);
      if (!container || !element) return;
      container.scrollTo({ top: element.offsetTop - container.offsetTop, behavior });
    });
  }

  function scrubAlphabet(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    const ratio = Math.min(0.999, Math.max(0, y / rect.height));
    const letter = alphabet[Math.floor(ratio * alphabet.length)];
    setActiveRail({ letter, y });
    scrollToLetter(letter);
  }

  return <div className="grid review-layout">
    <div className="screen-heading"><h2>✦ {collection === "quickAssist" ? "Quick Assist" : "Vocabulary List"}</h2><span className="small">{sortedCards.length} cards</span></div>
    <section className="stack review-panel">
      <div className="row">
        <button className={collection === "vocabulary" ? "primary" : "ghost"} onClick={() => setCollection("vocabulary")}>Vocabulary</button>
        <button className={collection === "quickAssist" ? "primary" : "ghost"} onClick={() => setCollection("quickAssist")}>Quick Assist</button>
      </div>
      <div className="row">
        <span className="small muted">並び順</span>
        <button className={effectiveSort === "date" ? "primary" : "ghost"} onClick={() => setSort("date")}>日付</button>
        <button className={effectiveSort === "alphabet" ? "primary" : "ghost"} onClick={() => setSort("alphabet")}>ABC</button>
        {collection === "vocabulary" && <button className={effectiveSort === "frequency" ? "primary" : "ghost"} onClick={() => setSort("frequency")}>頻度</button>}
        <button className={effectiveSort === "favorite" ? "primary" : "ghost"} onClick={() => setSort("favorite")}>★</button>
        <button className="icon-button ghost add-toggle" title="手動追加" onClick={() => setShowAdd((current) => !current)}><Plus size={19} /></button>
      </div>
      {showAdd && <div className="manual-add stack">
        <div className="split">
          <input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="expression" />
          <input value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="meaning" />
        </div>
        <button className="primary" onClick={async () => {
          if (!expression.trim()) return;
          await saveVocabCard({ expression: expression.trim(), meaning: meaning.trim(), source: "Manual" });
          setExpression("");
          setMeaning("");
          setShowAdd(false);
          await props.onReload();
        }}>手動追加</button>
      </div>}
      {!sortedCards.length && <p className="muted">{collection === "quickAssist" ? "Quick Assistで選んだ表現はまだありません。" : "まだカードがありません。会話すると表現がここに貯まります。"}</p>}
      <div className="review-list-wrap">
        <div className="review-list stack" ref={listRef}>
          {sortedCards.map((card) => <article className="card vocab-card compact-vocab" data-usage-tier={usageTier(card.usageCount)} id={`vocab-card-${card.id}`} key={card.id}>
            <div className="vocab-main">
              <h3>{card.expression}</h3>
              <p className="muted">{card.meaning || "意味は未設定です。"} <span>{new Date(card.createdAt).toLocaleDateString()}</span></p>
            </div>
            <div className="vocab-actions">
              <button className="icon-button ghost" title="Favorite" onClick={async () => { await setEquivalentVocabFavorite(card, !card.favorite); await props.onReload(); }}><Star size={20} fill={card.favorite ? "currentColor" : "none"} /></button>
              <button className="icon-button danger ghost" title="Delete" onClick={async () => { await deleteEquivalentVocabCard(card); await props.onReload(); }}><Trash2 size={20} /></button>
            </div>
          </article>)}
        </div>
        {collection === "vocabulary" && sortedCards.length > 0 && <div
          className="alphabet-rail"
          role="slider"
          aria-label="Alphabet quick scroll"
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubAlphabet(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons) scrubAlphabet(event);
          }}
          onPointerUp={() => setActiveRail(null)}
          onPointerCancel={() => setActiveRail(null)}
        >
          {activeRail && <span className="alphabet-bubble" style={{ top: activeRail.y }}>{activeRail.letter}</span>}
          {alphabet.map((letter) => <button className={collectionCards.some((card) => cardLetter(card) === letter) ? "" : "dim"} key={letter} onClick={() => scrollToLetter(letter, "smooth")}>{letter}</button>)}
        </div>}
      </div>
    </section>
  </div>;
}

function usageTier(usageCount: number) {
  if (usageCount >= 15) return "5";
  if (usageCount >= 9) return "4";
  if (usageCount >= 5) return "3";
  if (usageCount >= 2) return "2";
  return "1";
}

function ProgressTab(props: { progress: ReturnType<typeof localProgress>; analyses: ConversationAnalysis[]; canAnalyze: boolean; onAnalyze: () => void; onPractice: (prompt: string) => void }) {
  const latest = props.analyses[0];
  const weekLabels = ["木", "金", "土", "日", "月", "火", "水"];
  return <div className="stack">
    <div className="screen-heading"><h2>✦ Progress</h2></div>
    <section className="panel progress-panel stack">
      <div className="streak-hero">
        <strong>{props.progress.streak > 0 ? `${props.progress.streak}日` : "今日から始めよう"}</strong>
        <span>continuous study streak</span>
      </div>
      <div className="week-card">
        <strong>この7日間</strong>
        <div className="week-row">
          {weekLabels.map((label, index) => <span className={index === weekLabels.length - 1 && props.progress.streak > 0 ? "active" : ""} key={label}><i />{label}</span>)}
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="累計学習日" value={`${props.progress.studyDays}日`} />
        <Metric label="累計ターン" value={`${props.progress.userTurns}`} />
        <Metric label="単語帳のカード" value={`${props.progress.savedExpressions}`} />
        <Metric label="お気に入り ★" value={`${props.progress.favoriteCount}`} />
      </div>
    </section>
    <section className="panel stack english-profile">
      <div className="section-title english-profile-title"><h2>✦ Your English Profile</h2><button className="primary" disabled={!props.canAnalyze} onClick={props.onAnalyze}><Sparkles size={16} /> 会話を分析</button></div>
      {!latest && <p className="muted">20発話以上で分析できます。分析結果はこのブラウザ内へ保存されます。</p>}
      {latest && <>
        <div className="analysis-card">
          <div className="section-title"><strong>{new Date(latest.createdAt).toLocaleString()}</strong><strong>CEFR {latest.result.estimatedCefr}</strong></div>
          <p className="small muted">{latest.userMessageCount}発話 / {latest.model}</p>
          <p>{latest.result.summary}</p>
        </div>
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
  status: SettingsStatus;
  onSettings: (patch: Partial<AppSettings>) => void;
  onDailyNewsNotificationToggle: (enabled: boolean) => void;
  onSaveApiKey: () => void;
  onClearApiKey: () => void;
  onTestConnection: () => void;
  onExport: () => void;
  onRestore: (file?: File) => void;
  onReplayOnboarding: () => void;
  onClearLearning: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>("system");
  const selectedCefrGuide = CEFR_GUIDE.find((item) => item.level === props.settings.englishLevel) ?? CEFR_GUIDE[0];
  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: "system", label: "システム設定" },
    { id: "coach", label: "レベル、コーチ設定" },
    { id: "backup", label: "バックアップ／復元" },
    { id: "data", label: "データ削除" },
    { id: "help", label: "ヘルプ" },
    { id: "about", label: "About" }
  ];
  return <div className="stack">
    <div className="screen-heading"><h2>✦ Settings</h2></div>
    <section className="panel stack settings-panel">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {sections.map((item) => <button key={item.id} className={section === item.id ? "primary" : "ghost"} onClick={() => setSection(item.id)}>{item.label}</button>)}
      </div>
      {section === "system" && <div className="stack">
        <article className="card stack">
          <div className="section-title"><h3><KeyRound size={18} /> Gemini API Key</h3><span className="small">{props.settings.hasApiKey ? "保存済み" : "未設定"}</span></div>
          <p className="small muted">BYOKey LabはAPIキーを受信、保存、閲覧するためのアプリケーションサーバーやデータベースを持たず、通常利用時に利用者のAPIキーを保存・把握しません。コードはGitHubで公開し、データの保存先、通信先、APIキーの取扱いを確認できるようにしています。</p>
          <p className="small"><ShieldAlert size={15} /> クライアント側にAPIキーを入力する構成は、Google公式の一般的なセキュリティ推奨とは異なります。理解・納得できる方のみ利用してください。</p>
          <label>Model<select value={props.settings.model} onChange={(event) => props.onSettings({ model: event.target.value })}>{GEMINI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " (Recommended)" : ""}</option>)}</select></label>
          <div className="split">
            <select value={props.settings.apiKeyMode} onChange={(event) => props.onSettings({ apiKeyMode: event.target.value as AppSettings["apiKeyMode"] })}>
              <option value="persistent">このブラウザに保存</option>
              <option value="session">このセッションだけ</option>
            </select>
            <input type="password" autoComplete="off" value={props.apiKeyDraft} onChange={(event) => props.setApiKeyDraft(event.target.value)} placeholder={props.settings.hasApiKey ? "ブラウザに保存済み" : "Gemini API key"} />
          </div>
          <div className="row">
            <button className="primary" onClick={props.onSaveApiKey}>保存</button>
            <button onClick={props.onTestConnection}>接続テスト</button>
            <button className="danger ghost" onClick={props.onClearApiKey}>APIキー削除</button>
            <a href={LINKS.googleAiStudio} target="_blank" rel="noreferrer">Gemini APIキーを取得する <ExternalLink size={14} /></a>
          </div>
          <InlineStatus status={props.status} section="api" />
        </article>
        <article className="card stack">
          <div className="section-title"><h3>Daily News通知</h3><label className="switch"><input type="checkbox" checked={props.settings.dailyNewsNotificationsEnabled} onChange={(event) => props.onDailyNewsNotificationToggle(event.target.checked)} /><span /></label></div>
          <p className="small muted">オンにすると、毎朝6:30頃にDaily Newsの配信をお知らせします。PWAでは端末・ブラウザの通知許可と起動状態により、通知が制限される場合があります。</p>
          <InlineStatus status={props.status} section="system" />
        </article>
        <article className="card stack">
          <h3>表示と音</h3>
          <div className="row">
            <button className={props.settings.theme === "light" ? "primary" : "ghost"} onClick={() => props.onSettings({ theme: "light" })}>Light</button>
            <button className={props.settings.theme === "dark" ? "primary" : "ghost"} onClick={() => props.onSettings({ theme: "dark" })}>Dark</button>
            <button onClick={() => props.onSettings({ soundEffectsEnabled: !props.settings.soundEffectsEnabled })}>{props.settings.soundEffectsEnabled ? "効果音 ON" : "効果音 OFF"}</button>
          </div>
          <p className="small muted">効果音はブラウザのメディア音量に従います。端末やOSによってはマナーモード検知に制限があります。</p>
        </article>
      </div>}
      {section === "coach" && <div className="stack">
        <article className="grid settings-grid">
          <label>Voice mode<select value={props.settings.voiceMode} onChange={(event) => props.onSettings({ voiceMode: event.target.value as AppSettings["voiceMode"] })}><option value="off">Off</option><option value="manual">手動送信</option><option value="fullAuto">Full Auto</option></select></label>
          <label>Voice<select value={props.settings.voiceGender} onChange={(event) => props.onSettings({ voiceGender: event.target.value as AppSettings["voiceGender"] })}><option value="female">Female</option><option value="male">Male</option></select></label>
          <label>読み上げ速度 <span className="small muted">{props.settings.voiceRate.toFixed(1)}x</span><input type="range" min="0.6" max="1.5" step="0.1" value={props.settings.voiceRate} onChange={(event) => props.onSettings({ voiceRate: Number(event.target.value) })} /></label>
        </article>
        <article className="card stack cefr-guide">
          <h3>CEFRレベルの目安</h3>
          <div className="cefr-chip-row" role="listbox" aria-label="CEFR level">
            {CEFR_GUIDE.map((item) => <button
              key={item.level}
              className={props.settings.englishLevel === item.level ? "primary" : "ghost"}
              onClick={() => props.onSettings({ englishLevel: item.level })}
            >{item.level}</button>)}
          </div>
          <div className="cefr-selected-card">
            <strong>{selectedCefrGuide.level}</strong>
            <div><p>{selectedCefrGuide.overview}</p><p className="small muted">出力の目安：{selectedCefrGuide.output}</p></div>
          </div>
        </article>
        <label>Coach Skills<textarea rows={10} value={props.settings.coachSkills} onChange={(event) => props.onSettings({ coachSkills: event.target.value })} /></label>
        <InlineStatus status={props.status} section="coach" />
        <InlineStatus status={props.status} section="conversation" />
      </div>}
      {section === "backup" && <div className="stack">
        <p className="small muted">暗号化バックアップにはAPIキーを含めません。機種変更や別ブラウザではAPIキーを再入力してください。</p>
        <input type="password" value={props.backupPassphrase} onChange={(event) => props.setBackupPassphrase(event.target.value)} placeholder="8文字以上のバックアップ用パスフレーズ" />
        <div className="row">
          <button onClick={props.onExport}><Download size={15} /> Export</button>
          <label><span className="buttonlike"><Upload size={15} /> Restore</span><input hidden type="file" accept="application/json" onChange={(event) => props.onRestore(event.target.files?.[0])} /></label>
        </div>
        <InlineStatus status={props.status} section="backup" />
      </div>}
      {section === "data" && <div className="stack">
        <p className="small muted">会話、Vocabulary、進捗、分析を削除します。APIキーと基本設定は残します。</p>
        <button className="danger ghost" onClick={props.onClearLearning}>学習データ削除</button>
        <InlineStatus status={props.status} section="data" />
      </div>}
      {section === "help" && <div className="stack">
        <button onClick={props.onReplayOnboarding}>初回案内を再表示</button>
        <InfoLink href={LINKS.apiGuide} label="API設定ガイド" />
        <InfoLink href={LINKS.support} label="Support" />
      </div>}
      {section === "about" && <div className="stack">
        <InfoLink href={LINKS.officialSite} label="BYOKey Lab公式サイト" />
        <InfoLink href={LINKS.github} label="GitHub Source" icon={<Github size={15} />} />
        <InfoLink href={LINKS.privacy} label="Privacy Policy" />
        <InfoLink href={LINKS.terms} label="Terms" />
        <p className="small muted">Version {BUILD_INFO.version} / Commit {BUILD_INFO.commitSha} / Build {BUILD_INFO.buildTime}</p>
        <InlineStatus status={props.status} section="about" />
      </div>}
    </section>
  </div>;
}

const CEFR_GUIDE: Array<{ level: AppSettings["englishLevel"]; overview: string; output: string }> = [
  { level: "A1", overview: "学習を始めた段階。身近な単語と短い定型表現を中心に会話します。", output: "1文8語以内を基本に、質問は1つ。難しい語には短い日本語ヒントを付けます。" },
  { level: "A2", overview: "身近な話題なら、簡単な受け答えを続けられる段階です。", output: "1文12語以内を基本に、接続詞を使った短い文と新しい表現を1つ提示します。" },
  { level: "B1", overview: "経験・理由・意見を、日常的な英語で説明できる段階です。", output: "1文15語程度で会話し、一般的なイディオムには短い説明を添えます。" },
  { level: "B2", overview: "幅広い話題で、比較や議論を含む自然な会話ができる段階です。", output: "文法を過度に簡略化せず、ニュアンスや一般的なイディオムも使います。" },
  { level: "C1", overview: "抽象的な話題でも、目的に合う表現を柔軟に使える段階です。", output: "正確で自然な英語を使い、語調・文体・細かなニュアンスも扱います。" },
  { level: "C2", overview: "ほぼすべての話題を、細かな意味の違いまで表現できる段階です。", output: "簡略化せず、自然なリズム、含意、文体、イディオムまで含めて応答します。" }
];

function InlineStatus(props: { status: SettingsStatus; section: NonNullable<SettingsStatus>["section"] }) {
  if (!props.status || props.status.section !== props.section) return null;
  return <p className={`inline-status small ${props.status.kind}`}>{props.status.text}</p>;
}

function InfoLink(props: { href: string; label: string; icon?: React.ReactNode }) {
  return <a className="card row" href={props.href} target="_blank" rel="noreferrer">{props.icon ?? <ExternalLink size={15} />} {props.label}</a>;
}

function compactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const firstPath = url.pathname.split("/").filter(Boolean)[0];
    return firstPath ? `${url.hostname}/${firstPath}/…` : url.hostname;
  } catch {
    return "source link";
  }
}

function renderTextWithCompactLinks(text: string) {
  const pattern = /(https?:\/\/[^\s]+)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const raw = match[0];
    const trailing = raw.match(/[),.。]+$/)?.[0] ?? "";
    const href = trailing ? raw.slice(0, -trailing.length) : raw;
    nodes.push(<a className="compact-link" key={`${href}-${match.index}`} href={href} target="_blank" rel="noreferrer">{compactUrl(href)}</a>);
    if (trailing) nodes.push(trailing);
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function AssistModal(props: {
  assist: { open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> };
  setAssist: (value: { open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> }) => void;
  runAssist: () => void;
  adopt: (english: string) => void;
  onMic: () => void;
}) {
  return <div className="modal-backdrop">
    <section className="modal stack">
      <div className="section-title"><h2>Quick Assist</h2><button className="icon-button ghost" onClick={() => props.setAssist({ open: false, stuck: "", suggestions: [] })}>×</button></div>
      <textarea rows={3} value={props.assist.stuck} onChange={(event) => props.setAssist({ ...props.assist, stuck: event.target.value })} placeholder="日本語でも英語でも、言いたいことを書いてください。" />
      <div className="row">
        <button className="primary" onClick={props.runAssist}><Sparkles size={15} /> 候補を出す</button>
        <button disabled={!canRecognizeSpeech()} onClick={props.onMic}><Mic size={15} /> 日本語で話す</button>
      </div>
      {props.assist.suggestions.map((suggestion) => <article className="card stack" key={suggestion.english}>
        <strong>{suggestion.english}</strong>
        <span className="small muted">{suggestion.note}</span>
        <button onClick={() => props.adopt(suggestion.english)}>入力欄へ追記</button>
      </article>)}
    </section>
  </div>;
}
