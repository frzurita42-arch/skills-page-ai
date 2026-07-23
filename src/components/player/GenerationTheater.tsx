import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import SketchButton from '../sketch/SketchButton';
import { DoodleCheck } from '../sketch/DoodleIcons';

export interface GenerationTheaterProps {
  slideCount: number;
  topic: string;
  /** true once the generate.slides mutation has resolved */
  done: boolean;
  /** fired ~600ms after the last slide stamps in */
  onComplete: () => void;
  onCancel: () => void;
}

const STATUS_LINES = [
  'Sketching slide {n} of {total}…',
  'Drawing the chart…',
  'Writing your quiz…',
  'Inking the margins…',
  'Taping in the pictures…',
  'Sharpening pencils…',
];

/**
 * STATE B — generation theater (slide-tool.md §B): a fanned stack of blank
 * frames on the left; slides fly into a horizontal row as they're
 * "generated", each stamping in and filling with pencil-line placeholders.
 */
export default function GenerationTheater({
  slideCount,
  topic,
  done,
  onComplete,
  onCancel,
}: GenerationTheaterProps) {
  const reduced = useReducedMotion();
  const [dealt, setDealt] = useState(0);
  const [stamped, setStamped] = useState(false);

  // Deal cards: leisurely while waiting, rapid catch-up once done
  useEffect(() => {
    if (dealt >= slideCount) return;
    if (!done && dealt >= slideCount - 1) return; // hold the last card until the API resolves
    const t = window.setTimeout(
      () => setDealt((d) => Math.min(slideCount, d + 1)),
      done ? 130 : 900,
    );
    return () => window.clearTimeout(t);
  }, [dealt, done, slideCount]);

  // Stamp the check + hand off to the player
  useEffect(() => {
    if (!done || dealt < slideCount) return;
    const t1 = window.setTimeout(() => setStamped(true), 250);
    const t2 = window.setTimeout(onComplete, reduced ? 150 : 850);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [done, dealt, slideCount, onComplete, reduced]);

  const status = STATUS_LINES[
    (dealt + (done ? 2 : 0)) % STATUS_LINES.length
  ].replace('{n}', String(Math.min(dealt + 1, slideCount))).replace('{total}', String(slideCount));

  return (
    <motion.div
      initial={{ rotateY: reduced ? 0 : 8, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="mx-auto w-full max-w-[960px] px-4 py-10"
      aria-live="polite"
    >
      <h1 className="text-center font-display text-4xl font-bold text-ink">
        Dealing your deck…
      </h1>
      <p className="mx-auto mt-1 max-w-md truncate text-center text-sm text-ink-soft">
        {topic}
      </p>

      <div className="mt-8 flex items-start gap-6">
        {/* fanned stack of blanks */}
        <div className="relative hidden h-40 w-28 shrink-0 sm:block" aria-hidden="true">
          {[-8, -2, 4].map((rot, i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 shadow-offset"
              style={{ transform: `rotate(${rot}deg) translateY(${i * 2}px)` }}
            />
          ))}
        </div>

        {/* dealt row */}
        <div className="flex min-h-[160px] flex-1 flex-wrap items-center gap-3">
          {Array.from({ length: dealt }).map((_, i) => (
            <motion.div
              key={i}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -80, rotate: -6 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              className="flex h-36 w-24 flex-col gap-2 rounded-wobble-sm border-2 border-ink bg-paper-3 p-2.5 shadow-offset"
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '80%' }}
                transition={{ duration: 0.25, delay: 0.1 }}
                className="h-2.5 rounded-full bg-ink/80"
              />
              <div className="skeleton-stroke h-1.5 w-full" />
              <div className="skeleton-stroke h-1.5 w-5/6" />
              <div className="skeleton-stroke h-1.5 w-4/6" />
              <div className="mt-auto rounded-sm border border-dashed border-pencil bg-paper-2 p-1">
                <div className="h-6 w-full rounded-sm bg-yellow-soft/70" />
              </div>
            </motion.div>
          ))}

          {/* green check stamp on completion */}
          {stamped && (
            <motion.span
              initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14 }}
              className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-green bg-green-soft text-green"
              aria-label="Deck ready"
            >
              <DoodleCheck className="h-7 w-7" />
            </motion.span>
          )}
        </div>
      </div>

      <p
        className={cn(
          'mt-8 text-center font-display text-3xl text-ink-soft',
          !done && 'animate-pulse',
        )}
      >
        {done ? 'Deck complete — opening the player…' : status}
      </p>

      {!done && (
        <div className="mt-6 text-center">
          <SketchButton variant="ghost" onClick={onCancel}>
            Cancel (refund &amp; back)
          </SketchButton>
        </div>
      )}
    </motion.div>
  );
}
