import { useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import DeckPlayer from '@/components/player/DeckPlayer';
import SketchButton from '@/components/sketch/SketchButton';

/**
 * Play a slide tool's hand-built presentation (source = "human"). Plays the
 * saved deck directly — no generation, no charge.
 */
export default function ManualSlidePlay() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const query = trpc.slideTools.deck.useQuery({ slug }, { enabled: !!slug, retry: false });
  const back = () => navigate('/slides');

  if (query.isLoading) {
    return <div className="mx-auto max-w-[720px] px-4 py-16 text-center text-ink-faint">Opening…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">Nothing to show</p>
        <p className="mt-2 text-ink-soft">This tool doesn't have a hand-built presentation.</p>
        <SketchButton variant="secondary" className="mt-4" onClick={back}>
          <ChevronLeft className="h-4 w-4" /> Back
        </SketchButton>
      </div>
    );
  }

  return (
    <DeckPlayer
      deck={query.data.deck}
      toolSlug={slug}
      seed={null}
      previouslyTaught={null}
      voiceURI={null}
      nextLessonTitle={null}
      commercial={null}
      walkthrough={null}
      onExit={back}
    />
  );
}
