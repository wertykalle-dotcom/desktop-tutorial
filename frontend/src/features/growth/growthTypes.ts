export type AchievementItem = {
  achievement_id: string;
  title: string;
  description: string;
  icon: string;
  current: number;
  target: number;
  progress: number;
  unlocked: boolean;
};

export type CreatorLevel = {
  user_id?: string;
  username?: string;
  level: number;
  name: string;
  score: number;
  next_score?: number | null;
  progress: number;
  posts_count?: number;
  live_recordings_count?: number;
  likes_received?: number;
  comments_received?: number;
  views?: number;
  replay_count?: number;
  watch_time?: number;
  comments_made?: number;
};

export type DailyTrendPost = {
  post_id: string;
  title: string;
  text?: string;
  username?: string;
  type?: string;
  score: number;
  views: number;
  likes_count: number;
  comments_count: number;
  replay_count: number;
  created_at?: string;
};

export type DailyTrendTag = {
  label: string;
  score: number;
  posts: number;
};

export type DailyTrendsPayload = {
  generated_at: string;
  posts: DailyTrendPost[];
  hashtags: DailyTrendTag[];
};

export type AchievementsPayload = {
  creator_level: CreatorLevel;
  achievements: AchievementItem[];
  unlocked_count: number;
  total_count: number;
};

export type BreakingLiveStream = {
  roomId: string;
  topic: string;
  username: string;
  profilePicture?: string | null;
  count: number;
  startedAt?: string;
  breakingScore?: number;
};

export type BreakingLivePayload = {
  generated_at: string;
  streams: BreakingLiveStream[];
  top?: BreakingLiveStream | null;
};

export type SurpriseMePayload = {
  type: 'live' | 'post' | 'community';
  title: string;
  description: string;
  target: string;
  payload?: unknown;
};

export type LocalYoslaPayload = {
  region: string;
  generated_at: string;
  topics: string[];
  communities: { name: string; tag: string; description: string; members: number }[];
  posts: { post_id: string; title: string; username?: string; topic: string; score: number; created_at?: string }[];
};
