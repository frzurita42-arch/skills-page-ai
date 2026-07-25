import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  Check,
  ImageIcon,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import type { SlideComponent, SlideDeck, SlideQuiz } from '@contracts/types';

const inputCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue';

/**
 * Inline editor for a saved preset deck. Owner / admin only. Edits the title,
 * prose, images (replace / regenerate / describe), and multiple-choice options
 * of every slide, right on the page, then saves back to the preset.
 */
export default function PresetEditor() {
  const { slug, seq } = useParams();
  const lessonSeq = Number(seq);
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const utils = trpc.useUtils();

  const repoQ = trpc.repos.getBySlug.useQuery({ slug: slug! }, { enabled: !!slug });
  const presetQ = trpc.repos.lessonPreset.useQuery(
    { repoSlug: slug!, lessonSeq },
    { enabled: !!slug && Number.isFinite(lessonSeq) },
  );

  const isOwner =
    !!repoQ.data && (repoQ.data.ownerId === user?.id || role === 'admin');

  const [deck, setDeck] = useState<SlideDeck | null>(null);
  useEffect(() => {
    if (presetQ.data?.deck && !deck) setDeck(presetQ.data.deck);
  }, [presetQ.data, deck]);

  const save = trpc.repos.updateLessonPreset.useMutation({
    onSuccess: () => {
      toast.success('Preset updated ✓');
      void utils.repos.lessonPreset.invalidate({ repoSlug: slug!, lessonSeq });
      void utils.repos.getBySlug.invalidate({ slug: slug! });
      navigate(`/repos/${slug}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.repos.deleteLessonPreset.useMutation({
    onSuccess: () => {
      toast.success('Preset deleted');
      void utils.repos.getBySlug.invalidate({ slug: slug! });
      navigate(`/repos/${slug}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patchSlide = (si: number, patch: Partial<SlideDeck['slides'][number]>) =>
    setDeck((d) =>
      d ? { ...d, slides: d.slides.map((s, i) => (i === si ? { ...s, ...patch } : s)) } : d,
    );
  const patchComponent = (si: number, ci: number, comp: SlideComponent) =>
    setDeck((d) =>
      d
        ? {
            ...d,
            slides: d.slides.map((s, i) =>
              i === si
                ? { ...s, components: s.components.map((c, j) => (j === ci ? comp : c)) }
                : s,
            ),
          }
        : d,
    );

  if (repoQ.isLoading || presetQ.isLoading) {
    return <div className="mx-auto max-w-content px-4 py-10 text-center text-ink-faint">Loading the preset…</div>;
  }
  if (!presetQ.data || !deck) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">No saved preset to edit here.</p>
        <Link to={`/repos/${slug}`} className="mt-3 inline-block font-heading font-bold text-blue underline">
          Back to repo
        </Link>
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">Only the repo's owner or an admin can edit this preset.</p>
        <Link to={`/repos/${slug}/play/${lessonSeq}`} className="mt-3 inline-block font-heading font-bold text-blue underline">
          Watch it instead
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/repos/${slug}`}
          className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Repo
        </Link>
        <h2 className="font-display text-3xl font-bold text-ink">Edit preset</h2>
        <span className="micro text-ink-faint">{deck.slides.length} slides · level {deck.level}</span>
        <div className="ml-auto flex items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="micro text-[0.7rem] font-bold text-red">delete preset?</span>
              <SketchButton
                variant="danger"
                size="sm"
                loading={del.isPending}
                onClick={() => del.mutate({ repoSlug: slug!, lessonSeq })}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </SketchButton>
              <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </SketchButton>
            </>
          ) : (
            <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> Delete
            </SketchButton>
          )}
          <SketchButton
            variant="accent"
            size="sm"
            loading={save.isPending}
            onClick={() => save.mutate({ repoSlug: slug!, lessonSeq, deck })}
          >
            <Save className="h-4 w-4" /> Save changes
          </SketchButton>
        </div>
      </div>
      <p className="-mt-2 text-sm text-ink-soft">
        Everything with a field is editable. Changes only affect the saved free preset — students who
        customize with a ticket still generate their own version.
      </p>

      {deck.slides.map((slide, si) => (
        <section
          key={si}
          className="rounded-wobble-2 border-2 border-ink bg-paper-3 p-5 shadow-offset"
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-yellow-soft font-display text-sm font-bold text-ink">
              {si + 1}
            </span>
            <input
              className={cn(inputCls, 'font-heading text-lg font-bold')}
              value={slide.title}
              onChange={(e) => patchSlide(si, { title: e.target.value })}
              placeholder="Slide title"
            />
          </div>

          <div className="flex flex-col gap-3">
            {slide.components.map((comp, ci) => (
              <ComponentEditor
                key={ci}
                comp={comp}
                deckStyle={deck.imageStyle}
                onChange={(next) => patchComponent(si, ci, next)}
              />
            ))}
          </div>

          {slide.quiz && (slide.quiz.kind === 'mcq' || slide.quiz.kind === 'mcq2' || !slide.quiz.kind) && (
            <QuizEditor quiz={slide.quiz} onChange={(q) => patchSlide(si, { quiz: q })} />
          )}
        </section>
      ))}

      <div className="flex justify-end">
        <SketchButton
          variant="accent"
          loading={save.isPending}
          onClick={() => save.mutate({ repoSlug: slug!, lessonSeq, deck })}
        >
          <Save className="h-4 w-4" /> Save changes
        </SketchButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Label({ children }: { children: React.ReactNode }) {
  return <span className="micro mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint">{children}</span>;
}

function ComponentEditor({
  comp,
  deckStyle,
  onChange,
}: {
  comp: SlideComponent;
  deckStyle: SlideDeck['imageStyle'];
  onChange: (c: SlideComponent) => void;
}) {
  if (comp.type === 'prose') {
    return (
      <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 p-3">
        <Label>Text</Label>
        {comp.paragraphs.map((p, pi) => (
          <div key={pi} className="mb-2 flex items-start gap-1.5">
            <textarea
              className={cn(inputCls, 'min-h-[70px] resize-y')}
              value={p}
              onChange={(e) =>
                onChange({
                  ...comp,
                  paragraphs: comp.paragraphs.map((x, j) => (j === pi ? e.target.value : x)),
                })
              }
            />
            {comp.paragraphs.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...comp, paragraphs: comp.paragraphs.filter((_, j) => j !== pi) })
                }
                className="mt-1 rounded-wobble-sm p-1 text-ink-faint hover:bg-red-soft hover:text-red"
                aria-label="Remove paragraph"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...comp, paragraphs: [...comp.paragraphs, ''] })}
          className="micro flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.62rem] text-ink-soft hover:border-ink hover:text-ink"
        >
          <Plus className="h-3 w-3" /> Add paragraph
        </button>
      </div>
    );
  }

  if (comp.type === 'image') {
    return <ImageEditor comp={comp} deckStyle={deckStyle} onChange={onChange} />;
  }

  if (comp.type === 'stickynote') {
    return (
      <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 p-3">
        <Label>Sticky note</Label>
        <textarea
          className={cn(inputCls, 'min-h-[60px] resize-y')}
          value={comp.text}
          onChange={(e) => onChange({ ...comp, text: e.target.value })}
        />
      </div>
    );
  }

  if (comp.type === 'table') {
    return (
      <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 p-3">
        <Label>Table</Label>
        <input
          className={cn(inputCls, 'mb-2')}
          value={comp.title ?? ''}
          placeholder="Table title"
          onChange={(e) => onChange({ ...comp, title: e.target.value })}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {comp.columns.map((col, cci) => (
                  <th key={cci} className="p-1">
                    <input
                      className={cn(inputCls, 'font-bold')}
                      value={col}
                      onChange={(e) =>
                        onChange({
                          ...comp,
                          columns: comp.columns.map((x, j) => (j === cci ? e.target.value : x)),
                        })
                      }
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comp.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci2) => (
                    <td key={ci2} className="p-1">
                      <input
                        className={inputCls}
                        value={cell}
                        onChange={(e) =>
                          onChange({
                            ...comp,
                            rows: comp.rows.map((r, j) =>
                              j === ri ? r.map((x, k) => (k === ci2 ? e.target.value : x)) : r,
                            ),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Other component types (latex / chart / svg / code) aren't inline-editable
  // here — shown read-only so nothing is lost on save.
  return (
    <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/30 px-3 py-2">
      <Label>{comp.type} (kept as-is)</Label>
    </div>
  );
}

function ImageEditor({
  comp,
  deckStyle,
  onChange,
}: {
  comp: Extract<SlideComponent, { type: 'image' }>;
  deckStyle: SlideDeck['imageStyle'];
  onChange: (c: SlideComponent) => void;
}) {
  const style = comp.style === 'none' ? deckStyle === 'none' ? 'sketch' : deckStyle : comp.style;
  const regen = trpc.generate.slideImage.useMutation({
    onSuccess: (r) => {
      if (r.imageUrl) {
        onChange({ ...comp, imageUrl: r.imageUrl });
        toast.success('Image regenerated ✓');
      } else toast.error('No image came back — check the AI image key');
    },
    onError: (e) => toast.error(e.message),
  });

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4_000_000) {
      toast.error('Image too large (max ~4MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ ...comp, imageUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="rounded-wobble-sm border-2 border-dashed border-ink bg-paper-2/40 p-3">
      <Label>Image</Label>
      <div className="flex flex-wrap gap-3">
        <div className="w-40 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper-3">
          {comp.imageUrl ? (
            <img src={comp.imageUrl} alt={comp.alt} className="h-28 w-full object-cover" />
          ) : (
            <div className="flex h-28 w-full items-center justify-center text-ink-faint">
              <ImageIcon className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col gap-2">
          <div>
            <Label>Image prompt (used to regenerate)</Label>
            <textarea
              className={cn(inputCls, 'min-h-[48px] resize-y font-mono text-xs')}
              value={comp.prompt}
              onChange={(e) => onChange({ ...comp, prompt: e.target.value })}
            />
          </div>
          <div>
            <Label>Description / alt text</Label>
            <input
              className={inputCls}
              value={comp.alt}
              onChange={(e) => onChange({ ...comp, alt: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <SketchButton
              variant="secondary"
              size="sm"
              loading={regen.isPending}
              onClick={() => regen.mutate({ prompt: comp.prompt, style })}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </SketchButton>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-paper px-3 py-1.5 text-sm font-bold text-ink shadow-offset hover:bg-paper-2">
              <Upload className="h-3.5 w-3.5" /> Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizEditor({ quiz, onChange }: { quiz: SlideQuiz; onChange: (q: SlideQuiz) => void }) {
  const options = quiz.options ?? [];
  return (
    <div className="mt-3 rounded-wobble-sm border-2 border-ink bg-blue-soft/40 p-3">
      <Label>Multiple choice</Label>
      <input
        className={cn(inputCls, 'mb-2 font-semibold')}
        value={quiz.question}
        placeholder="Question"
        onChange={(e) => onChange({ ...quiz, question: e.target.value })}
      />
      <div className="flex flex-col gap-1.5">
        {options.map((opt, oi) => (
          <div key={oi} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...quiz, correctIndex: oi })}
              title="Mark as the correct answer"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                quiz.correctIndex === oi
                  ? 'border-green bg-green text-paper-3'
                  : 'border-pencil text-transparent hover:border-ink',
              )}
              aria-label="Mark correct"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
            <input
              className={inputCls}
              value={opt}
              onChange={(e) =>
                onChange({ ...quiz, options: options.map((x, j) => (j === oi ? e.target.value : x)) })
              }
            />
          </div>
        ))}
      </div>
      <div className="mt-2">
        <Label>Explanation (shown after answering)</Label>
        <textarea
          className={cn(inputCls, 'min-h-[48px] resize-y')}
          value={quiz.explanation}
          onChange={(e) => onChange({ ...quiz, explanation: e.target.value })}
        />
      </div>
    </div>
  );
}
