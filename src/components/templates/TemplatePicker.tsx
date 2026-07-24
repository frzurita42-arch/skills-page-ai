import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  sectionForTags,
  templateSequenceLabel,
  TEMPLATE_SECTION_LABEL,
  type SlideTemplate,
  type TemplateSection,
} from '@contracts/slide-templates';

/** Category colour so the section reads at a glance in the picker. */
const SECTION_COLOR: Record<TemplateSection, string> = {
  stem: 'text-blue',
  humanities: 'text-orange',
  general: 'text-green',
};

/** The coloured "· STEM" / "· Humanities" / "· General" tag for a template. */
function SectionTag({ t }: { t: SlideTemplate }) {
  const section = sectionForTags(t.tags);
  return (
    <span className={cn('font-bold', SECTION_COLOR[section])}>
      {TEMPLATE_SECTION_LABEL[section]}
    </span>
  );
}

/** Full option label: name · <coloured section> (level) — Text · Table · … */
function OptionLabel({ t, withSequence }: { t: SlideTemplate; withSequence: boolean }) {
  return (
    <>
      {t.name} · <SectionTag t={t} /> ({t.level})
      {withSequence ? ` — ${templateSequenceLabel(t.components)}` : ''}
    </>
  );
}

type PanelRect = { left: number; top: number; width: number; maxHeight: number };

/**
 * A per-slide layout picker. Replaces the native <select> so the subject
 * section (STEM/Humanities/General) can be colour-coded — native <option>
 * text can't be styled per word.
 *
 * The open panel is rendered in a PORTAL on document.body with fixed
 * positioning so it is never clipped or z-index-trapped by the collapsible
 * Advanced section it lives in (whose animation wrapper creates its own
 * stacking + overflow context).
 */
export default function TemplatePicker({
  value,
  templates,
  onChange,
}: {
  /** selected template name, or '' for Auto */
  value: string;
  templates: SlideTemplate[];
  onChange: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<PanelRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);

  // Position the portal panel under (or above) the trigger, based on its
  // on-screen rect. Recomputed on open and on any scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 4;
      const below = window.innerHeight - r.bottom - gap;
      const above = r.top - gap;
      const openUp = below < 240 && above > below;
      setRect({
        left: r.left,
        top: openUp ? r.top : r.bottom + gap,
        width: r.width,
        maxHeight: Math.min(288, Math.max(140, (openUp ? above : below) - 8)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Close on outside click (trigger + portal panel both count as "inside")
  // and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value ? templates.find((t) => t.name === value) : undefined;

  const pick = (name: string | null) => {
    onChange(name);
    setOpen(false);
  };

  const optionClasses = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 whitespace-nowrap rounded-wobble-sm px-2.5 py-1.5 text-left font-heading text-sm text-ink hover:bg-paper-2',
      active && 'bg-paper-2',
    );

  return (
    <div className="relative min-w-[180px] flex-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-wobble-sm border-2 border-ink bg-paper px-2 py-1 text-left font-heading text-sm text-ink outline-none focus:border-blue"
      >
        <span className="truncate">
          {selected ? <OptionLabel t={selected} withSequence={false} /> : 'Auto (AI chooses)'}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink-soft transition-transform', open && 'rotate-180')}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.ul
              ref={panelRef}
              role="listbox"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'fixed',
                left: rect.left,
                top: rect.top,
                minWidth: rect.width,
                maxWidth: 'min(88vw, 560px)',
                maxHeight: rect.maxHeight,
              }}
              className="z-[100] w-max overflow-y-auto rounded-wobble-sm border-2 border-ink bg-paper-3 p-1 shadow-offset"
            >
              <li role="option" aria-selected={!value}>
                <button type="button" onClick={() => pick(null)} className={optionClasses(!value)}>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', !value ? 'text-ink' : 'opacity-0')} />
                  Auto (AI chooses)
                </button>
              </li>
              {templates.map((t) => (
                <li key={String(t.id)} role="option" aria-selected={value === t.name}>
                  <button
                    type="button"
                    onClick={() => pick(t.name)}
                    className={optionClasses(value === t.name)}
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        value === t.name ? 'text-ink' : 'opacity-0',
                      )}
                    />
                    <span>
                      <OptionLabel t={t} withSequence />
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
