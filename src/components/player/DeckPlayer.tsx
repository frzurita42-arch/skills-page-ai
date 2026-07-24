import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import type { LessonSeed, SlideDeck, SlidePlanInfo } from '@contracts/types';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';
import { DoodleSparkle, DoodleStar, DoodleSpiral } from '../sketch/DoodleIcons';
import PlayerHeader from './PlayerHeader';
import SlideComponentView, { Kara } from './SlideComponents';
import QuizCard, { type QuizAnswer } from './QuizCard';
import FinishScreen from './FinishScreen';
import { buildNarration } from './narration';
import { useReadAloud } from './useReadAloud';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export interface DeckPlayerProps {
  deck: SlideDeck;
  toolSlug: string;
  seed: LessonSeed | null;
  previouslyTaught: string | null;
  /** per-slide layout info for the admin diagnostic badge */
  slidePlan?: SlidePlanInfo[];
  voiceURI: string | null;
  nextLessonTitle: string | null;
  onExit: () => void;
}

/** Internal stagger item (slide-tool.md §C2: title → paragraphs → component → sticky) */
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

/**
 * The evaluated deck player (slide-tool.md §C): immersive paper stage,
 * directional slide transitions, per-slide quizzes, read-aloud karaoke,
 * keyboard navigation — finish screen is the only save point.
 */
