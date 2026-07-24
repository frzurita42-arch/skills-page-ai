import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Sparkles,
  X,
  Coins,
  TriangleAlert,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import type {
  ImageStyle,
  LessonSeed,
  Level,
  SlideDeck,
  SlidePlanInfo,
  SlideToolSummary,
  Tone,
} from '@contracts/types';
import { LEVELS, LEVEL_LABEL, levelTier, TONES, TONE_LABEL, TONE_HINT } from '@contracts/types';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import StickyNote from '@/components/sketch/StickyNote';
import WashiTape from '@/components/sketch/WashiTape';
import EmptyState from '@/components/sketch/EmptyState';
import AuthWall from '@/components/AuthWall';
import { Toaster } from '@/components/ui/sonner';
import { DoodleSparkle } from '@/components/sketch/DoodleIcons';
import CreateToolModal from '@/components/slides/CreateToolModal';
import GenerationTheater from '@/components/player/GenerationTheater';
import DeckPlayer from '@/components/player/DeckPlayer';
import TemplateBar from '@/components/templates/TemplateBar';

import { isStemTopic } from '@contracts/stem';
import {
  templatesForSubjectAndLevel,
  templateSequenceLabel,
  sectionForTags,
  TEMPLATE_SECTION_LABEL,
} from '@contracts/slide-templates';

const STYLE_PRESETS: Exclude<ImageStyle, 'none'>[] = [
  'sketch',
  'watercolor',
  'flat',
  'photo',
];

const inputCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB] focus:outline-none transition-shadow';

