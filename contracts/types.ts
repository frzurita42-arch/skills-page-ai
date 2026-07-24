export * from "./errors";

/* ------------------------------------------------------------------ */
/* SketchLearn shared contracts — frontend imports ONLY from here.      */
/* ------------------------------------------------------------------ */

export type Role = "user" | "moderator" | "admin";
/** CEFR-style difficulty levels (A0 = pre-beginner … C2 = mastery). */
export type Level = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
/** Coarse difficulty tier used for template filtering & cost. */
export type LevelTier = "light" | "mid" | "dense";
export type ImageStyle = "sketch" | "watercolor" | "flat" | "photo" | "none";
export type RepoTemplate = "course" | "restaurant" | "service" | "shop" | "other";
export type AiProvider = "openai" | "anthropic" | "gemini";
export type AiCapability = "text" | "image" | "tts";

export const LEVELS: Level[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

/** Short human label for each CEFR level. */
export const LEVEL_LABEL: Record<Level, string> = {
  A0: "A0 · Pre-beginner",
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Mastery",
};

/** Coarse tier for template filtering & cost (A0-A2 light, B1-B2 mid, C1-C2 dense). */
export function levelTier(level: Level): LevelTier {
  if (level === "A0" || level === "A1" || level === "A2") return "light";
  if (level === "B1" || level === "B2") return "mid";
  return "dense";
}

export const IMAGE_STYLES: ImageStyle[] = ["sketch", "watercolor", "flat", "photo", "none"];
export const REPO_TEMPLATES: RepoTemplate[] = ["course", "restaurant", "service", "shop", "other"];

/* ---------------- Slide deck model (generation contract) ---------- */

export type SlideComponent =
  | { type: "prose"; paragraphs: string[] }
  | { type: "latex"; formula: string; caption?: string }
  | {
      type: "chart";
      chartType: "bar" | "line" | "pie" | "area";
      title: string;
      labels: string[];
      series: { name: string; data: number[] }[];
      why?: string;
    }
  | { type: "svg"; title: string; description: string; sceneHint: string }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "stickynote"; text: string }
  | {
      type: "image";
      prompt: string;
      alt: string;
      style: ImageStyle;
      /** real generated image (base64 data URI) — falls back to the style thumbnail when absent */
      imageUrl?: string;
    }
  | { type: "code"; language: string; code: string; caption?: string };

export interface SlideQuiz {
  question: string;
  options: [string, string, string, string];
  /** 0-3 */
  correctIndex: number;
  explanation: string;
}

export interface Slide {
  title: string;
  components: SlideComponent[];
  quiz?: SlideQuiz;
}

export interface SlideDeck {
  slides: Slide[];
  level: Level;
  imageStyle: ImageStyle;
  topic: string;
}

/* ---------------- Lesson seed (repo → slide tool handoff) ---------- */

export interface LessonSeed {
  repoSlug: string;
  repoRef: string;
  unitTitle: string;
  lessonTitle: string;
  /** 1-based index of lesson inside its unit */
  lessonIndex: number;
  /** number of lessons in this unit */
  lessonCount: number;
  /** 1-based course-order number across the whole repo (globalSeq) */
  lessonSeq: number;
  /** total lessons in the repo */
  lessonSeqTotal: number;
}

/* ---------------- Auth --------------------------------------------- */

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  tokenBalance: number;
  createdAt: Date;
}

/* ---------------- Repos / slide tools ------------------------------ */

export interface RepoSummary {
  slug: string;
  ref: string;
  title: string;
  description: string;
  template: RepoTemplate;
  unitCount: number;
  lessonCount: number;
  runCount: number;
  /** Lessons the current viewer has passed in this repo (0 for guests). */
  myCompletedCount: number;
  isPublic: boolean;
  favorite: boolean;
  ownerName: string | null;
  createdAt: Date;
}

export interface RepoLesson {
  id: number;
  title: string;
  objective: string;
  orderIndex: number;
  globalSeq: number;
  parentLessonId: number | null;
  runCount: number;
  /* Viewer-scoped progress — computed ONLY from the signed-in viewer's own
     runs, so one user's activity never shows on another user's page.
     Guests always see zeros / "unplayed". */
  myAttempts: number;
  myBestCorrect: number;
  myBestTotal: number;
  myLastCorrect: number;
  myLastTotal: number;
  myStatus: "unplayed" | "try-again" | "completed";
}

export interface RepoUnit {
  id: number;
  title: string;
  orderIndex: number;
  lessons: RepoLesson[];
}

export interface RepoDetail extends RepoSummary {
  ownerId: number | null;
  studyToolSlug: string | null;
  toolName: string | null;
  units: RepoUnit[];
}

