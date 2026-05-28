import {
  buildProfileUpdatePayload,
  formatNotificationsLabel,
  getSaveHelperText,
  getUsernameValidationMessage,
  hasProfileChanges,
  normalizeProfileStats,
  PROFILE_ERROR_BANNER_TIMEOUT_MS,
  PROFILE_MESSAGES,
  PROFILE_SUCCESS_BANNER_TIMEOUT_MS,
} from '../../../src/features/profile/profile-helpers';

describe('profile validation helpers', () => {
  test('returns required message for empty username', () => {
    expect(getUsernameValidationMessage('')).toBe('Käyttäjänimi vaaditaan ennen tallennusta.');
  });

  test('returns too-short message for 3 chars', () => {
    expect(getUsernameValidationMessage('abc')).toBe('Käyttäjänimen pituuden tulee olla vähintään 4 merkkiä.');
  });

  test('returns invalid-format message for unsupported characters', () => {
    expect(getUsernameValidationMessage('abcd!')).toBe(
      'Käyttäjänimi voi sisältää vain kirjaimia, numeroita ja alaviivan (_).'
    );
  });

  test('returns null for valid username', () => {
    expect(getUsernameValidationMessage('valid_name1')).toBeNull();
  });

  test('returns too-long message for usernames over max length', () => {
    expect(getUsernameValidationMessage('a'.repeat(25))).toBe('Käyttäjänimi voi olla enintään 24 merkkiä.');
  });

  test('accepts underscore-only valid format when length is valid', () => {
    expect(getUsernameValidationMessage('____')).toBeNull();
  });

  test('prefers validation message in save helper', () => {
    expect(getSaveHelperText('Virheviesti', true)).toBe('Virheviesti');
  });

  test('returns no-changes message when valid but unchanged', () => {
    expect(getSaveHelperText(null, false)).toBe('Ei tallennettavia muutoksia.');
  });

  test('returns null when valid and changed', () => {
    expect(getSaveHelperText(null, true)).toBeNull();
  });

  test('hasProfileChanges returns false when values match', () => {
    const original = { username: 'tester', bio: 'bio', profile_picture: 'pic' };
    expect(hasProfileChanges(original, 'tester', 'bio', 'pic')).toBe(false);
  });

  test('hasProfileChanges returns true when username changes', () => {
    const original = { username: 'tester', bio: 'bio', profile_picture: 'pic' };
    expect(hasProfileChanges(original, 'tester2', 'bio', 'pic')).toBe(true);
  });

  test('hasProfileChanges returns false when original is missing and values are empty', () => {
    expect(hasProfileChanges(null, '', '', '')).toBe(false);
  });

  test('hasProfileChanges returns true when original is missing and any value is set', () => {
    expect(hasProfileChanges(undefined, 'tester', '', '')).toBe(true);
  });

  test('buildProfileUpdatePayload normalizes empty optional values to null', () => {
    expect(buildProfileUpdatePayload('tester', '', '')).toEqual({
      username: 'tester',
      bio: null,
      profile_picture: null,
    });
  });

  test('buildProfileUpdatePayload preserves non-empty bio and picture', () => {
    expect(buildProfileUpdatePayload('tester', 'bio text', 'pic-url')).toEqual({
      username: 'tester',
      bio: 'bio text',
      profile_picture: 'pic-url',
    });
  });

  test('buildProfileUpdatePayload keeps already-trimmed values as-is', () => {
    expect(buildProfileUpdatePayload('name_1', 'about me', 'https://img')).toEqual({
      username: 'name_1',
      bio: 'about me',
      profile_picture: 'https://img',
    });
  });

  test('formatNotificationsLabel returns base label for zero unread count', () => {
    expect(formatNotificationsLabel(0)).toBe('Ilmoitukset');
  });

  test('formatNotificationsLabel includes count when unread count is positive', () => {
    expect(formatNotificationsLabel(3)).toBe('Ilmoitukset (3)');
  });

  test('normalizeProfileStats returns zeros when source is missing', () => {
    expect(normalizeProfileStats(null)).toEqual({
      posts_count: 0,
      followers_count: 0,
      following_count: 0,
    });
  });

  test('normalizeProfileStats uses source values when present', () => {
    expect(
      normalizeProfileStats({
        posts_count: 5,
        followers_count: 7,
        following_count: 9,
      })
    ).toEqual({
      posts_count: 5,
      followers_count: 7,
      following_count: 9,
    });
  });

  test('normalizeProfileStats falls back field-by-field when source values are missing', () => {
    expect(
      normalizeProfileStats(
        { posts_count: 2, followers_count: undefined, following_count: undefined },
        { posts_count: 10, followers_count: 11, following_count: 12 }
      )
    ).toEqual({
      posts_count: 2,
      followers_count: 11,
      following_count: 12,
    });
  });

  test('profile banner timeout constants stay stable', () => {
    expect(PROFILE_ERROR_BANNER_TIMEOUT_MS).toBe(5000);
    expect(PROFILE_SUCCESS_BANNER_TIMEOUT_MS).toBe(3000);
  });

  test('profile message constants include key UX strings', () => {
    expect(PROFILE_MESSAGES.profileSaved).toBe('Profiili tallennettu.');
    expect(PROFILE_MESSAGES.profileUpdateFailed).toBe('Profiilin päivitys epäonnistui');
    expect(PROFILE_MESSAGES.profileRefreshFailed).toBe('Profiilin tietojen päivitys epäonnistui. Yritä uudelleen.');
  });
});
