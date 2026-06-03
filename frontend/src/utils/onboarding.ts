import { storage } from './storage';

const ONBOARDING_KEY_PREFIX = 'onboarding_completed';

export const isNewUserProfile = (user?: {
  posts_count?: number;
  followers_count?: number;
  following_count?: number;
  bio?: string | null;
  profile_picture?: string | null;
} | null) => {
  if (!user) return false;
  return (user.posts_count ?? 0) < 3 && (user.followers_count ?? 0) === 0 && (user.following_count ?? 0) <= 2;
};

export const getOnboardingStepState = (user?: {
  following_count?: number;
  posts_count?: number;
  bio?: string | null;
  profile_picture?: string | null;
} | null) => ({
  follow: (user?.following_count ?? 0) > 0,
  post: (user?.posts_count ?? 0) > 0,
  react: (user?.posts_count ?? 0) > 0 || (user?.bio || '').trim().length > 0 || !!user?.profile_picture,
});

export const getOnboardingStorageKey = (userId: string) => `${ONBOARDING_KEY_PREFIX}:${userId}`;

export const hasCompletedOnboarding = async (userId: string): Promise<boolean> => {
  const value = await storage.getItem(getOnboardingStorageKey(userId), false);
  return !!value;
};

export const markOnboardingCompleted = async (userId: string): Promise<boolean> => {
  return storage.setItem(getOnboardingStorageKey(userId), true);
};
