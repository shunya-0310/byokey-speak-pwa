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
  Maximize2,
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
import { StudyCalendarBottomSheet, VocabularyHistoryBottomSheet } from "./ProgressDetails";
import { SplashOverlay } from "./SplashOverlay";
import {
  GEMINI_MODELS,
  GEMINI_LIVE_MODELS,
  GEMINI_TTS_MODELS,
  GEMINI_TTS_VOICES,
  type AppSettings,
  type Chat,
  type ChatMessage,
  type ConversationAnalysis,
  type DailyStat,
  type LearningNote,
  type VocabCard
} from "../domain/models";
import { buildAnalysisPrompt, buildConversationPrompt, buildQuickAssistPrompt, buildTranslationPrompt, parseAssistSuggestions } from "../domain/prompts";
import { countActiveVocabularyUse, deriveChatTitle, localProgress, naturalReplyOf } from "../domain/stats";
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
import { generateSpeechWithGemini, generateWithGemini, parseAnalysis, parseCoachReply, transcribeAudioWithGemini, userMessageForError, type LlmError } from "../infrastructure/gemini";
import { loadDailyNews, newsHiddenContext, newsVisibleOpener } from "../infrastructure/news";
import { startGeminiLiveSession, type GeminiLiveSession, type GeminiLiveStatus } from "../infrastructure/live";
import { isPreviewOrigin, isTrustedPersistentOrigin } from "../infrastructure/pwa";
import { trackAnalyticsEvent } from "../infrastructure/analytics";
import { canRecordAudio, canRecognizeSpeech, playGeneratedSpeech, shouldUseGeminiMicFallback, speakCoachText, startSpeechRecognitionSession, startWavRecorder, stopSpeaking, type MicLanguage, type SpeechRecognitionSession, type WavRecorder } from "../infrastructure/speech";
import { playAppSound, primeAppSounds, type AppSound } from "../infrastructure/sound";
import type { DailyNewsFeed, DailyNewsItem } from "../domain/schemas";

type Tab = "chats" | "review" | "progress" | "settings";
type ChatPage = "list" | "conversation";
type SettingsStatus = { section: "api" | "conversation" | "backup" | "about" | "system" | "coach" | "data" | "help"; kind: "ok" | "error" | "info"; text: string } | null;
type SettingsSection = "system" | "coach" | "backup" | "data" | "help" | "about";
type SplashMode = "postOnboarding" | null;
type TutorialKind = "chats" | "chatControls" | "vocabulary" | "progress" | "settings";
type LiveTranscriptLine = { role: "user" | "coach"; text: string };

const TUTORIAL_SEEN_KEY = "byokey-speak-tutorials-seen";
const TUTORIAL_TARGETS = {
  chatsDailyNews: "chats_daily_news",
  chatsNewChat: "chats_new_chat",
  chatAutoMode: "chat_auto_mode",
  chatQuickAssist: "chat_quick_assist",
  chatWebSearch: "chat_web_search",
  chatMic: "chat_mic",
  vocabularyList: "vocabulary_list",
  vocabularyCard: "vocabulary_card",
  vocabularyAdd: "vocabulary_add",
  progressAnalysis: "progress_analysis",
  progressPractice: "progress_practice",
  settingsApiKey: "settings_api_key",
  settingsApiKeyInput: "settings_api_key_input",
  settingsHelp: "settings_help",
  settingsCoach: "settings_coach",
  settingsCefr: "settings_cefr",
  settingsCoachSkill: "settings_coach_skill"
} as const;