export interface SlideToolSummary {
  slug: string;
  name: string;
  description: string;
  topic: string;
  instructions: string;
  defaultLevel: Level;
  defaultSlideCount: number;
  defaultImageStyle: ImageStyle;
  isPublic: boolean;
  favorite: boolean;
  runCount: number;
  ownerName: string | null;
  createdAt: Date;
}

/* ---------------- Runs & lesson logs -------------------------------- */

export interface RunRow {
  id: number;
  toolSlug: string;
  toolName: string;
  repoSlug: string | null;
  repoRef: string | null;
  lessonTitle: string | null;
  playerName: string;
  level: Level;
  imageStyle: ImageStyle;
  slideCount: number;
  scoreCorrect: number;
  scoreTotal: number;
  elapsedSec: number;
  flagged: boolean;
  completedAt: Date;
}

export interface RunSlideDetail {
  title: string;
  /** component type summary from the stored deck snapshot, in order */
  components: SlideComponent["type"][];
  question: string | null;
  /** the option text the student picked (null = no quiz / unanswered) */
  chosenOption: string | null;
  /** null = no quiz answer recorded for this slide */
  correct: boolean | null;
}

export interface RunDetail extends RunRow {
  slides: RunSlideDetail[];
}

/** A fully replayable recording of a past play: the exact deck as presented
 *  (text, images, charts…) plus what the student picked on each quiz. */
export interface RunReplay extends RunRow {
  deck: SlideDeck | null;
  /** per-slide recorded answer, aligned to deck.slides by index */
  answers: {
    chosenOption: string | null;
    correctOption: string | null;
    correct: boolean | null;
  }[];
}

export interface LessonLogSlide {
  title: string;
  summary: string;
  visuals: string[];
  question: string | null;
  chosenOption: string | null;
  correct: boolean | null;
}

export interface LessonRunRow {
  id: number;
  lessonId: number | null;
  lessonTitle: string | null;
  lessonSeq: number | null;
  playerName: string;
  level: Level;
  scoreCorrect: number;
  scoreTotal: number;
  elapsedSec: number;
  completedAt: Date;
}

export interface CourseMemoryEntry {
  lessonSeq: number;
  lessonTitle: string;
  unitTitle: string;
  timesTaught: number;
  bestScoreCorrect: number;
  bestScoreTotal: number;
  lastLevel: Level;
  summaries: string[];
}

/* ---------------- Tokens & payments --------------------------------- */

export interface TokenPack {
  id: string;
  tokens: number;
  priceCents: number;
  label: string;
}

export interface TokenLedgerRow {
  id: number;
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: Date;
}

export type PaymentStatus = "pending" | "credited" | "rejected";

export interface PaymentRow {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  packId: string;
  packTokens: number;
  amountCents: number;
  note: string | null;
  status: PaymentStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

/* ---------------- Cost estimate ------------------------------------- */

export interface CostEstimate {
  slideCount: number;
  baseCost: number;
  imageCost: number;
  ttsCost: number;
  levelMultiplier: number;
  /** text portion zeroed because the user has a BYOK text key */
  usingOwnKey: boolean;
  total: number;
  breakdown: string[];
}

/* ---------------- Coach --------------------------------------------- */

export interface CoachAction {
  kind: "lesson-path" | "slides" | "repos";
  label: string;
  payload?: {
    title?: string;
    description?: string;
    template?: RepoTemplate;
    units?: number;
    lessons?: number;
    slug?: string;
  };
}

export interface CoachReply {
  reply: string;
  actions: CoachAction[];
}

/* ---------------- Settings ------------------------------------------ */

export interface PlatformAiKey {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
}

export interface PriceSettings {
  perSlideBase: number;
  perImageSlide: number;
  perTts: number;
  levelMultiplier: Record<Level, number>;
}

export interface AppSettings {
  tokenPacks: TokenPack[];
  prices: PriceSettings;
  googleSheetUrl: string;
  platformAiKeys: Partial<Record<AiCapability, PlatformAiKey>>;
  featureFlags: { coachEnabled: boolean; guestDemo: boolean; [k: string]: boolean };
}

/* ---------------- API keys (BYOK) ------------------------------------ */

export interface ApiKeyRow {
  id: number;
  provider: AiProvider;
  capability: AiCapability;
  /** masked: first 6 + … + last 4 */
  maskedKey: string;
  createdAt: Date;
}

/* ---------------- Admin ---------------------------------------------- */

export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  tokenBalance: number;
  runCount: number;
  createdAt: Date;
}

export interface AdminDashboard {
  totals: {
    users: number;
    repos: number;
    slideTools: number;
    runs: number;
    tokensIssued: number;
    pendingPayments: number;
    flaggedRuns: number;
  };
  recentRuns: RunRow[];
  /** token ledger deltas summed per day, oldest → newest */
  tokensOverTime: { date: string; delta: number }[];
  pendingPayments: PaymentRow[];
}
