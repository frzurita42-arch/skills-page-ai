import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SlideQuiz } from '@contracts/types';
import { isFillBlankCorrect } from '@contracts/grade';
import { trpc } from '@/providers/trpc';
import { DoodleCheck } from '../sketch/DoodleIcons';
import { SquiggleDivider } from '../sketch/Squiggle';
import { Kara } from './SlideComponents';

const LETTERS = ['A', 'B', 'C', 'D'];
/** Text answers (fill-blank / typed) get this many tries before Next unlocks. */
const MAX_TEXT_TRIES = 3;

export interface QuizAnswer {
  /** logged first-try correctness (what scoring uses) */
  firstCorrect: boolean;
  solved: boolean;
  /** mcq/mcq2 first pick */
  firstChosen?: number;
  /** fillblank/typed first text */
  firstText?: string;
}

export interface QuizCardProps {
  quiz: SlideQuiz;
  answer: QuizAnswer | null;
  /** record the first-try result (parent owns the log) */
  onAnswer: (res: { chosen?: number; text?: string; correct: boolean }) => void;
  /** called to unlock Next */
  onSolved?: () => void;
  review?: boolean;
  current: string | null;
}

/** kind defaults to mcq for older decks */
function quizKind(q: SlideQuiz): NonNullable<SlideQuiz['kind']> {
  return q.kind ?? 'mcq';
}

export default function QuizCard(props: QuizCardProps) {
  const kind = quizKind(props.quiz);
  if (kind === 'fillblank' || kind === 'typed') {
    return <TextAnswerCard {...props} kind={kind} />;
  }
  return <ChoiceCard {...props} />;
}

