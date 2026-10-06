import { clsx } from 'clsx'
import type { TrackOrigin } from '../../types/job'

const ORIGIN_LABEL: Record<TrackOrigin, string> = {
  chapters: 'From chapters',
  description: 'From description',
  comment: 'From a comment',
  silence: 'From audio gaps',
  playlist: 'Playlist video',
  single: 'Whole video',
  manual: 'Edited by you',
  pasted: 'From your tracklist',
}

export default function ConfidenceBadge({ confidence, origin }: { confidence: number; origin: TrackOrigin }) {
  const level = confidence >= 0.85 ? 'high' : confidence >= 0.7 ? 'medium' : 'low'
  const text = origin === 'manual' ? 'Edited' : level === 'low' ? 'Check' : level === 'medium' ? 'Likely' : 'Sure'
  return (
    <span
      title={`${ORIGIN_LABEL[origin]} · ${Math.round(confidence * 100)}% confident`}
      className={clsx(
        'inline-flex items-center h-5 px-2 rounded-full text-[11px] font-semibold',
        origin === 'manual' && 'bg-raised text-muted',
        origin !== 'manual' && level === 'high' && 'bg-ok/15 text-ok',
        origin !== 'manual' && level === 'medium' && 'bg-accent/15 text-accent',
        origin !== 'manual' && level === 'low' && 'bg-warn/15 text-warn',
      )}
    >
      {text}
    </span>
  )
}

export { ORIGIN_LABEL }
