export type VideoMetricsPost = {
  type?: string | null;
  source?: string | null;
  is_clip?: boolean;
  text?: string | null;
  title?: string | null;
  duration?: number | null;
  views?: number | null;
  likes_count?: number | null;
  comments_count?: number | null;
  replay_count?: number | null;
  created_at?: string | null;
};

export const isLiveReplayPost = (post: VideoMetricsPost) => {
  const marker = `${post.type || ''} ${post.source || ''} ${post.title || ''} ${post.text || ''}`;
  return /live_recording|live_replay|Live Recording|Live Replay|Tallenne:/i.test(marker);
};

export const formatReplayDuration = (seconds?: number | null) => {
  const total = Math.max(0, Math.round(seconds || 0));
  if (!total) return 'Live replay';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min live`;
  if (minutes > 0) return `${minutes} min live`;
  return `${secs} s live`;
};

export const formatCompactCount = (value?: number | null) => {
  const count = Math.max(0, Number(value || 0));
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return String(count);
};

export const formatReplayDate = (createdAt?: string | null) => {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' });
};