/* ------------------------------------------------------------------ */
/* Multiple choice (mcq = 4 options, mcq2 = 2 options)                  */
/* ------------------------------------------------------------------ */
function ChoiceCard({ quiz, answer, onAnswer, onSolved, review = false, current }: QuizCardProps) {
  const options = quiz.options ?? [];
  const correctIndex = quiz.correctIndex ?? 0;
  const [picked, setPicked] = useState<number | null>(answer?.firstChosen ?? null);
  const [solved, setSolved] = useState(answer?.solved ?? false);
  const [shakeIdx, setShakeIdx] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(answer ? 1 : 0);

  const select = useCallback(
    (i: number) => {
      if (solved || i >= options.length) return;
      const correct = i === correctIndex;
      setPicked(i);
      if (attempts === 0 && !review) onAnswer({ chosen: i, correct });
      setAttempts((a) => a + 1);
      if (correct) {
        setSolved(true);
        onSolved?.();
      } else {
        setShakeIdx(i);
        window.setTimeout(() => setShakeIdx(null), 450);
      }
    },
    [solved, correctIndex, attempts, review, onAnswer, onSolved, options.length],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) select(n - 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [select, options.length]);

  const showExplanation = attempts > 0 || answer !== null;

  return (
    <section className="mt-10" aria-label="Quick check quiz">
      <QuizHeader question={quiz.question} current={current} />
      <div
        className={cn(
          'mt-4 grid gap-3',
          options.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {options.map((option, i) => {
          const isCorrect = i === correctIndex;
          const isPicked = picked === i;
          const revealedCorrect = solved && isCorrect;
          const revealedWrong = isPicked && !isCorrect && attempts > 0 && !solved;
          return (
            <motion.button
              key={i}
              onClick={() => select(i)}
              disabled={solved}
              animate={shakeIdx === i ? { x: [0, -4, 4, -4, 4, 0] } : { x: 0 }}
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
                {LETTERS[i] ?? i + 1}
              </span>
              <span className="flex-1 pt-0.5 text-[0.95rem] font-bold leading-snug text-ink">
                {option}
              </span>
              {revealedCorrect && (
                <span className="text-green">
                  <DoodleCheck className="h-6 w-6" />
                </span>
              )}
              {revealedWrong && <span className="font-display text-2xl font-bold text-red">✗</span>}
            </motion.button>
          );
        })}
      </div>
      <Explanation show={showExplanation} solved={solved} text={quiz.explanation} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Text answer (fillblank = exact match, typed = AI-graded)             */
/* ------------------------------------------------------------------ */
function TextAnswerCard({
  quiz,
  answer,
  onAnswer,
  onSolved,
  review = false,
  current,
  kind,
}: QuizCardProps & { kind: 'fillblank' | 'typed' }) {
  const [text, setText] = useState(answer?.firstText ?? '');
  const [solved, setSolved] = useState(answer?.solved ?? false);
  const [result, setResult] = useState<null | { correct: boolean; feedback?: string }>(
    answer ? { correct: answer.firstCorrect } : null,
  );
  const [attempts, setAttempts] = useState(answer ? 1 : 0);
  const [grading, setGrading] = useState(false);
  const gradeTyped = trpc.generate.gradeTyped.useMutation();

  const submit = useCallback(async () => {
    if (solved || review || grading || !text.trim()) return;
    // Grade this attempt. Typed answers are graded leniently by the AI on
    // MEANING (spelling / wording / terminology don't have to be exact — the
    // right idea counts); fill-blank checks the accepted answers.
    let res: { correct: boolean; feedback?: string };
    if (kind === 'fillblank') {
      const accepted = [quiz.answer ?? '', ...(quiz.acceptableAnswers ?? [])].filter(Boolean);
      res = { correct: isFillBlankCorrect(text, accepted) };
    } else {
      setGrading(true);
      try {
        res = await gradeTyped.mutateAsync({
          question: quiz.question,
          reference: quiz.answer ?? quiz.explanation,
          answer: text,
        });
      } catch {
        res = { correct: false, feedback: "Couldn't grade that — see the explanation." };
      } finally {
        setGrading(false);
      }
    }
    const nowAttempts = attempts + 1;
    if (attempts === 0) onAnswer({ text, correct: res.correct }); // first try is what scoring logs
    setAttempts(nowAttempts);
    setResult(res);
    // Correct → done. Otherwise the learner gets up to MAX_TEXT_TRIES attempts;
    // only once those are spent does Next unlock (they may skip on).
    if (res.correct || nowAttempts >= MAX_TEXT_TRIES) {
      setSolved(true);
      onSolved?.();
    }
  }, [solved, review, grading, text, kind, quiz, attempts, onAnswer, onSolved, gradeTyped]);

  const triesLeft = Math.max(0, MAX_TEXT_TRIES - attempts);
  const canRetry = !!result && !result.correct && !solved;

  return (
    <section className="mt-10" aria-label="Quick check">
      <QuizHeader question={quiz.question} current={current} />

      {kind === 'typed' ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={solved || grading}
          rows={3}
          placeholder="Type your answer…"
          className="mt-4 w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-[0.95rem] text-ink shadow-offset outline-none focus:border-blue disabled:opacity-70"
        />
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={solved}
          placeholder="Type the missing word(s)…"
          className="mt-4 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-[0.95rem] font-bold text-ink shadow-offset outline-none focus:border-blue disabled:opacity-70"
        />
      )}

      {!solved && (
        <button
          type="button"
          onClick={submit}
          disabled={grading || !text.trim()}
          className={cn(
            'mt-3 inline-flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink px-3.5 py-1.5 font-heading text-sm font-bold text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-50',
            'bg-yellow',
          )}
        >
          <Send className="h-4 w-4" />
          {grading
            ? 'Checking…'
            : canRetry
              ? `Try again (${triesLeft} left)`
              : 'Check answer'}
        </button>
      )}

      {result && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'mt-4 max-w-lg rounded-wobble-2 p-3.5 font-heading text-[0.95rem] leading-snug text-ink shadow-offset',
              result.correct ? 'bg-green-soft' : 'bg-yellow',
            )}
          >
            <span className="font-bold">
              {result.correct ? 'Correct — ' : solved ? 'Not quite — ' : 'Close, but not there yet — '}
            </span>
            {result.feedback ? `${result.feedback} ` : ''}
            {/* still has tries: nudge, don't reveal the answer yet */}
            {!result.correct && !solved && (
              <span className="mt-1 block text-sm text-ink-soft">
                {triesLeft} {triesLeft === 1 ? 'try' : 'tries'} left — you just need the right idea,
                not the exact words.
              </span>
            )}
            {/* out of tries (or correct): reveal the reference + explanation */}
            {solved && !result.correct && kind === 'fillblank' && quiz.answer && (
              <span className="block">
                Answer: <span className="font-bold">{quiz.answer}</span>.
              </span>
            )}
            {solved && <span className="block text-sm text-ink-soft">{quiz.explanation}</span>}
          </motion.div>
        </AnimatePresence>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
function QuizHeader({ question, current }: { question: string; current: string | null }) {
  return (
    <>
      <SquiggleDivider className="text-pencil" />
      <h3 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <Pencil className="h-5 w-5 text-ink" strokeWidth={2} />
        Quick check
      </h3>
      <p className="mt-2 text-[1.125rem] font-extrabold leading-snug text-ink">
        <Kara k="quizq" current={current}>
          {question}
        </Kara>
      </p>
    </>
  );
}

function Explanation({ show, solved, text }: { show: boolean; solved: boolean; text: string }) {
  return (
    <AnimatePresence>
      {show && (
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
          {text}
          {!solved && (
            <span className="mt-1 block text-sm text-ink-soft">Try again — you've got this.</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
