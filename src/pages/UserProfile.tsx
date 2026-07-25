import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, MessageCircle, Star } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import Chip from '@/components/sketch/Chip';
import RepoCard from '@/components/repo/RepoCard';
import { TemplateIcon } from '@/components/repo/shared';
import type { RepoSummary, RepoTemplate } from '@contracts/types';

const CATEGORIES = ['all', 'course', 'restaurant', 'service', 'shop'] as const;
const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  all: 'All',
  course: 'Course',
  restaurant: 'Restaurant',
  service: 'Service',
  shop: 'Shop',
};

/** A creator's public profile: their published repos, filterable by category. */
export default function UserProfile() {
  const { id } = useParams();
  const userId = Number(id);
  const { user, isGuest } = useAuth();
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<RepoTemplate | 'all'>('all');

  const profile = trpc.users.profile.useQuery({ userId }, { enabled: Number.isFinite(userId) });

  const toggleFav = trpc.users.toggleFavorite.useMutation({
    onMutate: async () => {
      await utils.users.profile.cancel({ userId });
      const prev = utils.users.profile.getData({ userId });
      utils.users.profile.setData({ userId }, (old) =>
        old ? { ...old, favorite: !old.favorite } : old,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) utils.users.profile.setData({ userId }, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => void utils.users.profile.invalidate({ userId }),
  });

  const toggleRepoFav = trpc.repos.toggleFavorite.useMutation({
    onError: (e) => toast.error(e.message),
    onSettled: () => void utils.users.profile.invalidate({ userId }),
  });
  const onRepoFav = (repo: RepoSummary) => {
    if (isGuest) {
      toast.error('Sign in to favorite');
      return;
    }
    toggleRepoFav.mutate({ slug: repo.slug });
  };

  const repos = profile.data?.repos ?? [];
  const filtered = useMemo(
    () => (category === 'all' ? repos : repos.filter((r) => r.template === category)),
    [repos, category],
  );

  const onFav = () => {
    if (isGuest) {
      toast.error('Sign in to favorite creators');
      return;
    }
    toggleFav.mutate({ userId });
  };

  if (profile.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-10 text-center text-ink-faint">
        Opening their notebook shelf…
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">Couldn't find that creator.</p>
        <Link to="/users" className="mt-3 inline-block font-heading font-bold text-blue underline">
          Back to creators
        </Link>
      </div>
    );
  }

  const p = profile.data;
  const isSelf = user?.id === p.id;
  const hasContact = !!p.whatsapp || p.socials.length > 0 || !!p.contactNote;
  const waHref = p.whatsapp
    ? `https://wa.me/${p.whatsapp.replace(/[^0-9]/g, '')}`
    : null;

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <Link
        to="/users"
        className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Creators
      </Link>

      {/* header */}
      <section className="flex flex-wrap items-center gap-4 rounded-wobble-2 border-2 border-ink bg-paper-3 p-5 shadow-offset">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-4xl text-ink shadow-offset">
          {p.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-3xl font-bold text-ink">{p.name}</h2>
            <Chip kind={p.role}>{p.role}</Chip>
            {isSelf && <Chip kind="neutral">you</Chip>}
          </div>
          <p className="micro mt-1 text-ink-faint">
            {p.repos.length} published repo{p.repos.length === 1 ? '' : 's'} · member since{' '}
            {new Date(p.createdAt).toLocaleDateString()}
          </p>
          {p.contactNote && <p className="mt-2 text-sm text-ink-soft">{p.contactNote}</p>}
          {hasContact && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-green bg-green-soft px-3 py-1.5 text-sm font-bold text-ink no-underline shadow-offset hover:bg-green/20"
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              )}
              {p.socials.map((s) => (
                <a
                  key={s}
                  href={s.startsWith('http') ? s : `https://${s}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-xs font-semibold text-ink-soft no-underline hover:border-ink hover:text-ink"
                >
                  {s.replace(/^https?:\/\//, '')}
                </a>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onFav}
          className={cn(
            'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-2 text-sm font-bold transition-colors',
            p.favorite
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
          )}
        >
          <Star className={cn('h-4 w-4', p.favorite && 'fill-ink')} strokeWidth={2} />
          {p.favorite ? 'Favorited' : 'Favorite'}
        </button>
      </section>

      {/* category filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors',
                active
                  ? 'border-ink bg-yellow text-ink shadow-offset'
                  : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              {c !== 'all' && <TemplateIcon template={c} className="h-3.5 w-3.5" />}
              {CATEGORY_LABEL[c]}
            </button>
          );
        })}
      </div>

      {/* repo grid */}
      {filtered.length === 0 ? (
        <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/50 p-10 text-center text-ink-faint">
          {repos.length === 0
            ? "This creator hasn't published anything public yet."
            : 'Nothing in this category.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((repo: RepoSummary, i) => (
            <RepoCard key={repo.slug} repo={repo} index={i} onToggleFavorite={onRepoFav} />
          ))}
        </div>
      )}
    </div>
  );
}