function parseSeed(raw: string | null): LessonSeed | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as Partial<LessonSeed>;
    if (
      typeof obj.repoSlug === 'string' &&
      typeof obj.repoRef === 'string' &&
      typeof obj.lessonTitle === 'string' &&
      typeof obj.lessonSeq === 'number' &&
      typeof obj.lessonSeqTotal === 'number'
    ) {
      return obj as LessonSeed;
    }
  } catch {
    /* malformed seed — treat as a direct run */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Seed banner (slide-tool.md §A1)                                     */
/* ------------------------------------------------------------------ */
function SeedBanner({
  seed,
  repoTitle,
  onDismiss,
}: {
  seed: LessonSeed;
  repoTitle: string | undefined;
  onDismiss: () => void;
}) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const memoryQuery = trpc.repos.courseMemory.useQuery(
    { slug: seed.repoSlug },
    { enabled: seed.lessonSeq > 1 },
  );
  const taught = (memoryQuery.data ?? []).filter(
    (e) => e.lessonSeq < seed.lessonSeq && e.timesTaught > 0,
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.3 }}
      className="relative mb-6 overflow-visible rounded-wobble-2 border-2 border-ink bg-blue-soft p-5 pt-6 shadow-offset"
      aria-label="Lesson seed"
    >
      <WashiTape color="yellow" rotate={-3} />
      <button
        onClick={onDismiss}
        aria-label="Dismiss seed — run as Direct"
        title="Convert to a Direct run"
        className="absolute right-3 top-3 rounded-wobble-sm p-1 text-ink-soft transition-colors hover:bg-paper-3 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip kind="repo-ref">#{seed.repoRef}</Chip>
          <span className="font-heading font-semibold text-ink">
            {repoTitle ?? seed.repoSlug}
          </span>
          <span className="text-sm text-ink-soft">
            Unit: {seed.unitTitle} → Lesson: {seed.lessonTitle}
          </span>
        </div>
        <Chip kind="slide-tool" className="ml-auto">
          Lesson {seed.lessonSeq} of {seed.lessonSeqTotal}
        </Chip>
      </div>

      {seed.lessonSeq > 1 && (
        <div className="mt-3 border-t-2 border-dashed border-ink/20 pt-3">
          <button
            onClick={() => setMemoryOpen((o) => !o)}
            aria-expanded={memoryOpen}
            className="flex items-center gap-1.5 text-sm font-bold text-ink"
          >
            <DoodleSparkle className="h-4 w-4 text-purple" />
            Building on {taught.length > 0 ? taught.length : seed.lessonSeq - 1}{' '}
            completed {taught.length === 1 ? 'lesson' : 'lessons'}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', memoryOpen && 'rotate-180')}
            />
          </button>
          <AnimatePresence>
            {memoryOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0, rotate: 2 }}
                animate={{ height: 'auto', opacity: 1, rotate: 0 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <ul className="mt-2 flex flex-col gap-1.5">
                  {taught.length > 0 ? (
                    taught.map((e) => (
                      <li
                        key={e.lessonSeq}
                        className="rounded-wobble-sm border-2 border-dashed border-ink/25 bg-paper-3 px-3 py-1.5 text-xs leading-relaxed text-ink"
                      >
                        <span className="font-bold">
                          L{e.lessonSeq} taught:
                        </span>{' '}
                        {e.summaries.slice(0, 3).join(' · ') || e.lessonTitle} —
                        best quiz {e.bestScoreCorrect}/{e.bestScoreTotal}
                      </li>
                    ))
                  ) : (
                    <li className="text-xs text-ink-soft">
                      No lesson logs yet — this deck will still assume Lessons 1–
                      {seed.lessonSeq - 1} and skip re-teaching them.
                    </li>
                  )}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="micro mt-2 text-ink-soft">
            This deck will reference that material, not re-teach it.
          </p>
        </div>
      )}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Config + theater + player (slide-tool.md States A → B → C)          */
/* ------------------------------------------------------------------ */
function ToolStudio({
  tool,
  seed,
  onDismissSeed,
}: {
  tool: SlideToolSummary;
  seed: LessonSeed | null;
  onDismissSeed: () => void;
}) {
  const { user, isGuest } = useAuth();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<'config' | 'theater' | 'player'>('config');
  const [topic, setTopic] = useState(seed?.lessonTitle || tool.topic);
  const [instructions, setInstructions] = useState(tool.instructions);
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [level, setLevel] = useState<Level>(tool.defaultLevel);
  const [slideCount, setSlideCount] = useState(
    Math.min(15, Math.max(4, tool.defaultSlideCount)),
  );
  const [imageStyle, setImageStyle] = useState<ImageStyle>(tool.defaultImageStyle);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Advanced: teaching tone / voice for the whole deck (register + jargon).
  const [tone, setTone] = useState<Tone>('neutral');
  // Advanced: pinned layout template per slide (name | null = auto). Index i → slide i+1.
  const [templatePlan, setTemplatePlan] = useState<(string | null)[]>([]);
  const [theaterDone, setTheaterDone] = useState(false);
  const [result, setResult] = useState<{
    deck: SlideDeck;
    previouslyTaught: string | null;
    usedMock: boolean;
    slidePlan: SlidePlanInfo[];
  } | null>(null);
  const canceledRef = useRef(false);

  // repo context for seed prefill + next-lesson handoff
  const repoQuery = trpc.repos.getBySlug.useQuery(
    { slug: seed?.repoSlug ?? '' },
    { enabled: !!seed },
  );
  const allLessons = useMemo(
    () => (repoQuery.data?.units ?? []).flatMap((u) => u.lessons),
    [repoQuery.data],
  );

  // Advanced options: templates the AI may be pinned to, filtered to this
  // deck's subject + level (same set the generator validates against).
  const templatesQuery = trpc.templates.list.useQuery();
  const pickableTemplates = useMemo(
    () =>
      templatesForSubjectAndLevel(
        templatesQuery.data ?? [],
        isStemTopic(topic),
        level,
      ),
    [templatesQuery.data, topic, level],
  );
  const templateByName = useMemo(
    () => new Map(pickableTemplates.map((t) => [t.name, t])),
    [pickableTemplates],
  );
  // pre-fill instructions with the lesson objective once the repo loads
  useEffect(() => {
    if (!seed || instructionsTouched) return;
    const lesson = allLessons.find((l) => l.globalSeq === seed.lessonSeq);
    if (lesson?.objective) setInstructions(lesson.objective);
  }, [seed, allLessons, instructionsTouched]);
  const nextLessonTitle =
    seed && seed.lessonSeq < seed.lessonSeqTotal
      ? allLessons.find((l) => l.globalSeq === seed.lessonSeq + 1)?.title ?? null
      : null;

  // TTS voices for read-aloud
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // live cost estimate (design.md §8)
  const estimateQuery = trpc.generate.estimate.useQuery({
    slideCount,
    imageStyle,
    withTts: false,
    level,
    useOwnKey: !isGuest,
  });
  const estimate = estimateQuery.data;
  const insufficient =
    !!user && !!estimate && user.tokenBalance < estimate.total;

  const generate = trpc.generate.slides.useMutation();

  const runGenerate = () => {
    canceledRef.current = false;
    setTheaterDone(false);
    setMode('theater');
    generate.mutate(
      {
        toolSlug: tool.slug,
        topic: topic.trim() || undefined,
        instructions: instructions.trim() || undefined,
        level,
        slideCount,
        imageStyle,
        tone,
        templatePlan: templatePlan.some(Boolean)
          ? templatePlan.slice(0, slideCount)
          : undefined,
        seed: seed ?? undefined,
      },
      {
        onSuccess: (res) => {
          if (canceledRef.current) return;
          setResult({
            deck: res.deck,
            previouslyTaught: res.previouslyTaught,
            usedMock: res.usedMock,
            slidePlan: res.slidePlan,
          });
          setTheaterDone(true);
          if (!isGuest) void utils.auth.me.invalidate();
          if (res.usedMock) {
            toast('Demo mode — no AI key configured, so a mock deck was sketched.', {
              icon: <Sparkles className="h-4 w-4 text-purple" />,
            });
          }
        },
        onError: (err) => {
          if (canceledRef.current) return;
          setMode('config');
          if (err.message.startsWith('AI_UNAVAILABLE')) {
            toast.error('AI provider not responding — no deck was generated', {
              description:
                'Tokens refunded. Check the server .env AI keys or add your own key in Settings → API Keys, then try again.',
              duration: 12000,
            });
          } else {
            toast.error(err.message);
          }
        },
      },
    );
  };

  const enterPlayer = () => {
    if (!result) return;
    let deck = result.deck;
    if (!includeQuiz) {
      deck = {
        ...deck,
        slides: deck.slides.map((s) => ({ ...s, quiz: undefined })),
      };
    }
    setResult({ ...result, deck });
    setMode('player');
  };

  /* ---------------- State C — player ---------------- */
  if (mode === 'player' && result) {
    return (
      <DeckPlayer
        deck={result.deck}
        toolSlug={tool.slug}
        seed={seed}
        previouslyTaught={result.previouslyTaught}
        slidePlan={result.slidePlan}
        voiceURI={voiceURI}
        nextLessonTitle={nextLessonTitle}
        onExit={() => {
          setMode('config');
          setResult(null);
        }}
      />
    );
  }

  /* ---------------- State B — generation theater ---------------- */
  if (mode === 'theater') {
    return (
      <GenerationTheater
        slideCount={isGuest ? Math.min(slideCount, 6) : slideCount}
        topic={topic.trim() || tool.topic || tool.name}
        done={theaterDone}
        onComplete={enterPlayer}
        onCancel={() => {
          canceledRef.current = true;
          setMode('config');
        }}
      />
    );
  }

  /* ---------------- State A — config ---------------- */
  const stem = isStemTopic(topic);
  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-8 lg:px-8">
      <Toaster position="bottom-right" />
      <AnimatePresence>{seed && (
        <SeedBanner
          seed={seed}
          repoTitle={repoQuery.data?.title}
          onDismiss={onDismissSeed}
        />
      )}</AnimatePresence>

      {/* tool header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[32px] font-bold leading-none text-ink">
          {tool.name}
        </h1>
        <span className="font-mono text-sm text-ink-faint">{tool.slug}</span>
        {seed && <Chip kind="repo-ref">#{seed.repoRef}</Chip>}
      </div>
      {tool.description && (
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">{tool.description}</p>
      )}

      {/* config card */}
      <motion.div
        className="relative mt-6 rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-8 shadow-offset sm:p-8 sm:pt-9"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.07 } } }}
      >
        <WashiTape rotate={-3} />
        <WashiTape color="blue" rotate={2} className="left-auto right-8" />

        <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
          <span className="micro mb-1 flex items-center justify-between text-ink-soft">
            Topic / prompt
            <span className="font-mono normal-case tracking-normal">
              {topic.length}/2000
            </span>
          </span>
          <textarea
            className={cn(inputCls, 'min-h-[84px] resize-y font-mono')}
            value={topic}
            maxLength={2000}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What should this presentation teach?"
          />
        </motion.div>

        <motion.div
          className="mt-4"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1 block text-ink-soft">Custom instructions</span>
          <textarea
            className={cn(inputCls, 'min-h-[64px] resize-y')}
            value={instructions}
            maxLength={4000}
            onChange={(e) => {
              setInstructions(e.target.value);
              setInstructionsTouched(true);
            }}
            placeholder="Tone, must-cover points, things to avoid…"
          />
        </motion.div>

        <motion.div
          className="mt-5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1.5 block text-ink-soft">
            Level (CEFR) — controls reading difficulty
          </span>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                aria-pressed={level === l}
                title={LEVEL_LABEL[l]}
                className={cn(
                  'rounded-wobble-sm border-2 px-3.5 py-1.5 text-sm font-bold transition-all',
                  level === l
                    ? levelTier(l) === 'light'
                      ? 'border-ink bg-green-soft text-ink shadow-offset'
                      : levelTier(l) === 'mid'
                        ? 'border-ink bg-yellow-soft text-ink shadow-offset'
                        : 'border-ink bg-red-soft text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div
          className="mt-5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1.5 flex items-center justify-between text-ink-soft">
            Slides
            <span className="font-mono text-sm font-bold normal-case tracking-normal text-ink">
              {slideCount}
            </span>
          </span>
          <input
            type="range"
            min={4}
            max={15}
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value))}
            className="w-full accent-[#2E2820]"
            aria-label="Slide count"
          />
          {slideCount === 15 && (
            <p className="mt-1 font-display text-lg text-ink-soft">
              15 slides max — notebooks have edges too.
            </p>
          )}
          {isGuest && slideCount > 6 && (
            <p className="mt-1 text-xs font-bold text-orange">
              Guests play free — your deck will be capped at 6 slides.{' '}
              <Link to="/auth" className="squiggle">
                Sign in
              </Link>{' '}
              for up to 15.
            </p>
          )}
        </motion.div>

        <motion.div
          className="mt-5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1.5 block text-ink-soft">Image style</span>
          <div className="flex flex-wrap gap-2.5">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setImageStyle(s)}
                title={s}
                aria-pressed={imageStyle === s}
                className={cn(
                  'relative overflow-hidden rounded-wobble-sm border-2 transition-all duration-200 hover:-translate-y-1 hover:-rotate-1',
                  imageStyle === s
                    ? 'border-ink shadow-offset'
                    : 'border-pencil opacity-70 hover:opacity-100',
                )}
              >
                <img
                  src={`/style-${s}.svg`}
                  alt={`${s} style preset`}
                  className="h-16 w-24 object-cover"
                />
                <span className="block bg-paper-3 py-0.5 text-center font-heading text-[0.7rem] capitalize text-ink">
                  {s}
                </span>
                {imageStyle === s && (
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-yellow text-[10px] font-bold text-ink"
                  >
                    ✓
                  </motion.span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setImageStyle('none')}
              aria-pressed={imageStyle === 'none'}
              className={cn(
                'flex h-[92px] items-center rounded-wobble-sm border-2 px-3 text-sm font-bold transition-all',
                imageStyle === 'none'
                  ? 'border-ink bg-yellow-soft shadow-offset'
                  : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              No images
            </button>
          </div>
        </motion.div>

        {/* options row */}
        <motion.div
          className="mt-5 flex flex-wrap items-center gap-2.5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          {voices.length > 0 && (
            <label className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm">
              <Volume2 className="h-4 w-4 text-ink-soft" />
              <select
                value={voiceURI ?? ''}
                onChange={(e) => setVoiceURI(e.target.value || null)}
                className="max-w-[180px] bg-transparent text-sm font-bold text-ink focus:outline-none"
                aria-label="Read-aloud voice"
              >
                <option value="">Default voice</option>
                {voices.slice(0, 20).map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={includeQuiz}
            onClick={() => setIncludeQuiz((q) => !q)}
            className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm font-bold text-ink"
          >
            <span
              className={cn(
                'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                includeQuiz ? 'bg-green-soft' : 'bg-paper-2',
              )}
            >
              <motion.span
                layout
                className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3"
                animate={{ left: includeQuiz ? 18 : 2 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              />
            </span>
            Include quiz on most slides
          </button>

          {topic.trim() && (
            <Chip kind="neutral" className="border-purple bg-purple-soft">
              <DoodleSparkle className="h-3.5 w-3.5 text-purple" />
              Detected: {stem ? 'STEM — formulas on' : 'Humanities — formulas off'} ✦
            </Chip>
          )}
        </motion.div>
      </motion.div>

      {/* advanced: per-slide template plan */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-1.5 font-heading text-sm font-semibold text-ink-soft hover:text-ink"
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')}
          />
          Advanced — teaching tone &amp; per-slide layout
        </button>

        <AnimatePresence initial={false}>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-2/50 p-4">
                {/* Teaching tone — voice/register for the whole deck */}
                <div className="mb-4">
                  <span className="micro mb-1 block font-semibold text-ink-soft">
                    Teaching tone — the voice used to teach this subject
                  </span>
                  <p className="micro mb-2 text-ink-faint">
                    Sets how casual or technical the writing is, independent of the reading level.
                    Scholarly leans into the field's terminology; casual keeps it plain and
                    jargon-light.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTone(t)}
                        aria-pressed={tone === t}
                        title={TONE_HINT[t]}
                        className={cn(
                          'rounded-wobble-sm border-2 px-3.5 py-1.5 text-sm font-bold transition-all',
                          tone === t
                            ? 'border-ink bg-purple-soft text-ink shadow-offset'
                            : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        {TONE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                  <p className="micro mt-1.5 text-ink-faint">{TONE_HINT[tone]}</p>
                </div>

                <div className="mb-3 border-t-2 border-dashed border-pencil" />

                <p className="micro mb-3 text-ink-faint">
                  Pin a template so the AI drafts that slide in exactly that shape. Leave a slide on{' '}
                  <span className="font-semibold">Auto</span> to let it choose. Templates shown match
                  this deck's subject &amp; level — manage the full set on the{' '}
                  <Link to="/templates" className="squiggle font-semibold">
                    Slide templates
                  </Link>{' '}
                  page.
                </p>
                <div className="flex flex-col gap-2">
                  {Array.from({ length: slideCount }, (_, i) => {
                    const chosenName = templatePlan[i] ?? '';
                    const chosen = chosenName ? templateByName.get(chosenName) : undefined;
                    return (
                      <div
                        key={i}
                        className="flex flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-pencil bg-paper-3 px-3 py-2"
                      >
                        <span className="micro w-14 shrink-0 font-mono text-ink-faint">
                          Slide {i + 1}
                        </span>
                        <select
                          value={chosenName}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setTemplatePlan((prev) => {
                              const next = prev.slice();
                              while (next.length < slideCount) next.push(null);
                              next[i] = v;
                              return next;
                            });
                          }}
                          className="min-w-[160px] rounded-wobble-sm border-2 border-ink bg-paper px-2 py-1 font-heading text-sm text-ink outline-none focus:border-blue"
                        >
                          <option value="">Auto (AI chooses)</option>
                          {pickableTemplates.map((t) => (
                            <option key={String(t.id)} value={t.name}>
                              {t.name} · {TEMPLATE_SECTION_LABEL[sectionForTags(t.tags)]} ({t.level})
                              {' '}
                              — {templateSequenceLabel(t.components)}
                            </option>
                          ))}
                        </select>
                        {chosen && (
                          <TemplateBar components={chosen.components} className="ml-auto" />
                        )}
                      </div>
                    );
                  })}
                </div>
                {templatePlan.some(Boolean) && (
                  <button
                    type="button"
                    onClick={() => setTemplatePlan([])}
                    className="micro mt-3 text-ink-faint hover:text-ink"
                  >
                    Reset all to Auto
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* cost estimate + generate (slide-tool.md §A3) */}
      <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_2fr]">
        <StickyNote rotate={-1.5} className="h-fit">
          <p className="flex items-center gap-1.5 font-heading text-lg font-bold">
            <Coins className="h-4 w-4 text-orange" />
            Cost estimate
          </p>
          {estimateQuery.isLoading ? (
            <p className="mt-1 animate-pulse text-sm">Counting coins…</p>
          ) : estimate ? (
            <>
              <p className="mt-1 font-mono text-2xl font-bold">
                {isGuest ? '0 🪙' : `${estimate.total} 🪙`}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-[0.8rem] leading-snug">
                {(isGuest
                  ? ['Guests play free — decks are capped at 6 slides.']
                  : estimate.breakdown
                ).map((line, i) => (
                  <li key={i}>· {line}</li>
                ))}
                {estimate.usingOwnKey && (
                  <li className="text-purple">
                    · Using your key — 0 🪙 for text ✦
                  </li>
                )}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm">Estimate unavailable.</p>
          )}
        </StickyNote>

        <div className="flex flex-col justify-end gap-2">
          {insufficient && (
            <p className="flex items-center gap-2 rounded-wobble-sm border-2 border-red bg-red-soft px-3 py-2 text-sm font-bold text-ink">
              <TriangleAlert className="h-4 w-4 shrink-0 text-red" />
              Not enough tokens for this deck.{' '}
              <Link to="/settings" className="squiggle">
                Top up
              </Link>
            </p>
          )}
          <SketchButton
            variant="accent"
            size="lg"
            className="w-full font-display text-2xl font-bold"
            disabled={insufficient || estimateQuery.isLoading}
            loading={generate.isPending}
            onClick={runGenerate}
          >
            Generate presentation
          </SketchButton>
          {isGuest && (
            <p className="text-center text-xs text-ink-faint">
              Guests generate for free (6 slides max) —{' '}
              <Link to="/auth" className="squiggle">
                sign in
              </Link>{' '}
              for full decks and saved runs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page shell                                                          */
/* ------------------------------------------------------------------ */
export default function SlideTool() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isGuest, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [createClosed, setCreateClosed] = useState(false);

  const seed = useMemo(
    () => parseSeed(searchParams.get('seed')),
    [searchParams],
  );

  const toolQuery = trpc.slideTools.getBySlug.useQuery(
    { slug },
    { enabled: slug !== 'new', retry: false },
  );

  // /slides/new — State A unseeded: create the tool first (slides-gallery.md §1)
  if (slug === 'new') {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-16">
        <Toaster position="bottom-right" />
        {!authLoading && isGuest ? (
          <>
            <EmptyState
              image="/empty-slides.svg"
              headline="Sign in to sketch a new tool"
              explainer="Slide tools live in your notebook — guests can play the existing ones."
              ctaLabel="Back to slide tools"
              onCta={() => navigate('/slides')}
            />
            <AuthWall open onClose={() => navigate('/slides')} />
          </>
        ) : (
          <>
            <EmptyState
              image="/empty-slides.svg"
              headline="Let's sketch a new slide tool"
              explainer="Fill in the card — you'll land on its config page next."
            />
            <CreateToolModal
              open={!createClosed}
              onClose={() => {
                setCreateClosed(true);
                navigate('/slides');
              }}
            />
          </>
        )}
      </div>
    );
  }

  const dismissSeed = () => {
    setSearchParams({}, { replace: true });
  };

  if (toolQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-10 lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="skeleton-stroke h-9 w-2/5" />
          <div className="skeleton-stroke h-4 w-3/5" />
          <div className="skeleton-stroke mt-4 h-64 w-full rounded-wobble-2" />
          <p className="text-center font-display text-2xl text-ink-faint">
            Sharpening pencils…
          </p>
        </div>
      </div>
    );
  }

  if (toolQuery.isError || !toolQuery.data) {
    return (
      <EmptyState
        image="/empty-slides.svg"
        headline="Couldn't find that slide tool"
        explainer="It may have been deleted, or the link is smudged."
        ctaLabel="Back to slide tools"
        onCta={() => navigate('/slides')}
      />
    );
  }

  return (
    <ToolStudio
      key={`${toolQuery.data.slug}-${seed ? 'seeded' : 'direct'}`}
      tool={toolQuery.data}
      seed={seed}
      onDismissSeed={dismissSeed}
    />
  );
}
