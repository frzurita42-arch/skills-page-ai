import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, MessageCircle, Link as LinkIcon, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';
import { DoodleSparkle } from '../sketch/DoodleIcons';
import type { CommercialInfo } from '@contracts/types';

/** Turn a phone-ish string into a wa.me link (digits only). */
function waLink(whatsapp: string): string | null {
  const digits = whatsapp.replace(/[^\d]/g, '');
  return digits.length >= 6 ? `https://wa.me/${digits}` : null;
}

function socialHref(s: string): string {
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('@')) return `https://instagram.com/${s.slice(1)}`;
  return `https://${s}`;
}

/**
 * The end of a commercial (menu/service/shop) presentation: instead of a score,
 * the viewer sees who's offering the item, how to reach them (WhatsApp +
 * socials), and can register interest — which drops a lead to the owner.
 */
export default function CommercialFinish({
  commercial,
  onExit,
}: {
  commercial: CommercialInfo;
  onExit: () => void;
}) {
  const { owner, itemTitle, repoSlug, lessonSeq } = commercial;
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const create = trpc.orders.create.useMutation();
  const wa = owner.whatsapp ? waLink(owner.whatsapp) : null;

  const order = () => {
    if (!repoSlug) {
      setSent(true);
      return;
    }
    create.mutate(
      { repoSlug, lessonSeq: lessonSeq ?? undefined, itemTitle, note: note.trim() || undefined },
      { onSuccess: () => setSent(true) },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[640px] px-5 py-12 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-8 shadow-offset"
      >
        <WashiTape rotate={-3} className="left-1/2 -translate-x-1/2" />
        <DoodleSparkle className="mx-auto h-8 w-8 text-purple" />
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">{itemTitle}</h1>
        <p className="mt-1 text-ink-soft">
          Offered by <span className="font-bold text-ink">{owner.name}</span>
        </p>
        {owner.contactNote && (
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-soft">{owner.contactNote}</p>
        )}

        {/* contact ways */}
        <div className="mt-6 flex flex-col items-stretch gap-2">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="no-underline">
              <SketchButton variant="accent" className="w-full">
                <MessageCircle className="h-4 w-4" /> Message on WhatsApp
              </SketchButton>
            </a>
          )}
          {owner.socials.map((s) => (
            <a
              key={s}
              href={socialHref(s)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-2 font-heading text-sm text-ink no-underline transition-colors hover:border-ink hover:bg-paper-2"
            >
              <LinkIcon className="h-3.5 w-3.5" /> {s}
            </a>
          ))}
          {!wa && owner.socials.length === 0 && (
            <p className="text-sm text-ink-faint">
              The seller hasn't added contact details yet.
            </p>
          )}
        </div>

        {/* register interest */}
        <div className="mt-6 border-t-2 border-dashed border-pencil pt-5 text-left">
          {sent ? (
            <div className="flex items-start gap-2 rounded-wobble-sm bg-green-soft p-3.5 font-heading text-ink">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-green" />
              <span>
                Interest sent — <span className="font-bold">{owner.name}</span> will see that you're
                interested in <span className="font-bold">{itemTitle}</span>. Reach out directly too
                for the fastest reply.
              </span>
            </div>
          ) : (
            <>
              <label className="micro mb-1 block text-ink-soft">
                Interested? Send them a note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={`e.g. I'd like to order ${itemTitle}…`}
                className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 text-sm text-ink shadow-offset outline-none focus:border-blue"
              />
              <SketchButton
                variant="primary"
                className={cn('mt-3 w-full')}
                loading={create.isPending}
                onClick={order}
              >
                <ShoppingBag className="h-4 w-4" /> I'm interested
              </SketchButton>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onExit}
          className="mt-5 font-heading text-sm text-ink-soft underline-offset-2 hover:text-ink hover:underline"
        >
          Back to browsing
        </button>
      </motion.div>
    </div>
  );
}