type TutorialStep = {
  kind: TutorialKind;
  title: string;
  message: string;
  targetId?: string;
  tab: Tab;
  chatPage?: ChatPage;
  settingsSection?: SettingsSection;
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    kind: "chats",
    title: "TODAY'S WORLD",
    message: "毎朝世界のトップニュースが配信されます。気になる記事の Talk から、その話題でChatを立ち上げられます。",
    targetId: TUTORIAL_TARGETS.chatsDailyNews,
    tab: "chats",
    chatPage: "list"
  },
  {
    kind: "chats",
    title: "+ New Chat",
    message: "ニュース以外の話題で話したいときは、新しい会話をここから始めます。",
    targetId: TUTORIAL_TARGETS.chatsNewChat,
    tab: "chats",
    chatPage: "list"
  },
  {
    kind: "chatControls",
    title: "ヘッドフォン",
    message: "タップするたびに通常、マニュアル送信、フルオートへ切り替わります。マニュアル送信では読み上げ後にマイクが起動し、フルオートでは音声入力後の送信まで自動で行います。",
    targetId: TUTORIAL_TARGETS.chatAutoMode,
    tab: "chats",
    chatPage: "conversation"
  },
  {
    kind: "chatControls",
    title: "キラキラ",
    message: "Quick Assistです。言葉に詰まったとき、日本語で聞くと短い英語候補を出します。",
    targetId: TUTORIAL_TARGETS.chatQuickAssist,
    tab: "chats",
    chatPage: "conversation"
  },
  {
    kind: "chatControls",
    title: "地球マーク",
    message: "最新の話題など、検索を伴うチャットをしたいときにオンにします。",
    targetId: TUTORIAL_TARGETS.chatWebSearch,
    tab: "chats",
    chatPage: "conversation"
  },
  {
    kind: "chatControls",
    title: "マイク",
    message: "「英」は英語認識、「日」は日本語認識の音声入力です。話す言語に合わせて選べます。",
    targetId: TUTORIAL_TARGETS.chatMic,
    tab: "chats",
    chatPage: "conversation"
  },
  {
    kind: "vocabulary",
    title: "Vocabulary List",
    message: "Chatで登場した単語やイディオムは自動で登録されます。",
    targetId: TUTORIAL_TARGETS.vocabularyList,
    tab: "review"
  },
  {
    kind: "vocabulary",
    title: "Card color",
    message: "頻出する用語は、会話で出るほど色が濃くなっていきます。",
    targetId: TUTORIAL_TARGETS.vocabularyCard,
    tab: "review"
  },
  {
    kind: "vocabulary",
    title: "＋",
    message: "必要な単語は＋ボタンから手動でも登録できます。",
    targetId: TUTORIAL_TARGETS.vocabularyAdd,
    tab: "review"
  },
  {
    kind: "progress",
    title: "Conversation Analysis",
    message: "会話の履歴が溜まったら、Progress画面から自分の話し方の特徴や多い失敗を分析できます。",
    targetId: TUTORIAL_TARGETS.progressAnalysis,
    tab: "progress"
  },
  {
    kind: "progress",
    title: "Practice",
    message: "分析結果はカードで保存されます。詳細から、苦手な表現を練習する会話も始められます。",
    targetId: TUTORIAL_TARGETS.progressPractice,
    tab: "progress"
  },
  {
    kind: "settings",
    title: "API Key",
    message: "ここにGemini APIキーを入力します。APIキーはBYOKey Labのサーバーには送られず、このブラウザ内またはセッション内に保存されます。",
    targetId: TUTORIAL_TARGETS.settingsApiKeyInput,
    tab: "settings",
    settingsSection: "system"
  },
  {
    kind: "settings",
    title: "ヘルプ",
    message: "APIキーの取得方法がわからない場合は、ここをタップして設定ガイドを確認できます。初回案内やチュートリアルもここから再表示できます。",
    targetId: TUTORIAL_TARGETS.settingsHelp,
    tab: "settings",
    settingsSection: "help"
  },
  {
    kind: "settings",
    title: "レベル、コーチ設定",
    message: "会話レベルやコーチの話し方は「レベル、コーチ設定」で変更できます。",
    targetId: TUTORIAL_TARGETS.settingsCoach,
    tab: "settings",
    settingsSection: "coach"
  },
  {
    kind: "settings",
    title: "CEFRレベル",
    message: "CEFRレベルを選ぶと、会話の語彙・文法・返答の難しさを調整できます。",
    targetId: TUTORIAL_TARGETS.settingsCefr,
    tab: "settings",
    settingsSection: "coach"
  },
  {
    kind: "settings",
    title: "Coach Personalities & Skills",
    message: "性格、話し方、添削方法、解説の詳しさなどを自由に指定できます。",
    targetId: TUTORIAL_TARGETS.settingsCoachSkill,
    tab: "settings",
    settingsSection: "coach"
  }
];

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
    body: [
      "BYOKey SpeakはGoogleのAIモデル「Gemini」を使って英会話を楽しむブラウザアプリです。",
      "一般的なAI英会話では実現しにくい、あなた専属のコーチ像を「あなたの言葉で」「自由に」設定して会話を楽しむことができます。",
      "誰か偉人を呼び出して会話をするのも面白いかもしれませんね！",
      "会話のレベルはCEFR A1〜C2まで対応しており、これも自由に設定可能です。"
    ],
    image: "/images/onboarding/onboarding_bg_1.jpg"
  },
  {
    title: "BYOKの流れ",
    body: [
      "BYOKとはBring Your Own Keyの略です。",
      "「APIキー」と呼ばれる合鍵を作成し、これを利用して会話をする仕組みです。Googleアカウントがあれば簡単に作成でき、使用量に応じて料金がかかる従量課金制となっています。",
      "APIキーの取得方法はアプリ内ヘルプから閲覧可能です。",
      "会話はあなたのブラウザからGemini APIへ直接送信され、BYOKey Labのサーバーは経由しません。BYOKey LabがあなたのAPIキーを取得・保存、問い合わせることもありません。",
      "利用料の参考情報は以下のサイトをご参照ください。ただし、費用は会話の回数だけでなく文章量や使い方によっても異なるため、都度Google Cloud コンソールにて利用料を確認してください。"
    ],
    image: "/images/onboarding/onboarding_bg_2.jpg"
  },
  {
    title: "APIキーの重要な注意",
    body: [
      "APIキーはGemini API利用権限に紐づく重要な情報です。",
      "Googleは、ブラウザやモバイルアプリなどにAPIキーを入力して使用する構成を、セキュリティリスクの観点から一般には推奨していません。",
      "本アプリはBYOK方式として、利用者自身がこのリスクを理解し、自分のキーを自分の責任で入力する設計です。",
      "安全に利用するためには、①本アプリ専用のAPIキーを作成し、②利用制限（上限）を設定し、③随時利用量を確認し、④定期的にAPIキーを更新することを推奨します。",
      "この説明は2026年8月11日時点の情報です。"
    ],
    image: "/images/onboarding/onboarding_bg_3.jpg"
  },
  {
    title: "データの保存について",
    body: [
      "あなたのAPIキー、会話履歴、単語メモ、学習の進み具合は、この端末のブラウザ内に保存されます。BYOKey Labのサーバーへ送られるものではありません。",
      "ただし、アプリをアンインストールしたり、ブラウザのキャッシュやサイトデータを削除したり、別の端末へ移ったりすると、保存した内容をそのまま使えなくなることがあります。",
      "大切な学習データは、アプリ内のバックアップ機能で書き出し、必要なときに復元できます。",
      "バックアップにはAPIキーを含めないため、APIキーだけは新しい端末やブラウザで再入力してください。"
    ],
    image: "/images/onboarding/onboarding_bg_4.jpg"
  },
  {
    title: "さあ、はじめましょう",
    body: [
      "設定画面からGeminiモデルの選択、APIキーの設定、会話レベル／コーチの性格などの設定を行いましょう。",
      "BYOKによる一段上の体験を実感してください。",
      "ご利用にあたっては、前段のリスクとAI利用による会話内容の外部送信についての同意をお願いいたします。"
    ],
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
  const [splashMode, setSplashMode] = useState<SplashMode>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(() => localStorage.getItem("byokey-install-banner-dismissed") === "1");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("system");
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [tutorialReplayMode, setTutorialReplayMode] = useState(false);
  const [recordingMic, setRecordingMic] = useState<{ target: "chat" | "assist"; language: MicLanguage } | null>(null);
  const wavRecorderRef = useRef<WavRecorder | null>(null);
  const speechSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const micContextRef = useRef<{ target: "chat" | "assist"; language: MicLanguage; autoSubmit: boolean; baseSource: ChatMessage["inputSource"] } | null>(null);
  const autoSubmitTimerRef = useRef<number | null>(null);
  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  const liveInputTranscriptRef = useRef("");
  const liveOutputTranscriptRef = useRef("");
  const [liveStatus, setLiveStatus] = useState<GeminiLiveStatus>("closed");
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptLine[]>([]);
  const [tutorialSeen, setTutorialSeen] = useState<Record<TutorialKind, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(TUTORIAL_SEEN_KEY) ?? "{}") as Record<TutorialKind, boolean>;
    } catch {
      return {} as Record<TutorialKind, boolean>;
    }
  });

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
    const hasUserCreatedChatData = chats.some((chat) => chat.origin !== "FREE_CHAT" || chat.title !== "New chat" || Boolean(chat.newsContext));
    const hasExistingLocalData = settings.onboardingDone
      || settings.hasApiKey
      || messages.length > 0
      || vocab.length > 0
      || notes.length > 0
      || stats.length > 0
      || analyses.length > 0
      || hasUserCreatedChatData;
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

  function markTutorialKindSeen(kind: TutorialKind) {
    setTutorialSeen((current) => {
      const next = { ...current, [kind]: true };
      localStorage.setItem(TUTORIAL_SEEN_KEY, JSON.stringify(next));
      return next;
    });
  }

  function closeTutorial() {
    if (tutorialStep === null) return;
    const currentKind = TUTORIAL_STEPS[tutorialStep]?.kind;
    if (currentKind && !tutorialReplayMode) markTutorialKindSeen(currentKind);
    setTutorialStep(null);
    setTutorialReplayMode(false);
  }

  function nextTutorialStep() {
    if (tutorialStep === null) return;
    const current = TUTORIAL_STEPS[tutorialStep];
    const nextIndex = tutorialStep + 1;
    if (!tutorialReplayMode) {
      const next = TUTORIAL_STEPS[nextIndex];
      if (!next || next.kind !== current.kind) {
        markTutorialKindSeen(current.kind);
        setTutorialStep(null);
        return;
      }
    }
    if (nextIndex >= TUTORIAL_STEPS.length) {
      if (current) markTutorialKindSeen(current.kind);
      setTutorialStep(null);
      setTutorialReplayMode(false);
      return;
    }
    if (current && TUTORIAL_STEPS[nextIndex].kind !== current.kind) markTutorialKindSeen(current.kind);
    setTutorialStep(nextIndex);
  }

  function replayTutorials() {
    localStorage.removeItem(TUTORIAL_SEEN_KEY);
    setTutorialSeen({} as Record<TutorialKind, boolean>);
    setTutorialReplayMode(true);
    setTutorialStep(0);
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
    return () => {
      liveSessionRef.current?.stop();
      liveSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallBannerDismissed(false);
      trackAnalyticsEvent("pwa_install_prompt_available");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setInstallPrompt(null);
      setInstallBannerDismissed(true);
      trackAnalyticsEvent("pwa_installed");
    };
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, []);

  useEffect(() => {
    if (showOnboarding || !data || tutorialStep !== null) return;
    const kindByTab: Record<Tab, TutorialKind> = {
      chats: chatPage === "conversation" ? "chatControls" : "chats",
      review: "vocabulary",
      progress: "progress",
      settings: "settings"
    };
    const kind = kindByTab[activeTab];
    if (tutorialSeen[kind]) return;
    const index = TUTORIAL_STEPS.findIndex((step) => step.kind === kind);
    if (index >= 0) setTutorialStep(index);
  }, [activeTab, chatPage, data, showOnboarding, tutorialSeen, tutorialStep]);

  useEffect(() => {
    if (tutorialStep === null) return;
    const step = TUTORIAL_STEPS[tutorialStep];
    if (!step) return;
    if (activeTab !== step.tab) setActiveTab(step.tab);
    if (step.chatPage && chatPage !== step.chatPage) setChatPage(step.chatPage);
    if (step.settingsSection && settingsSection !== step.settingsSection) setSettingsSection(step.settingsSection);
  }, [activeTab, chatPage, settingsSection, tutorialStep]);

  if (!data) {
    return <div className="app app-boot" aria-label="BYOKey Speak loading" />;
  }

  const currentData = data;
  const activeChat = currentData.chats.find((chat) => chat.id === activeChatId);
  const chatMessages = currentData.messages.filter((message) => message.chatId === activeChatId);
  const progress = localProgress(currentData.stats, currentData.messages, currentData.vocab);
  const canSendToGemini = currentData.settings.consentVersion >= 1 && currentData.settings.hasApiKey;
  const showInstallBanner = !installBannerDismissed && !isStandaloneDisplay() && tutorialStep === null;

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

  async function applyMicTranscript(text: string, context: { target: "chat" | "assist"; autoSubmit: boolean; baseSource: ChatMessage["inputSource"] }) {
    const spoken = text.trim();
    if (!spoken) {
      setNotice("音声を認識できませんでした。もう一度お試しください。");
      return;
    }
    if (context.target === "assist") {
      setAssist((current) => ({ ...current, stuck: `${current.stuck}${current.stuck ? " " : ""}${spoken}` }));
      setNotice("音声を入力欄へ反映しました。");
      return;
    }
    const next = `${draft}${draft ? " " : ""}${spoken}`.trim();
    if (context.autoSubmit) {
      await sendMessage(mergeInputSource(context.baseSource, "VOICE"), next);
      return;
    }
    appendToDraft(spoken, "VOICE");
    setNotice("音声を入力欄へ反映しました。");
  }

  function clearAutoSubmitTimer() {
    if (autoSubmitTimerRef.current === null) return;
    window.clearTimeout(autoSubmitTimerRef.current);
    autoSubmitTimerRef.current = null;
  }

  function scheduleAutoSubmitAfterSilence() {
    clearAutoSubmitTimer();
    autoSubmitTimerRef.current = window.setTimeout(() => {
      void stopActiveMicRecording();
    }, 4000);
  }

  async function transcribeRecordedAudio(context: { target: "chat" | "assist"; language: MicLanguage; autoSubmit: boolean; baseSource: ChatMessage["inputSource"] }, audio: Blob) {
    if (!canSendToGemini) {
      setActiveTab("settings");
      setError("Gemini文字起こしには、同意とAPIキー設定が必要です。");
      return;
    }
    const apiKey = await getActiveApiKey(currentData.settings.apiKeyMode);
    if (!apiKey) {
      setActiveTab("settings");
      setError("APIキーを再入力してください。");
      return;
    }
    setBusy("Geminiで音声を文字起こし中です");
    try {
      const spoken = await transcribeAudioWithGemini({ apiKey, model: currentData.settings.model, audio, language: context.language });
      await applyMicTranscript(spoken, context);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function stopActiveMicRecording() {
    clearAutoSubmitTimer();
    const context = micContextRef.current;
    if (!recordingMic || !context) return;
    setRecordingMic(null);
    micContextRef.current = null;

    const speechSession = speechSessionRef.current;
    if (speechSession) {
      speechSessionRef.current = null;
      try {
        const spoken = await speechSession.stop();
        await applyMicTranscript(spoken, context);
      } catch (caught) {
        setError((caught as Error).message);
      }
      return;
    }

    const recorder = wavRecorderRef.current;
    if (!recorder) return;
    wavRecorderRef.current = null;
    try {
      const audio = await recorder.stop();
      await transcribeRecordedAudio(context, audio);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function startGeminiMicRecording(target: "chat" | "assist", language: MicLanguage, autoSubmit = false, baseSource: ChatMessage["inputSource"] = "VOICE") {
    if (!canRecordAudio()) {
      setError("このブラウザではマイク録音を開始できません。OSキーボードの音声入力をご利用ください。");
      return;
    }
    if (recordingMic) {
      await stopActiveMicRecording();
      return;
    }
    try {
      wavRecorderRef.current = await startWavRecorder();
      micContextRef.current = { target, language, autoSubmit, baseSource };
      setRecordingMic({ target, language });
      setNotice("録音中です。もう一度マイクを押すと停止して文字起こしします。");
    } catch (caught) {
      setError(`マイク録音を開始できませんでした。iPhoneのSafari/サイト設定でマイク許可を確認してください。${(caught as Error).message ? ` ${(caught as Error).message}` : ""}`);
    }
  }

  function startBrowserMicRecording(target: "chat" | "assist", language: MicLanguage, autoSubmit = false, baseSource: ChatMessage["inputSource"] = "VOICE") {
    if (recordingMic) {
      void stopActiveMicRecording();
      return;
    }
    try {
      micContextRef.current = { target, language, autoSubmit, baseSource };
      speechSessionRef.current = startSpeechRecognitionSession(language, (text) => {
        if (text && autoSubmit) scheduleAutoSubmitAfterSilence();
      }, (error) => {
        clearAutoSubmitTimer();
        speechSessionRef.current = null;
        micContextRef.current = null;
        setRecordingMic(null);
        setError(error.message);
      });
      setRecordingMic({ target, language });
      setNotice(autoSubmit ? "音声入力中です。話し終わると数秒後に自動送信します。マイクを押すとすぐ送信します。" : "音声入力中です。話し終わったら、もう一度マイクを押して確定してください。");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function handleMicInput(target: "chat" | "assist", language: MicLanguage, autoSubmit = false, baseSource: ChatMessage["inputSource"] = "VOICE") {
    if (recordingMic) {
      await stopActiveMicRecording();
      return;
    }
    if (shouldUseGeminiMicFallback()) {
      await startGeminiMicRecording(target, language, autoSubmit, baseSource);
      return;
    }
    startBrowserMicRecording(target, language, autoSubmit, baseSource);
  }

  async function cycleVoiceMode() {
    const next = nextVoiceMode(currentData.settings.voiceMode);
    playSound("select");
    if (currentData.settings.voiceMode === "live" && next !== "live") {
      stopLiveConversation();
    }
    await updateSettings({ voiceMode: next });
    setNotice(next === "off" ? "Voice Mode: Off" : next === "manual" ? "Voice Mode: マニュアル送信" : next === "fullAuto" ? "Voice Mode: フルオート" : "Voice Mode: Gemini Live");
  }

  function toggleWebSearch() {
    setWebSearch((enabled) => {
      const next = !enabled;
      setNotice(next ? "Web検索オン: 検索を伴うチャットを行います。" : "Web検索オフ: 通常のチャットに戻します。");
      return next;
    });
  }

  function stopCurrentSpeech() {
    stopSpeaking();
    setSpeakingMessageId(null);
  }

  async function speakMessage(message: ChatMessage, afterEnd?: () => void) {
    if (currentData.settings.speechOutputProvider === "geminiTts") {
      if (currentData.settings.consentVersion < 1) {
        setActiveTab("settings");
        setError("Gemini TTSには、リスクと外部送信についての同意が必要です。");
        return;
      }
      const apiKey = await getActiveApiKey(currentData.settings.apiKeyMode);
      if (!apiKey) {
        setActiveTab("settings");
        setError("APIキーを再入力してください。");
        return;
      }
      setBusy("Gemini TTSで読み上げ音声を生成中です");
      setSpeakingMessageId(message.id);
      try {
        const speech = await generateSpeechWithGemini({
          apiKey,
          model: currentData.settings.geminiTtsModel,
          text: naturalReplyOf(message.text),
          voice: currentData.settings.geminiTtsVoice
        });
        playGeneratedSpeech({
          base64Audio: speech.data,
          mimeType: speech.mimeType,
          rate: currentData.settings.voiceRate,
          onEnd: () => {
            setSpeakingMessageId((current) => current === message.id ? null : current);
            afterEnd?.();
          }
        });
      } catch (caught) {
        setSpeakingMessageId(null);
        setError((caught as Error).message);
      } finally {
        setBusy("");
      }
      return;
    }
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

  function updateLiveTranscript(role: LiveTranscriptLine["role"], text: string) {
    setLiveTranscript((current) => {
      const next = current.slice();
      if (next[next.length - 1]?.role === role) {
        next[next.length - 1] = { role, text };
      } else {
        next.push({ role, text });
      }
      return next.slice(-8);
    });
  }

  async function persistLiveTurn() {
    const userText = liveInputTranscriptRef.current.trim();
    const coachText = liveOutputTranscriptRef.current.trim();
    liveInputTranscriptRef.current = "";
    liveOutputTranscriptRef.current = "";
    if (!activeChatId || (!userText && !coachText)) return;
    const now = Date.now();
    const entries: ChatMessage[] = [];
    if (userText) {
      entries.push({ id: id("msg"), chatId: activeChatId, role: "user", text: userText, inputSource: "VOICE", usedQuickAssist: false, createdAt: now });
    }
    if (coachText) {
      entries.push({ id: id("msg"), chatId: activeChatId, role: "coach", text: `Natural reply: ${coachText}`, inputSource: "NONE", usedQuickAssist: false, createdAt: now + 1 });
    }
    await db.messages.bulkPut(entries);
    const chatPatch: Partial<Chat> = { updatedAt: Date.now() };
    if (activeChat?.title === "New chat" && userText) chatPatch.title = deriveChatTitle(userText);
    await db.chats.update(activeChatId, chatPatch);
    if (userText) await recordDailyStat({ turns: 1 });
    await reload();
  }

  async function startLiveConversation() {
    if (liveSessionRef.current) {
      stopLiveConversation();
      return;
    }
    if (currentData.settings.consentVersion < 1) {
      setActiveTab("settings");
      setError("Gemini Liveには、リスクと外部送信についての同意が必要です。");
      return;
    }
    const apiKey = await getActiveApiKey(currentData.settings.apiKeyMode);
    if (!apiKey) {
      setActiveTab("settings");
      setError("APIキーを再入力してください。");
      return;
    }
    const instruction = [
      "You are BYOKey Speak, a friendly English conversation coach.",
      `Learner CEFR level: ${currentData.settings.englishLevel}.`,
      "Speak naturally, warmly, and concisely. Keep replies short enough for spoken conversation.",
      "If the learner makes an unnatural expression, correct it briefly in simple Japanese after the natural English reply.",
      currentData.settings.coachSkills
    ].join("\n\n");
    try {
      setLiveTranscript([]);
      liveInputTranscriptRef.current = "";
      liveOutputTranscriptRef.current = "";
      liveSessionRef.current = await startGeminiLiveSession({
        apiKey,
        model: currentData.settings.liveModel,
        voice: currentData.settings.liveVoice,
        systemInstruction: instruction,
        onStatus: setLiveStatus,
        onInputTranscript: (text) => {
          liveInputTranscriptRef.current = text;
          updateLiveTranscript("user", text);
        },
        onOutputTranscript: (text) => {
          liveOutputTranscriptRef.current = text;
          updateLiveTranscript("coach", text);
        },
        onTurnComplete: () => {
          void persistLiveTurn();
        },
        onError: (caught) => {
          setError(caught.message);
          stopLiveConversation();
        }
      });
      setNotice("Gemini Liveを開始しました。話しかけると音声で返答します。");
    } catch (caught) {
      setLiveStatus("closed");
      setError((caught as Error).message);
    }
  }

  function stopLiveConversation() {
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    setLiveStatus("closed");
  }

  async function startAutoEnglishMic(mode: AppSettings["voiceMode"], baseSource: ChatMessage["inputSource"] = "VOICE") {
    if (mode === "off" || mode === "live") return;
    if (shouldUseGeminiMicFallback()) {
      setNotice("この環境では自動マイク開始に制限があります。英マイクを押して録音してください。");
      return;
    }
    startBrowserMicRecording("chat", "en-US", mode === "fullAuto", baseSource);
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
      if (currentData.settings.voiceMode !== "off" && currentData.settings.voiceMode !== "live") {
        void speakMessage(coachMessage, () => {
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
      {showInstallBanner && <section className="install-prompt-layer" aria-live="polite">
        <div className="install-prompt-dialog" role="dialog" aria-modal="false" aria-labelledby="install-prompt-title">
          <div>
            <strong id="install-prompt-title">ホーム画面にインストール</strong>
            <p>BYOKey Speakはインストールして使うと、アプリ版に近い表示で起動できます。</p>
          </div>
          <div className="row nowrap">
            {installPrompt
              ? <button className="primary" onClick={async () => {
                  await installPrompt.prompt();
                  const choice = await installPrompt.userChoice;
                  trackAnalyticsEvent("pwa_install_prompt_choice", { outcome: choice.outcome });
                  if (choice.outcome === "accepted") setInstallPrompt(null);
                }}>インストール</button>
              : <span className="small muted">ブラウザメニューから「ホーム画面に追加」を選んでください。</span>}
            <button className="icon-button ghost" title="閉じる" onClick={() => { localStorage.setItem("byokey-install-banner-dismissed", "1"); setInstallBannerDismissed(true); }}>×</button>
          </div>
        </div>
      </section>}
      {isPreviewOrigin() && <div className="preview-banner small">プレビュー環境です。個人の本番APIキーを入力しないでください。</div>}
      {(notice || error || busy) && <div className="toast-region" aria-live="polite">
        {notice && <p className="toast small">{notice}</p>}
        {error && <p className="toast small danger">{error}</p>}
        {busy && <p className="toast small row"><Loader2 size={16} /> {busy}</p>}
      </div>}
      <main className={`main main-${activeTab}`}>
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
          onWebSearchToggle={toggleWebSearch}
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
          onAssist={() => setAssist((current) => ({ ...current, open: true }))}
          onVoiceModeCycle={cycleVoiceMode}
          onTranslate={translateMessage}
          onReport={reportMessage}
          onSpeak={(message) => void speakMessage(message)}
          onStopSpeak={stopCurrentSpeech}
          recordingMic={recordingMic?.target === "chat" ? recordingMic.language : null}
          micAvailable={canRecognizeSpeech() || canRecordAudio()}
          liveStatus={liveStatus}
          liveTranscript={liveTranscript}
          onLiveToggle={startLiveConversation}
          onMic={async (language) => {
            await handleMicInput("chat", language, data.settings.voiceMode === "fullAuto", draftSource);
          }}
        />}
        {activeTab === "review" && <ReviewTab vocab={data.vocab} messages={data.messages} onReload={reload} />}
        {activeTab === "progress" && <ProgressTab progress={progress} stats={data.stats} vocab={data.vocab} analyses={data.analyses} canAnalyze={canSendToGemini} onAnalyze={async () => {
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
          onReplayTutorials={replayTutorials}
          section={settingsSection}
          setSection={setSettingsSection}
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
      {tutorialStep !== null && <TutorialOverlay
        step={TUTORIAL_STEPS[tutorialStep]}
        stepIndex={tutorialStep}
        totalSteps={tutorialReplayMode
          ? TUTORIAL_STEPS.length
          : TUTORIAL_STEPS.filter((step) => step.kind === TUTORIAL_STEPS[tutorialStep].kind).length}
        localStepIndex={tutorialReplayMode
          ? tutorialStep
          : TUTORIAL_STEPS.filter((step, index) => step.kind === TUTORIAL_STEPS[tutorialStep].kind && index <= tutorialStep).length - 1}
        onClose={closeTutorial}
        onNext={nextTutorialStep}
        isLast={tutorialReplayMode
          ? tutorialStep === TUTORIAL_STEPS.length - 1
          : TUTORIAL_STEPS[tutorialStep + 1]?.kind !== TUTORIAL_STEPS[tutorialStep].kind}
      />}
      {assist.open && <AssistModal
        assist={assist}
        setAssist={setAssist}
        runAssist={runAssist}
        adopt={async (english) => {
          appendToDraft(english, "QUICK_ASSIST");
          await saveVocabCard({ expression: english, meaning: assist.suggestions.find((item) => item.english === english)?.note ?? "", source: "QuickAssist", chatId: activeChatId });
          setAssist((current) => ({ ...current, open: false }));
          await reload();
        }}
        recording={recordingMic?.target === "assist"}
        micAvailable={canRecognizeSpeech() || canRecordAudio()}
        onMic={async () => handleMicInput("assist", "ja-JP")}
      />}
    </div>
  );
}

function TabButton(props: { tab: Tab; active: Tab; setActive: (tab: Tab) => void; icon: React.ReactNode; label: string }) {
  return <button aria-current={props.active === props.tab ? "page" : undefined} onClick={() => props.setActive(props.tab)}>{props.icon}<span>{props.label}</span></button>;
}

function TutorialOverlay(props: {
  step: TutorialStep;
  stepIndex: number;
  localStepIndex: number;
  totalSteps: number;
  isLast: boolean;
  onClose: () => void;
  onNext: () => void;
}) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [calloutHeight, setCalloutHeight] = useState(0);
  const calloutRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function update() {
      const target = props.step.targetId ? document.querySelector<HTMLElement>(`[data-tutorial-id="${props.step.targetId}"]`) : null;
      if (!target) {
        setTargetRect(null);
        return;
      }
      target.scrollIntoView({ block: "center", inline: "nearest" });
      window.requestAnimationFrame(() => setTargetRect(target.getBoundingClientRect()));
    }
    update();
    const timers = [window.setTimeout(update, 180), window.setTimeout(update, 520)];
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [props.step]);

  useEffect(() => {
    const element = calloutRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setCalloutHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frame = targetRect ? paddedFrame(targetRect, 8) : null;
  const calloutTop = (() => {
    const edge = 16;
    const gap = 30;
    if (!frame || !calloutHeight) return "50%";
    if (frame.bottom + gap + calloutHeight <= window.innerHeight - edge) return `${frame.bottom + gap}px`;
    return `${Math.max(edge, frame.top - gap - calloutHeight)}px`;
  })();
  const centered = !frame || !calloutHeight;

  return <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="チュートリアル">
    <div className="tutorial-scrim" />
    {frame && <div className="tutorial-frame" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }} />}
    <div
      ref={calloutRef}
      className="tutorial-callout"
      style={centered ? { top: "50%", transform: "translate(-50%, -50%)" } : { top: calloutTop }}
    >
      <h2>{props.step.title}</h2>
      <p>{props.step.message}</p>
      <p className="small muted">{props.localStepIndex + 1} / {props.totalSteps}</p>
      <div className="row tutorial-actions">
        <button className="ghost" onClick={props.onClose}>閉じる</button>
        <button className="primary" onClick={props.onNext}>{props.isLast ? "OK" : "次へ"}</button>
      </div>
    </div>
  </div>;
}

function paddedFrame(rect: DOMRect, padding: number) {
  const left = Math.max(3, rect.left - padding);
  const top = Math.max(3, rect.top - padding);
  const right = Math.min(window.innerWidth - 3, rect.right + padding);
  const bottom = Math.min(window.innerHeight - 3, rect.bottom + padding);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), bottom };
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
  if (current === "fullAuto") return "live";
  return "off";
}

function liveStatusLabel(status: GeminiLiveStatus) {
  return {
    connecting: "接続中",
    connected: "接続済み",
    listening: "会話中",
    closed: "停止中"
  }[status];
}

function Onboarding(props: { onDone: (consented: boolean) => void }) {
  const [page, setPage] = useState(0);
  const [consented, setConsented] = useState(false);
  const current = ONBOARDING[page];
  return <div className="onboarding" style={{ backgroundImage: `url(${current.image})` }} onPointerDownCapture={() => primeAppSounds()}>
    <section className="onboarding-card">
      <p className="muted">Page {page + 1} / 5</p>
      <h1>{current.title}</h1>
      <div className="onboarding-copy">
        {current.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {page === 1 && <p className="small"><a href={LINKS.officialSite} target="_blank" rel="noreferrer">BYOKey Lab公式サイト <ExternalLink size={14} /></a></p>}
      {page === 2 && <p className="small"><a href={LINKS.googleApiKeyDocs} target="_blank" rel="noreferrer">Google公式のAPIキー資料 <ExternalLink size={14} /></a></p>}
      {page === 4 && <label className="row"><input style={{ width: "auto" }} type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /> リスクと外部送信について理解しました</label>}
      <div className="row onboarding-actions">
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
  onWebSearchToggle: () => void;
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
  recordingMic: MicLanguage | null;
  micAvailable: boolean;
  liveStatus: GeminiLiveStatus;
  liveTranscript: LiveTranscriptLine[];
  onLiveToggle: () => void;
  onMic: (language: MicLanguage) => void;
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
        {props.settings.voiceMode !== "off" && <p className="voice-mode-hint small">{props.settings.voiceMode === "manual" ? "✦ マニュアル送信: 話し終えたらマイクを押して確定します" : props.settings.voiceMode === "fullAuto" ? "✦ フルオート: 話し終えて数秒待つと自動送信します" : "✦ Gemini Live: 高品質なリアルタイム音声会話を行います"}</p>}
        {props.settings.voiceMode === "live" && <div className="live-console">
          <div className="section-title">
            <strong>Gemini Live</strong>
            <button className={props.liveStatus === "closed" ? "primary" : "danger"} onClick={props.onLiveToggle}>{props.liveStatus === "closed" ? "Start" : "Stop"}</button>
          </div>
          <p className="small muted">状態: {liveStatusLabel(props.liveStatus)} / 音声入出力はGemini Live APIへ直接送信されます。</p>
          {props.liveTranscript.length > 0 && <div className="live-transcript">
            {props.liveTranscript.map((line, index) => <p key={`${line.role}-${index}`} className={`small ${line.role}`}><strong>{line.role === "user" ? "You" : "Coach"}:</strong> {line.text}</p>)}
          </div>}
        </div>}
        <div className="composer-actions" aria-label="Conversation tools">
          <button data-tutorial-id={TUTORIAL_TARGETS.chatAutoMode} className={`icon-button ghost voice-mode-button ${props.settings.voiceMode !== "off" ? "active" : ""}`} title="Voice Mode切替" onClick={props.onVoiceModeCycle}>
            <Headphones size={20} />
            {props.settings.voiceMode !== "off" && <span className="mode-badge">{props.settings.voiceMode === "manual" ? "→" : props.settings.voiceMode === "fullAuto" ? "⇔" : "L"}</span>}
          </button>
          <button data-tutorial-id={TUTORIAL_TARGETS.chatQuickAssist} className="icon-button ghost" title="Quick Assist" onClick={props.onAssist}><Sparkles size={20} /></button>
          <button
            data-tutorial-id={TUTORIAL_TARGETS.chatWebSearch}
            className={`icon-button ghost web-search-button ${props.webSearch ? "active" : ""}`}
            title={props.webSearch ? "Web検索オン" : "Web検索オフ"}
            aria-pressed={props.webSearch}
            onClick={props.onWebSearchToggle}
          ><Globe2 size={20} /></button>
          <button className="icon-button ghost" title="入力をひとつ戻す" disabled={!props.canUndoDraft} onClick={props.onUndo}><Undo2 size={20} /></button>
        </div>
        <div className="composer-input-row">
          <textarea rows={1} value={props.draft} onChange={(event) => props.setDraftFromUser(event.target.value)} placeholder={props.settings.voiceMode === "live" ? "Live中もテキスト送信できます" : "Let's talk!"} />
          <button data-tutorial-id={TUTORIAL_TARGETS.chatMic} className={`voice-mini ${props.recordingMic === "en-US" ? "recording" : ""}`} disabled={!props.micAvailable || props.settings.voiceMode === "live"} title={props.recordingMic === "en-US" ? "Stop English recording" : "English voice input"} onClick={() => props.onMic("en-US")}><Mic size={19} /><span>{props.recordingMic === "en-US" ? "止" : "英"}</span></button>
          <button className={`voice-mini ${props.recordingMic === "ja-JP" ? "recording" : ""}`} disabled={!props.micAvailable || props.settings.voiceMode === "live"} title={props.recordingMic === "ja-JP" ? "日本語録音を停止" : "Japanese voice input"} onClick={() => props.onMic("ja-JP")}><Mic size={19} /><span>{props.recordingMic === "ja-JP" ? "止" : "日"}</span></button>
          <button className="send-mini primary" title="Send" onClick={props.onSend}><Send size={22} /></button>
        </div>
      </div>
    </section>;
  }

  return <div className="stack chats-screen">
      <div className="chats-headline">
        <h2>✦ Chats</h2>
        <button data-tutorial-id={TUTORIAL_TARGETS.chatsNewChat} className="new-chat-pill" onClick={props.onNewChat}><Plus size={26} /> New Chat</button>
      </div>
      <section data-tutorial-id={TUTORIAL_TARGETS.chatsDailyNews} className="daily-news-section stack" aria-label="Daily News">
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
  const [requestedLetter, setRequestedLetter] = useState<{ letter: string; behavior: ScrollBehavior } | null>(null);
  const [selectedQuickAssist, setSelectedQuickAssist] = useState<VocabCard | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastRailLetterRef = useRef<string | null>(null);
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

  useEffect(() => {
    setRequestedLetter(null);
    setActiveRail(null);
    lastRailLetterRef.current = null;
    listRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [collection]);

  useEffect(() => {
    if (!requestedLetter || effectiveSort !== "alphabet") return;
    const target = sortedCards.find((card) => cardLetter(card) >= requestedLetter.letter) ?? sortedCards.find((card) => cardLetter(card));
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      const container = listRef.current;
      const element = document.getElementById(`vocab-card-${target.id}`);
      if (!container || !element) return;
      const targetTop = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: targetTop, behavior: requestedLetter.behavior });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedLetter, effectiveSort, sortedCards]);

  function requestLetterScroll(letter: string, behavior: ScrollBehavior = "auto") {
    setSort("alphabet");
    setRequestedLetter({ letter, behavior });
  }

  function scrubAlphabet(event: React.PointerEvent<HTMLDivElement>, behavior: ScrollBehavior = "auto") {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    const ratio = Math.min(0.999, Math.max(0, y / rect.height));
    const letter = alphabet[Math.floor(ratio * alphabet.length)];
    setActiveRail({ letter, y });
    if (lastRailLetterRef.current === letter) return;
    lastRailLetterRef.current = letter;
    requestLetterScroll(letter, behavior);
  }

  function clearAlphabetPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    lastRailLetterRef.current = null;
    setActiveRail(null);
  }

  return <div className="grid review-layout">
    <div data-tutorial-id={TUTORIAL_TARGETS.vocabularyList} className="screen-heading"><h2>✦ {collection === "quickAssist" ? "Quick Assist" : "Vocabulary List"}</h2><span className="small">{sortedCards.length} cards</span></div>
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
        <button data-tutorial-id={TUTORIAL_TARGETS.vocabularyAdd} className="icon-button ghost add-toggle" title="手動追加" onClick={() => setShowAdd((current) => !current)}><Plus size={19} /></button>
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
          {sortedCards.map((card, index) => <article
            className={`card vocab-card compact-vocab${collection === "quickAssist" ? " tappable-card" : ""}`}
            data-usage-tier={usageTier(card.usageCount)}
            data-tutorial-id={index === 0 ? TUTORIAL_TARGETS.vocabularyCard : undefined}
            id={`vocab-card-${card.id}`}
            key={card.id}
            role={collection === "quickAssist" ? "button" : undefined}
            tabIndex={collection === "quickAssist" ? 0 : undefined}
            onClick={() => {
              if (collection === "quickAssist") setSelectedQuickAssist(card);
            }}
            onKeyDown={(event) => {
              if (collection !== "quickAssist") return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedQuickAssist(card);
              }
            }}
          >
            <div className="vocab-main">
              <h3>{card.expression}</h3>
              <p className="muted">{card.meaning || "意味は未設定です。"} <span>{new Date(card.createdAt).toLocaleDateString()}</span></p>
            </div>
            <div className="vocab-actions">
              <button className="icon-button ghost" title="Favorite" onClick={async (event) => { event.stopPropagation(); await setEquivalentVocabFavorite(card, !card.favorite); await props.onReload(); }}><Star size={20} fill={card.favorite ? "currentColor" : "none"} /></button>
              <button className="icon-button danger ghost" title="Delete" onClick={async (event) => { event.stopPropagation(); await deleteEquivalentVocabCard(card); await props.onReload(); }}><Trash2 size={20} /></button>
            </div>
          </article>)}
        </div>
        {collection === "vocabulary" && sortedCards.length > 0 && <div
          className="alphabet-rail"
          role="slider"
          aria-label="Alphabet quick scroll"
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            activePointerIdRef.current = event.pointerId;
            lastRailLetterRef.current = null;
            scrubAlphabet(event);
          }}
          onPointerMove={(event) => {
            if (activePointerIdRef.current === event.pointerId) scrubAlphabet(event);
          }}
          onPointerUp={clearAlphabetPointer}
          onPointerCancel={clearAlphabetPointer}
          onLostPointerCapture={() => {
            activePointerIdRef.current = null;
            lastRailLetterRef.current = null;
            setActiveRail(null);
          }}
        >
          {activeRail && <span className="alphabet-bubble" style={{ top: activeRail.y }}>{activeRail.letter}</span>}
          {alphabet.map((letter) => <button className={collectionCards.some((card) => cardLetter(card) === letter) ? "" : "dim"} key={letter} onClick={() => requestLetterScroll(letter, "smooth")}>{letter}</button>)}
        </div>}
      </div>
    </section>
    {selectedQuickAssist && <div className="modal-backdrop" onClick={() => setSelectedQuickAssist(null)}>
      <section className="modal stack quick-assist-detail" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h2>Quick Assist</h2>
          <button className="icon-button ghost" aria-label="閉じる" onClick={() => setSelectedQuickAssist(null)}>×</button>
        </div>
        <article className="card stack">
          <strong>{selectedQuickAssist.expression}</strong>
          <p>{selectedQuickAssist.meaning || "意味は未設定です。"}</p>
          <p className="small muted">追加日：{new Date(selectedQuickAssist.createdAt).toLocaleDateString()} / 使用回数：{selectedQuickAssist.usageCount ?? 0}</p>
        </article>
      </section>
    </div>}
  </div>;
}

function usageTier(usageCount: number) {
  if (usageCount >= 15) return "5";
  if (usageCount >= 9) return "4";
  if (usageCount >= 5) return "3";
  if (usageCount >= 2) return "2";
  return "1";
}

function ProgressTab(props: { progress: ReturnType<typeof localProgress>; stats: DailyStat[]; vocab: VocabCard[]; analyses: ConversationAnalysis[]; canAnalyze: boolean; onAnalyze: () => void; onPractice: (prompt: string) => void }) {
  const latest = props.analyses[0];
  const weekLabels = ["木", "金", "土", "日", "月", "火", "水"];
  const [detail, setDetail] = useState<"calendar" | "vocabulary" | null>(null);
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
        <Metric label="累計学習日" value={`${props.progress.studyDays}日`} onClick={() => setDetail("calendar")} />
        <Metric label="累計ターン" value={`${props.progress.userTurns}`} />
        <Metric label="ボキャブラリー" value={`${props.progress.savedExpressions}`} onClick={() => setDetail("vocabulary")} />
        <Metric label="お気に入り ★" value={`${props.progress.favoriteCount}`} />
      </div>
    </section>
    <section className="panel stack english-profile">
      <div className="section-title english-profile-title"><h2>✦ Your English Profile</h2><button data-tutorial-id={TUTORIAL_TARGETS.progressAnalysis} className="primary" disabled={!props.canAnalyze} onClick={props.onAnalyze}><Sparkles size={16} /> 会話を分析</button></div>
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
        <div data-tutorial-id={TUTORIAL_TARGETS.progressPractice} className="row">{latest.result.practicePrompts.slice(0, 3).map((prompt) => <button key={prompt} onClick={() => props.onPractice(prompt)}>{prompt}</button>)}</div>
      </>}
    </section>
    {detail === "calendar" && <StudyCalendarBottomSheet stats={props.stats} onDismiss={() => setDetail(null)} />}
    {detail === "vocabulary" && <VocabularyHistoryBottomSheet vocab={props.vocab} onDismiss={() => setDetail(null)} />}
  </div>;
}

function Metric(props: { label: string; value: string; onClick?: () => void }) {
  const content = <>
    {props.onClick && <Maximize2 className="metric-detail-icon" size={15} aria-hidden="true" />}
    <p className="small muted">{props.label}</p>
    <strong>{props.value}</strong>
  </>;
  if (props.onClick) {
    return <button className="card metric-card-action" type="button" onClick={props.onClick} aria-label={`${props.label}の詳細を開く`}>{content}</button>;
  }
  return <div className="card">{content}</div>;
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
  onReplayTutorials: () => void;
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  onClearLearning: () => void;
}) {
  const section = props.section;
  const setSection = props.setSection;
  const [coachSkillsDraft, setCoachSkillsDraft] = useState(props.settings.coachSkills);
  const selectedCefrGuide = CEFR_GUIDE.find((item) => item.level === props.settings.englishLevel) ?? CEFR_GUIDE[0];
  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: "system", label: "システム設定" },
    { id: "coach", label: "レベル、コーチ設定" },
    { id: "backup", label: "バックアップ／復元" },
    { id: "data", label: "データ削除" },
    { id: "help", label: "ヘルプ" },
    { id: "about", label: "About" }
  ];
  useEffect(() => {
    setCoachSkillsDraft(props.settings.coachSkills);
  }, [props.settings.coachSkills]);

  function commitCoachSkillsDraft() {
    if (coachSkillsDraft === props.settings.coachSkills) return;
    props.onSettings({ coachSkills: coachSkillsDraft });
  }

  return <div className="stack settings-layout">
    <div className="screen-heading"><h2>✦ Settings</h2></div>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {sections.map((item) => <button
        key={item.id}
        data-tutorial-id={item.id === "coach" ? TUTORIAL_TARGETS.settingsCoach : undefined}
        className={section === item.id ? "primary" : "ghost"}
        onClick={() => setSection(item.id)}
      >{item.label}</button>)}
    </div>
    <section className="panel stack settings-panel">
      <div className="settings-scroll">
      {section === "system" && <div className="stack">
        <article className="card stack">
          <div data-tutorial-id={TUTORIAL_TARGETS.settingsApiKey} className="section-title"><h3><KeyRound size={18} /> Gemini API Key</h3><span className="small">{props.settings.hasApiKey ? "保存済み" : "未設定"}</span></div>
          <p className="small muted">BYOKey LabはAPIキーを受信、保存、閲覧するためのアプリケーションサーバーやデータベースを持たず、通常利用時に利用者のAPIキーを保存・把握しません。コードはGitHubで公開し、データの保存先、通信先、APIキーの取扱いを確認できるようにしています。</p>
          <p className="small"><ShieldAlert size={15} /> クライアント側にAPIキーを入力する構成は、Google公式の一般的なセキュリティ推奨とは異なります。理解・納得できる方のみ利用してください。</p>
          <label>Model<select value={props.settings.model} onChange={(event) => props.onSettings({ model: event.target.value })}>{GEMINI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " (Recommended)" : ""}</option>)}</select></label>
          <div className="split">
            <select value={props.settings.apiKeyMode} onChange={(event) => props.onSettings({ apiKeyMode: event.target.value as AppSettings["apiKeyMode"] })}>
              <option value="persistent">このブラウザに保存</option>
              <option value="session">このセッションだけ</option>
            </select>
            <input data-tutorial-id={TUTORIAL_TARGETS.settingsApiKeyInput} type="password" autoComplete="off" value={props.apiKeyDraft} onChange={(event) => props.setApiKeyDraft(event.target.value)} placeholder={props.settings.hasApiKey ? "ブラウザに保存済み" : "Gemini API key"} />
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
          <label>Voice mode<select value={props.settings.voiceMode} onChange={(event) => props.onSettings({ voiceMode: event.target.value as AppSettings["voiceMode"] })}><option value="off">Off</option><option value="manual">手動送信</option><option value="fullAuto">Full Auto</option><option value="live">Gemini Live（実験）</option></select></label>
          <label>読み上げ方式<select value={props.settings.speechOutputProvider} onChange={(event) => props.onSettings({ speechOutputProvider: event.target.value as AppSettings["speechOutputProvider"] })}><option value="device">端末の読み上げ（無料・端末依存）</option><option value="geminiTts">Gemini TTS（高品質・API利用）</option></select></label>
          <label>Voice<select value={props.settings.voiceGender} onChange={(event) => props.onSettings({ voiceGender: event.target.value as AppSettings["voiceGender"] })}><option value="female">Female</option><option value="male">Male</option></select></label>
          <label>読み上げ速度 <span className="small muted">{props.settings.voiceRate.toFixed(1)}x</span><input type="range" min="0.6" max="1.5" step="0.1" value={props.settings.voiceRate} onChange={(event) => props.onSettings({ voiceRate: Number(event.target.value) })} /></label>
        </article>
        {(props.settings.speechOutputProvider === "geminiTts" || props.settings.voiceMode === "live") && <article className="card stack">
          <h3>Gemini音声（Preview）</h3>
          <p className="small muted">Gemini TTSとGemini LiveはPreview機能です。読み上げテキストまたは音声が、利用者自身のGemini APIキーでGoogleのAPIへ送信され、API利用料が発生する場合があります。BYOKey Labのサーバーは経由しません。</p>
          {props.settings.speechOutputProvider === "geminiTts" && <div className="grid settings-grid">
            <label>TTS model<select value={props.settings.geminiTtsModel} onChange={(event) => props.onSettings({ geminiTtsModel: event.target.value })}>{GEMINI_TTS_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " (Recommended)" : ""}</option>)}</select></label>
            <label>TTS voice<select value={props.settings.geminiTtsVoice} onChange={(event) => props.onSettings({ geminiTtsVoice: event.target.value })}>{GEMINI_TTS_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</select></label>
          </div>}
          {props.settings.voiceMode === "live" && <div className="grid settings-grid">
            <label>Live model<select value={props.settings.liveModel} onChange={(event) => props.onSettings({ liveModel: event.target.value })}>{GEMINI_LIVE_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " (Recommended)" : ""}</option>)}</select></label>
            <label>Live voice<select value={props.settings.liveVoice} onChange={(event) => props.onSettings({ liveVoice: event.target.value })}>{GEMINI_TTS_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</select></label>
          </div>}
        </article>}
        <article data-tutorial-id={TUTORIAL_TARGETS.settingsCefr} className="card stack cefr-guide">
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
        <label data-tutorial-id={TUTORIAL_TARGETS.settingsCoachSkill}>Coach Skills<textarea rows={10} value={coachSkillsDraft} onChange={(event) => setCoachSkillsDraft(event.target.value)} onBlur={commitCoachSkillsDraft} /></label>
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
        <button onClick={props.onReplayTutorials}>チュートリアルを再表示</button>
        <div data-tutorial-id={TUTORIAL_TARGETS.settingsHelp}><InfoLink href={LINKS.apiGuide} label="API設定ガイド" /></div>
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
      </div>
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
  setAssist: React.Dispatch<React.SetStateAction<{ open: boolean; stuck: string; suggestions: Array<{ english: string; note: string }> }>>;
  runAssist: () => void;
  adopt: (english: string) => void;
  recording: boolean;
  micAvailable: boolean;
  onMic: () => void;
}) {
  return <div className="modal-backdrop">
    <section className="modal stack">
      <div className="section-title">
        <h2>Quick Assist</h2>
        <div className="row nowrap">
          <button className="icon-button ghost" title="新規" onClick={() => props.setAssist({ open: true, stuck: "", suggestions: [] })}><Plus size={18} /></button>
          <button className="icon-button ghost" title="閉じる" onClick={() => props.setAssist((current) => ({ ...current, open: false }))}>×</button>
        </div>
      </div>
      <textarea rows={3} value={props.assist.stuck} onChange={(event) => props.setAssist({ ...props.assist, stuck: event.target.value })} placeholder="日本語でも英語でも、言いたいことを書いてください。" />
      <div className="row">
        <button className="primary" onClick={props.runAssist}><Sparkles size={15} /> 候補を出す</button>
        <button className={props.recording ? "danger" : ""} disabled={!props.micAvailable} onClick={props.onMic}><Mic size={15} /> {props.recording ? "録音を止める" : "日本語で話す"}</button>
      </div>
      {props.assist.suggestions.map((suggestion) => <article className="card stack" key={suggestion.english}>
        <strong>{suggestion.english}</strong>
        <span className="small muted">{suggestion.note}</span>
        <button onClick={() => props.adopt(suggestion.english)}>入力欄へ追記</button>
      </article>)}
    </section>
  </div>;
}
