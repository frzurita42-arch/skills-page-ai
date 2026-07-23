import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SlideQuiz } from '@contracts/types';
import { DoodleCheck } from '../sketch/DoodleIcons';
import { SquiggleDivider } from '../sketch/Squiggle';
import { Kara } from './SlideComponents';

const LETTERS = ['A', 'B', 'C', 'D'];

export interface QuizAnswer {
  /** first-try choice — this is what gets logged (slide-tool.md §C3) */
  firstChosen: number;
  firstCorrect: boolean;
  solved: boolean;
}

export interface QuizCardProps {
  quiz: SlideQuiz;
  /** logged first-try answer, if already answered */
  answer: QuizAnswer | null;
  /** record the first-try result (parent owns the log) */
  onAnswer: (chosenIndex: number, correct: boolean) => void;
  /** called whenever the correct option gets picked (unlocks Next) */
  onSolved?: () => void;
  /** read-only review mode (from the finish screen) */
  review?: boolean;
  current: string | null;
}

/**
 * Per-slide MCQ (design.md §7.11 + slide-tool.md §C3): 4 option cards A–D,
 * immediate correct(green)/incorrect(red+shake) feedback + explanation line.
 * Retry after a wrong pick is allowed; the first-try result is what's logged.
 */
export default function QuizCard({
  quiz,
  answer,
  onAnswer,
  onSolved,
  review = false,
  current,
}: QuizCardProps) {
  const [picked, setPicked] = useState<number | null>(answer?.firstChosen ?? null);
  const [solved, setSolved] = useState(answer?.solved ?? false);
  const [shakeIdx, setShakeIdx] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(answer ? 1 : 0);

  const select = useCallback(
    (i: number) => {
      if (solved) return;
      const correct = i === quiz.correctIndex;
      setPicked(i);
      if (attempts === 0 && !review) {
        // first try — the logged result
        onAnswer(i, correct);
      }
      setAttempts((a) => a + 1);
      if (correct) {
        setSolved(true);
        onSolved?.();
      } else {
        setShakeIdx(i);
        window.setTimeout(() => setShakeIdx(null), 450);
      }
    },
    [solved, quiz.correctIndex, attempts, review, onAnswer, onSolved],
  );

  // Keyboard 1–4 selects options (slide-tool.md §C4); safe because the
  // player mounts exactly one slide at a time (AnimatePresence mode="wait")
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) select(n - 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [select]);

  const showExplanation = attempts > 0 || answer !== null;

  return (
    <section className="mt-10" aria-label="Quick check quiz">
      <SquiggleDivider className="text-pencil" />
      <h3 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <Pencil className="h-5 w-5 text-ink" strokeWidth={2} />
        Quick check
      </h3>
      <p className="mt-2 text-[1.125rem] font-extrabold leading-snug text-ink">
        <Kara k="quizq" current={current}>
          {quiz.question}
        </Kara>
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {quiz.options.map((option, i) => {
          const isCorrect = i === quiz.correctIndex;
          const isPicked = picked === i;
          const revealedCorrect = solved && isCorrect;
          const revealedWrong = isPicked && !isCorrect && attempts > 0 && !solved;
          return (
            <motion.button
              key={i}
              onClick={() => select(i)}
              disabled={solved}
              animate={
                shakeIdx === i ? { x: [0, -4, 4, -4, 4, 0] } : { x: 0 }
              }
              transition={{ duration: 0.4 }}
              whileHover={!solved ? { y: -3 } : undefined}
              className={cn(
                'flex items-start gap-3 rounded-wobble-sm border-2 border-ink bg-paper-3 p-3.5 text-left shadow-offset transition-colors',
                revealedCorrect && 'bg-green-soft',
                revealedWrong && 'bg-red-soft',
                !solved && 'hover:bg-paper-2 cursor-pointer',
                solved && 'cursor-default',
                isPicked && !revealedCorrect && !revealedWrong && 'border-[3px]',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-xl font-bold',
                  revealedCorrect ? 'bg-green-soft' : revealedWrong ? 'bg-red-soft' : 'bg-yellow-soft',
                )}
              >
                <Kara k={`quizo:${i}`} current={current}>
                  {LETTERS[i]}
                </Kara>
              </span>
              <span className="flex-1 pt-0.5 text-[0.95rem] font-bold leading-snug text-ink">
                {option}
              </span>
              {revealedCorrect && (
                <motion.span
                  initial={{ scale: 0, rotate: -12 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 14 }}
                  className="text-green"
                >
                  <DoodleCheck className="h-6 w-6" />
                </motion.span>
              )}
              {revealedWrong && (
                <span className="font-display text-2xl font-bold text-red">✗</span>
              )}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {showExplanation && (
          <motion.div
            initial={{ opacity: 0, rotate: 6, y: 8 }}
            animate={{ opacity: 1, rotate: -1.5, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className={cn(
              'mt-4 max-w-lg rounded-wobble-2 p-3.5 pt-4 font-heading text-[0.95rem] leading-snug text-ink shadow-offset',
              solved ? 'bg-green-soft' : 'bg-yellow',
            )}
          >
            {!solved && <span className="font-bold">Not quite — </span>}
            {quiz.explanation}
            {!solved && (
              <span className="mt-1 block text-sm text-ink-soft">
                Try again — you've got this.
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
