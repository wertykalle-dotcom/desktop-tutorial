const MIN_USERNAME_LENGTH = 4;
export const MAX_USERNAME_LENGTH = 24;
export const MAX_BIO_LENGTH = 150;
export const BIO_WARNING_THRESHOLD = 140;
export const PROFILE_ERROR_BANNER_TIMEOUT_MS = 5000;
export const PROFILE_SUCCESS_BANNER_TIMEOUT_MS = 3000;
export const PROFILE_MESSAGES = {
  galleryPermissionTitle: 'Lupa vaaditaan',
  galleryPermissionDescription: 'Gallerian käyttöoikeus vaaditaan',
  imagePickFailed: 'Kuvan valinta tai pienennys epäonnistui',
  profileRefreshFailed: 'Profiilin tietojen päivitys epäonnistui. Yritä uudelleen.',
  profileUpdateFailed: 'Profiilin päivitys epäonnistui',
  profileSaved: 'Profiili tallennettu.',
} as const;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export const getUsernameValidationMessage = (normalizedUsername: string): string | null => {
  const isUsernameTooShort = normalizedUsername.length > 0 && normalizedUsername.length < MIN_USERNAME_LENGTH;
  const isUsernameTooLong = normalizedUsername.length > MAX_USERNAME_LENGTH;
  const isUsernameInvalid = normalizedUsername.length > 0 && !USERNAME_PATTERN.test(normalizedUsername);

  if (!normalizedUsername) return 'Käyttäjänimi vaaditaan ennen tallennusta.';
  if (isUsernameTooShort) return `Käyttäjänimen pituuden tulee olla vähintään ${MIN_USERNAME_LENGTH} merkkiä.`;
  if (isUsernameTooLong) return `Käyttäjänimi voi olla enintään ${MAX_USERNAME_LENGTH} merkkiä.`;
  if (isUsernameInvalid) return 'Käyttäjänimi voi sisältää vain kirjaimia, numeroita ja alaviivan (_).';
  return null;
};

export const getSaveHelperText = (
  usernameValidationMessage: string | null,
  hasProfileChanges: boolean
): string | null => {
  if (usernameValidationMessage) return usernameValidationMessage;
  if (!hasProfileChanges) return 'Ei tallennettavia muutoksia.';
  return null;
};

export type ProfileSnapshot = {
  username?: string;
  bio?: string;
  profile_picture?: string;
  posts_count?: number;
  followers_count?: number;
  following_count?: number;
};

export type ProfileStats = {
  posts_count: number;
  followers_count: number;
  following_count: number;
};

export const hasProfileChanges = (
  original: ProfileSnapshot | null | undefined,
  normalizedUsername: string,
  normalizedBio: string,
  profilePicture: string
): boolean =>
  normalizedUsername !== (original?.username || '') ||
  normalizedBio !== (original?.bio || '') ||
  (profilePicture || '') !== (original?.profile_picture || '');

export const buildProfileUpdatePayload = (
  normalizedUsername: string,
  normalizedBio: string,
  profilePicture: string
) => ({
  username: normalizedUsername,
  bio: normalizedBio || null,
  profile_picture: profilePicture || null,
});

export const formatNotificationsLabel = (unreadCount: number): string =>
  unreadCount > 0 ? `Ilmoitukset (${unreadCount})` : 'Ilmoitukset';

export const normalizeProfileStats = (
  source: Pick<ProfileSnapshot, 'posts_count' | 'followers_count' | 'following_count'> | null | undefined,
  fallback?: ProfileStats
): ProfileStats => ({
  posts_count: source?.posts_count ?? fallback?.posts_count ?? 0,
  followers_count: source?.followers_count ?? fallback?.followers_count ?? 0,
  following_count: source?.following_count ?? fallback?.following_count ?? 0,
});
