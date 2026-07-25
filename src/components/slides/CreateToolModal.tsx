import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import type { ImageStyle, Level, Tone } from '@contracts/types';
import { LEVELS, TONES, TONE_LABEL, TONE_HINT } from '@contracts/types';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';

const STYLE_PRESETS: Exclude<ImageStyle, 'none'>[] = [
  'sketch',
  'watercolor',
  'flat',
  'photo',
];

export interface CreateToolModalProps {
  open: boolean;
  onClose: () => void;
}

const inputCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB] focus:outline-none transition-shadow';

/** "New slide tool" create flow (slides-gallery.md §1): name, topic, instructions, defaults → slideTools.create */
export default function CreateToolModal({ open, onClose }: CreateToolModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [instructions, setInstructions] = useState('');
  const [level, setLevel] = useState<Level>('A1');
  const [slideCount, setSlideCount] = useState(8);
  const [imageStyle, setImageStyle] = useState<ImageStyle>('sketch');
  const [tone, setTone] = useState<Tone>('neutral');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const create = trpc.slideTools.create.useMutation({
    onSuccess: async ({ slug }) => {
      await utils.slideTools.list.invalidate();
      toast.success('Slide tool sketched into your drawer!');
      onClose();
      navigate(`/slides/${slug}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (name.trim().length < 3) {
      toast.error('Give your tool a name (3+ characters).');
      return;
    }
    create.mutate({
      name: name.trim(),
      description: topic.trim().slice(0, 200),
      topic: topic.trim(),
      instructions: instructions.trim(),
      defaultLevel: level,
      defaultSlideCount: slideCount,
      defaultImageStyle: imageStyle,
      defaultTone: tone,
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New slide tool"
            className="relative max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-9 shadow-offset sm:p-8 sm:pt-10"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />

            <h2 className="font-display text-4xl font-bold text-ink">
              New slide tool
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              A reusable deck generator. You can tweak everything again before
              each presentation.
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <label className="block">
                <span className="micro mb-1 block text-ink-soft">Name</span>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Physics Study Studio"
                  maxLength={120}
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="micro mb-1 block text-ink-soft">
                  Default topic / prompt
                </span>
                <textarea
                  className={cn(inputCls, 'min-h-[72px] resize-y font-mono')}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What should decks from this tool teach?"
                  maxLength={2000}
                />
              </label>

              <label className="block">
                <span className="micro mb-1 block text-ink-soft">
                  Custom instructions
                </span>
                <textarea
                  className={cn(inputCls, 'min-h-[64px] resize-y')}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Tone, must-cover points, things to avoid…"
                  maxLength={4000}
                />
              </label>

              <div>
                <span className="micro mb-1.5 block text-ink-soft">
                  Default level
                </span>
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLevel(l)}
                      className={cn(
                        'rounded-wobble-sm border-2 px-3 py-1 text-sm font-bold capitalize transition-all',
                        level === l
                          ? 'border-ink bg-yellow text-ink shadow-offset'
                          : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="micro mb-1.5 flex items-center justify-between text-ink-soft">
                  Default slides
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
                  aria-label="Default slide count"
                />
              </div>

              <div>
                <span className="micro mb-1.5 block text-ink-soft">
                  Default image style
                </span>
                <div className="flex flex-wrap gap-2">
                  {STYLE_PRESETS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setImageStyle(s)}
                      title={s}
                      className={cn(
                        'relative overflow-hidden rounded-wobble-sm border-2 transition-all hover:-translate-y-0.5 hover:-rotate-1',
                        imageStyle === s
                          ? 'border-ink shadow-offset'
                          : 'border-pencil opacity-70 hover:opacity-100',
                      )}
                    >
                      <img
                        src={`/style-${s}.svg`}
                        alt={`${s} style`}
                        className="h-14 w-[84px] object-cover"
                      />
                      {imageStyle === s && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-yellow text-[10px] font-bold text-ink">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setImageStyle('none')}
                    className={cn(
                      'flex h-14 items-center rounded-wobble-sm border-2 px-3 text-sm font-bold transition-all',
                      imageStyle === 'none'
                        ? 'border-ink bg-yellow shadow-offset'
                        : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                    )}
                  >
                    No images
                  </button>
                </div>
              </div>

              {/* advanced options */}
              <div className="rounded-wobble-sm border-2 border-dashed border-pencil">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  aria-expanded={advancedOpen}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="micro font-bold text-ink">Advanced options</span>
                  <span className="micro text-[0.58rem] text-ink-faint">tone</span>
                  <ChevronDown
                    className={cn('ml-auto h-4 w-4 text-ink-soft transition-transform', advancedOpen && 'rotate-180')}
                  />
                </button>
                {advancedOpen && (
                  <div className="border-t-2 border-dashed border-pencil p-3">
                    <span className="micro mb-1.5 block text-ink-soft">Default tone</span>
                    <div className="flex flex-wrap gap-2">
                      {TONES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTone(t)}
                          title={TONE_HINT[t]}
                          className={cn(
                            'rounded-wobble-sm border-2 px-3 py-1 text-sm font-bold transition-all',
                            tone === t
                              ? 'border-ink bg-yellow text-ink shadow-offset'
                              : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                          )}
                        >
                          {TONE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-ink-faint">{TONE_HINT[tone]}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <SketchButton variant="ghost" onClick={onClose}>
                Cancel
              </SketchButton>
              <SketchButton
                variant="accent"
                loading={create.isPending}
                onClick={submit}
              >
                Create slide tool
              </SketchButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
