import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Plus, Trash2, X, Sparkles, LayoutTemplate } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import WashiTape from '@/components/sketch/WashiTape';
import StickyNote from '@/components/sketch/StickyNote';
import { Toaster } from '@/components/ui/sonner';
import TemplateBar from '@/components/templates/TemplateBar';
import {
  TEMPLATE_COMPONENT_TYPES,
  TEMPLATE_COMPONENT_LABELS,
  type TemplateComponentType,
  type SlideTemplate,
} from '@contracts/slide-templates';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

export default function Templates() {
  const { user, isGuest } = useAuth();
  const utils = trpc.useUtils();
  const list = trpc.templates.list.useQuery();
  const [builderOpen, setBuilderOpen] = useState(false);

  const templates = list.data ?? [];
  const { stem, humanities, general } = useMemo(() => {
    const stemT: SlideTemplate[] = [];
    const humT: SlideTemplate[] = [];
    const genT: SlideTemplate[] = [];
    for (const t of templates) {
      if (t.tags.length === 0) genT.push(t);
      else if (
        t.tags.some((x) =>
          ['math', 'physics', 'chemistry', 'biology', 'science', 'statistics', 'data', 'economics', 'programming', 'cs', 'engineering', 'stem'].includes(x),
        )
      )
        stemT.push(t);
      else humT.push(t);
    }
    return { stem: stemT, humanities: humT, general: genT };
  }, [templates]);

  const del = trpc.templates.delete.useMutation({
    onSuccess: () => {
      toast.success('Template removed');
      void utils.templates.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const canDelete = (t: SlideTemplate) =>
    !t.builtin &&
    !!user &&
    (t.createdById === user.id || user.role === 'moderator' || user.role === 'admin');

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 lg:px-8">
      <Toaster position="bottom-right" />

      <header className="relative mb-6">
        <h1 className="font-display text-5xl font-bold text-ink">Slide templates</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          These are the slide layouts the AI can choose from when it generates a deck. Each bar is a
          recipe of components in order — <em>Text → Graph → Multiple choice</em>. STEM topics get
          the formula/graph layouts; humanities topics get the reading-heavy ones. Add your own to
          teach the generator new shapes.
        </p>
      </header>

      <StickyNote rotate={-1.5} className="mb-6 max-w-xl">
        <p className="flex items-center gap-1.5 text-[0.95rem]">
          <Sparkles className="h-4 w-4 text-purple" />
          Every template here is offered to the slide generator, filtered by the lesson's subject.
          Tag a template with things like <code>#math</code> or <code>#history</code> so it is only
          suggested for the right courses.
        </p>
      </StickyNote>

      {!isGuest && (
        <div className="mb-6">
          <SketchButton variant="accent" onClick={() => setBuilderOpen((o) => !o)}>
            {builderOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {builderOpen ? 'Close builder' : 'Add a template'}
          </SketchButton>
        </div>
      )}

      <AnimatePresence>
        {builderOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <TemplateBuilder
              onDone={() => {
                setBuilderOpen(false);
                void utils.templates.list.invalidate();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {list.isLoading && <p className="text-ink-faint">Loading templates…</p>}

      <TemplateSection title="STEM layouts" subtitle="Offered for math, science, data & technical topics" items={stem} onDelete={(id) => del.mutate({ id })} canDelete={canDelete} />
      <TemplateSection title="Humanities & reading layouts" subtitle="Offered for history, language, literature & the arts" items={humanities} onDelete={(id) => del.mutate({ id })} canDelete={canDelete} />
      <TemplateSection title="General layouts" subtitle="Offered for every subject" items={general} onDelete={(id) => del.mutate({ id })} canDelete={canDelete} />
    </div>
  );
}

function TemplateSection({
  title,
  subtitle,
  items,
  onDelete,
  canDelete,
}: {
  title: string;
  subtitle: string;
  items: SlideTemplate[];
  onDelete: (id: number) => void;
  canDelete: (t: SlideTemplate) => boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="font-heading text-2xl font-bold text-ink">{title}</h2>
      <p className="micro mb-3 text-ink-faint">{subtitle}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((t, i) => (
          <motion.article
            key={String(t.id)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE, delay: (i % 8) * 0.04 }}
            className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-4 shadow-offset"
          >
            <WashiTape rotate={i % 2 === 0 ? -3 : 2} className="left-6" />
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="font-heading text-lg font-bold text-ink">{t.name}</h3>
              <div className="flex items-center gap-1.5">
                {t.builtin ? (
                  <Chip kind="neutral" className="text-[0.6rem]">
                    <LayoutTemplate className="h-3 w-3" /> built-in
                  </Chip>
                ) : (
                  <Chip kind="slide-tool" className="text-[0.6rem]">
                    {t.createdByName ? `by ${t.createdByName}` : 'custom'}
                  </Chip>
                )}
                {canDelete(t) && typeof t.id === 'number' && (
                  <button
                    type="button"
                    onClick={() => onDelete(t.id as number)}
                    aria-label="Delete template"
                    title="Delete template"
                    className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
            <TemplateBar components={t.components} />
            {t.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {t.tags.map((tag) => (
                  <span key={tag} className="micro text-[0.6rem] text-ink-faint">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </motion.article>
        ))}
      </div>
    </section>
  );
}

function TemplateBuilder({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [components, setComponents] = useState<TemplateComponentType[]>(['prose', 'quiz']);
  const [tagsRaw, setTagsRaw] = useState('');

  const create = trpc.templates.create.useMutation({
    onSuccess: () => {
      toast.success('Template added — the generator can use it now ✦');
      void utils.templates.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const addComponent = (c: TemplateComponentType) => setComponents((cur) => [...cur, c]);
  const removeAt = (idx: number) => setComponents((cur) => cur.filter((_, i) => i !== idx));

  const submit = () => {
    if (name.trim().length < 3) {
      toast.error('Give the template a name (3+ characters)');
      return;
    }
    if (components.length === 0) {
      toast.error('Add at least one component');
      return;
    }
    const tags = tagsRaw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').toLowerCase().trim())
      .filter(Boolean);
    create.mutate({ name: name.trim(), components, tags });
  };

  return (
    <div className="mb-6 rounded-wobble-2 border-2 border-dashed border-blue bg-paper p-5 shadow-offset">
      <h2 className="font-heading text-xl font-bold text-ink">New slide template</h2>
      <p className="micro mb-4 text-ink-faint">
        Order matters — the generator lays out the slide in exactly this sequence.
      </p>

      <label className="micro mb-1 block text-ink-soft">Template name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Read the graph"
        className="mb-4 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-heading text-ink shadow-offset outline-none focus:border-blue"
      />

      <label className="micro mb-1 block text-ink-soft">Layout preview</label>
      <div className="mb-2 min-h-[44px] rounded-wobble-sm border-2 border-pencil bg-paper-2 p-2.5">
        {components.length > 0 ? (
          <TemplateBar components={components} />
        ) : (
          <span className="text-sm text-ink-faint">Add components below…</span>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {components.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => removeAt(i)}
            title="Remove"
            className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-2 py-1 text-[0.72rem] font-semibold text-ink hover:bg-red-soft"
          >
            {TEMPLATE_COMPONENT_LABELS[c]} <X className="h-3 w-3" />
          </button>
        ))}
      </div>

      <label className="micro mb-1 block text-ink-soft">Add component</label>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TEMPLATE_COMPONENT_TYPES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => addComponent(c)}
            className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-pencil bg-paper px-2 py-1 text-[0.72rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-paper-2"
          >
            <Plus className="h-3 w-3" /> {TEMPLATE_COMPONENT_LABELS[c]}
          </button>
        ))}
      </div>

      <label className="micro mb-1 block text-ink-soft">Subject tags (space or comma separated)</label>
      <input
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="#math #statistics"
        className="mb-4 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-mono text-sm text-ink shadow-offset outline-none focus:border-blue"
      />

      <div className="flex items-center justify-end gap-2">
        <SketchButton variant="ghost" onClick={onDone}>
          Cancel
        </SketchButton>
        <SketchButton variant="accent" loading={create.isPending} onClick={submit}>
          <Plus className="h-4 w-4" />
          Save template
        </SketchButton>
      </div>
    </div>
  );
}