export default function DeckPlayer({
  deck,
  toolSlug,
  seed,
  previouslyTaught,
  slidePlan,
  voiceURI,
  nextLessonTitle,
  onExit,
}: DeckPlayerProps) {
  const reduced = useReducedMotion();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  const [finished, setFinished] = useState(false);
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const startRef = useRef(Date.now());
  const [elapsedFinal, setElapsedFinal] = useState(0);

  const total = deck.slides.length;
  const viewingIdx = reviewIdx ?? index;
  const inReview = reviewIdx !== null;

  /* -------- lazy per-slide image loading (current + next prefetch) -------- */
  // Images are generated on demand so the deck opens immediately; each slide's
  // image streams in while the learner reads, and the next slide's image is
  // prefetched so it's usually ready by the time they advance.
  const utils = trpc.useUtils();
  const [slideImages, setSlideImages] = useState<Record<number, string>>({});
  const imgRequested = useRef<Set<number>>(new Set());

  const ensureImage = useCallback(
    async (idx: number) => {
      if (deck.imageStyle === 'none') return;
      const s = deck.slides[idx];
      if (!s) return;
      const imgComp = s.components.find((c) => c.type === 'image');
      if (!imgComp || imgComp.type !== 'image') return;
      if (imgComp.imageUrl || imgRequested.current.has(idx)) return; // embedded or in-flight
      imgRequested.current.add(idx);
      try {
        const res = await utils.client.generate.slideImage.mutate({
          prompt: imgComp.prompt,
          style: deck.imageStyle,
        });
        if (res?.imageUrl) setSlideImages((prev) => ({ ...prev, [idx]: res.imageUrl! }));
      } catch {
        // keep the style-thumbnail fallback; allow a later retry
        imgRequested.current.delete(idx);
      }
    },
    [deck, utils],
  );

  useEffect(() => {
    void ensureImage(viewingIdx);
    void ensureImage(viewingIdx + 1); // prefetch the next slide's image
  }, [viewingIdx, ensureImage]);

  const rawSlide = deck.slides[viewingIdx];
  const fetchedUrl = slideImages[viewingIdx];
  // inject the lazily-fetched image into this slide's image component
  const slide = useMemo(() => {
    if (!fetchedUrl) return rawSlide;
    return {
      ...rawSlide,
      components: rawSlide.components.map((c) =>
        c.type === 'image' && !c.imageUrl ? { ...c, imageUrl: fetchedUrl } : c,
      ),
    };
  }, [rawSlide, fetchedUrl]);

  const narration = useMemo(() => buildNarration(slide), [slide]);
  const readAloud = useReadAloud(narration, voiceURI);

  const currentAnswer = answers[index];
  const nextUnlocked = !slide.quiz || (currentAnswer?.solved ?? false);
  const isLast = index === total - 1;

  const goNext = useCallback(() => {
    if (inReview) return;
    if (isLast) {
      if (!nextUnlocked) return;
      setElapsedFinal(Math.round((Date.now() - startRef.current) / 1000));
      setFinished(true);
      return;
    }
    if (!nextUnlocked) return;
    setDir(1);
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [inReview, isLast, nextUnlocked, total]);

  const goBack = useCallback(() => {
    if (inReview) return;
    setDir(-1);
    setIndex((i) => Math.max(0, i - 1));
  }, [inReview]);

  // Keyboard: arrows navigate, Space = next, Esc = exit/back (slide-tool.md §C4)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      )
        return;
      if (e.key === 'Escape') {
        if (inReview) setReviewIdx(null);
        else if (!finished) setExitConfirm(true);
        return;
      }
      if (finished || inReview) return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goBack();
      else if (e.key === ' ' && target === document.body) {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goBack, finished, inReview]);

  const handleAnswer = (chosenIndex: number, correct: boolean) => {
    setAnswers((a) =>
      a[index]
        ? a
        : { ...a, [index]: { firstChosen: chosenIndex, firstCorrect: correct, solved: correct } },
    );
  };
  const handleSolved = () => {
    setAnswers((a) =>
      a[index] ? { ...a, [index]: { ...a[index], solved: true } } : a,
    );
  };

  const replay = () => {
    setAnswers({});
    setIndex(0);
    setDir(1);
    setFinished(false);
    setReviewIdx(null);
    setReplayKey((k) => k + 1);
    startRef.current = Date.now();
  };

  // slide enter/exit variants (design.md §6: x ±60 + rotate ±0.5 + fade, 350ms)
  const slideVariants = {
    enter: (d: number) =>
      reduced
        ? { opacity: 0 }
        : { opacity: 0, x: d * 60, rotate: d * 0.5 },
    center: { opacity: 1, x: 0, rotate: 0 },
    exit: (d: number) =>
      reduced
        ? { opacity: 0 }
        : { opacity: 0, x: d * -60, rotate: d * -0.5 },
  };

  const proseIdxs: number[] = [];
  const visualIdxs: number[] = [];
  let stickyIdx = -1;
  slide.components.forEach((c, ci) => {
    if (c.type === 'prose') proseIdxs.push(ci);
    else if (c.type === 'stickynote') stickyIdx = ci;
    else visualIdxs.push(ci);
  });

  return (
    <div
      className="paper-grain fixed inset-0 z-[65] flex min-h-[100dvh] flex-col bg-paper"
      data-lenis-prevent
    >
      <PlayerHeader
        title={deck.topic}
        seed={seed}
        previouslyTaught={previouslyTaught}
        index={index}
        total={total}
        readAloud={readAloud}
        isAdmin={isAdmin}
        layout={slidePlan?.[viewingIdx] ?? null}
        onExit={() => (finished ? onExit() : setExitConfirm(true))}
      />

      <div className="flex-1 overflow-y-auto" data-lenis-prevent>
        {finished && !inReview ? (
          <FinishScreen
            deck={deck}
            toolSlug={toolSlug}
            seed={seed}
            answers={answers}
            elapsedSec={elapsedFinal}
            nextLessonTitle={nextLessonTitle}
            onReplay={replay}
            onExitToConfig={onExit}
            onReviewSlide={(i) => setReviewIdx(i)}
          />
        ) : (
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={`${viewingIdx}-${replayKey}`}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.35, ease: EASE }}
              drag={reduced ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.15}
              onDragEnd={(_, info) => {
                if (info.offset.x < -80) goNext();
                else if (info.offset.x > 80) goBack();
              }}
              className="relative mx-auto max-w-[1080px] cursor-grab px-5 pb-32 pt-8 active:cursor-grabbing sm:px-8"
            >
              {/* margin doodles (slide-tool.md §C2) — hidden on mobile */}
              <DoodleStar className="pointer-events-none absolute right-2 top-24 hidden h-6 w-6 text-ink/50 lg:block" />
              <DoodleSpiral className="pointer-events-none absolute right-4 top-1/2 hidden h-7 w-7 text-ink/40 lg:block" />

              <motion.div
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.12 } },
                }}
              >
                {/* slide title */}
                <motion.h1
                  variants={item}
                  className="flex items-start gap-2 font-heading text-[32px] font-bold leading-tight text-ink"
                >
                  <DoodleSparkle className="mt-2 h-5 w-5 shrink-0 text-purple" />
                  <Kara k="title" current={readAloud.currentKey}>
                    {slide.title}
                  </Kara>
                </motion.h1>

                {/* prose + component zone: two-column 55/45 at ≥1024px */}
                <div
                  className={cn(
                    'mt-6 gap-8',
                    visualIdxs.length > 0 && 'lg:grid lg:grid-cols-[55fr_45fr]',
                  )}
                >
                  <motion.div variants={item} className="flex flex-col gap-5">
                    {proseIdxs.map((ci) => (
                      <SlideComponentView
                        key={ci}
                        component={slide.components[ci]}
                        ci={ci}
                        current={readAloud.currentKey}
                      />
                    ))}
                  </motion.div>
                  {visualIdxs.length > 0 && (
                    <motion.div
                      variants={{
                        hidden: { opacity: 0, scale: 0.96 },
                        show: {
                          opacity: 1,
                          scale: 1,
                          transition: { duration: 0.35, ease: EASE, delay: 0.12 },
                        },
                      }}
                      className="mt-6 flex flex-col gap-6 lg:mt-0"
                    >
                      {visualIdxs.map((ci) => (
                        <SlideComponentView
                          key={ci}
                          component={slide.components[ci]}
                          ci={ci}
                          current={readAloud.currentKey}
                        />
                      ))}
                    </motion.div>
                  )}
                </div>

                {/* sticky note peels in last (design.md §6) */}
                {stickyIdx >= 0 && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, rotate: 6, y: 10 },
                      show: {
                        opacity: 1,
                        rotate: 0,
                        y: 0,
                        transition: { duration: 0.4, delay: 0.24 },
                      },
                    }}
                    className="mt-8"
                  >
                    <SlideComponentView
                      component={slide.components[stickyIdx]}
                      ci={stickyIdx}
                      current={readAloud.currentKey}
                    />
                  </motion.div>
                )}

                {/* quiz module */}
                {slide.quiz && (
                  <motion.div variants={item}>
                    <QuizCard
                      key={`quiz-${viewingIdx}-${replayKey}`}
                      quiz={slide.quiz}
                      answer={answers[viewingIdx] ?? null}
                      onAnswer={inReview ? () => undefined : handleAnswer}
                      onSolved={inReview ? () => undefined : handleSolved}
                      review={inReview}
                      current={readAloud.currentKey}
                    />
                  </motion.div>
                )}
              </motion.div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* bottom navigation (slide-tool.md §C4) */}
      {!finished && !inReview && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
          <div className="mx-auto flex max-w-[1080px] items-end justify-between px-4 pb-5">
            <div className="pointer-events-auto">
              <SketchButton
                variant="secondary"
                onClick={goBack}
                disabled={index === 0}
                aria-label="Previous slide"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </SketchButton>
            </div>

            {/* slide dots — desktop only */}
            <div className="pointer-events-auto mb-2 hidden items-center gap-1.5 md:flex">
              {deck.slides.map((_, i) => {
                const visited = i < index || answers[i] !== undefined;
                const currentDot = i === index;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setDir(i > index ? 1 : -1);
                      setIndex(i);
                    }}
                    aria-label={`Go to slide ${i + 1}`}
                    aria-current={currentDot}
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border-2 border-ink transition-all',
                      currentDot && 'ring-2 ring-ink ring-offset-2 ring-offset-paper',
                      visited ? 'bg-ink' : 'border-dashed bg-transparent',
                    )}
                  />
                );
              })}
            </div>

            <div className="pointer-events-auto">
              {isLast ? (
                <SketchButton
                  variant="accent"
                  onClick={goNext}
                  disabled={!nextUnlocked}
                  aria-label="Finish deck"
                >
                  <Flag className="h-4 w-4" />
                  Finish
                </SketchButton>
              ) : (
                <SketchButton
                  variant={nextUnlocked ? 'accent' : 'secondary'}
                  onClick={goNext}
                  disabled={!nextUnlocked}
                  aria-label="Next slide"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </SketchButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* review-mode bar */}
      {inReview && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center pb-5">
          <SketchButton variant="secondary" onClick={() => setReviewIdx(null)}>
            <ArrowLeft className="h-4 w-4" />
            Back to results
          </SketchButton>
        </div>
      )}

      {/* mid-run exit confirm (slide-tool.md §Interactions) */}
      <AnimatePresence>
        {exitConfirm && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-ink/30"
              onClick={() => setExitConfirm(false)}
              aria-hidden="true"
            />
            <motion.div
              role="alertdialog"
              aria-modal="true"
              className="relative w-full max-w-md rounded-wobble-2 border-2 border-ink bg-paper-3 p-7 pt-9 text-center shadow-offset"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            >
              <WashiTape rotate={-4} />
              <h2 className="font-display text-3xl font-bold text-ink">
                Leave the deck?
              </h2>
              <p className="mt-2 text-sm text-ink-soft">
                Leave now and this play won't be saved — runs only record on
                completion.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <SketchButton variant="ghost" onClick={() => setExitConfirm(false)}>
                  Keep going
                </SketchButton>
                <SketchButton variant="danger" onClick={onExit}>
                  Leave
                </SketchButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
