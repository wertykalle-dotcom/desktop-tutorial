import React from 'react';

jest.mock('react-native', () => {
  const React = require('react');
  const createMockComponent = (name: string) => {
    const Component = ({ children, ...props }: any) => React.createElement(name, props, children);
    Component.displayName = name;
    return Component;
  };

  return {
    Text: createMockComponent('Text'),
    View: createMockComponent('View'),
    ScrollView: createMockComponent('ScrollView'),
    TouchableOpacity: createMockComponent('TouchableOpacity'),
    TextInput: createMockComponent('TextInput'),
    KeyboardAvoidingView: createMockComponent('KeyboardAvoidingView'),
    Image: createMockComponent('Image'),
    ActivityIndicator: createMockComponent('ActivityIndicator'),
    RefreshControl: createMockComponent('RefreshControl'),
    Modal: createMockComponent('Modal'),
    Alert: { alert: jest.fn() },
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      flatten: (style: unknown) => style,
    },
  };
});

const { act, fireEvent, render } = require('@testing-library/react-native');

const translations: Record<string, string> = {
  profileEdit: 'Muokkaa profiilia',
  profileLogout: 'Kirjaudu ulos',
  profileSafety: 'Turvallisuusasetukset',
  profileSave: 'Tallenna',
  username: 'Käyttäjänimi',
  profileBio: 'Bio',
  profileLanguage: 'Kieli',
  profileDrafts: 'Luonnokset',
  profilePosts: 'Julkaisut',
  profileFollowers: 'Seuraajat',
  profileFollowing: 'Seurattavat',
  cancel: 'Peruuta',
  retry: 'Yritä uudelleen',
  error: 'Virhe',
  profileLogoutConfirm: 'Haluatko varmasti kirjautua ulos?',
  adminSaveRates: 'Tallenna',
  profile: 'Profiili',
};

const mockAuthValue = {
  token: 'token',
  logout: jest.fn(async () => undefined),
  updateUser: jest.fn(),
  user: {
    user_id: 'u1',
    username: 'tester',
    email: 'tester@example.com',
    bio: '',
    profile_picture: '',
    posts_count: 1,
    followers_count: 2,
    following_count: 3,
  },
};

const mockApiFetch: jest.Mock = jest.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
}));
const mockRouterPush = jest.fn();
const mockUseFocusEffect = jest.fn();

jest.mock('../../../src/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../../src/hooks/useApiClient', () => ({
  useApiClient: () => ({ apiFetch: mockApiFetch }),
}));

jest.mock('../../../src/contexts/I18nContext', () => ({
  useI18n: () => ({
    locale: 'fi',
    isRTL: false,
    isReady: true,
    setLocale: jest.fn(async () => undefined),
    t: (key: string) => translations[key] ?? key,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
  }),
  useFocusEffect: mockUseFocusEffect,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: any) => require('react').createElement('Ionicons', props),
}));

jest.mock('../../../src/utils/api/http', () => ({
  extractApiErrorMessage: async (response: { json?: () => Promise<any> }, fallback: string) => {
    try {
      const payload = await response.json?.();
      return payload?.detail ?? fallback;
    } catch {
      return fallback;
    }
  },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri })),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

const ProfileScreen = require('../profile').default;

const renderProfileScreen = (initialView: 'profile' | 'settings' | 'saved' = 'settings') =>
  render(<ProfileScreen initialView={initialView} />);

const setProfileUpdateMock = (implementation: typeof mockApiFetch extends jest.Mock ? any : never) => {
  const originalImplementation = mockApiFetch.getMockImplementation();
  mockApiFetch.mockImplementation(implementation);
  return () => {
    mockApiFetch.mockImplementation(originalImplementation ?? undefined);
  };
};

afterEach(() => {
  jest.useRealTimers();
  mockRouterPush.mockReset();
  mockUseFocusEffect.mockReset();
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
  }));
  mockAuthValue.user = {
    user_id: 'u1',
    username: 'tester',
    email: 'tester@example.com',
    bio: '',
    profile_picture: '',
    posts_count: 1,
    followers_count: 2,
    following_count: 3,
  };
});

describe('ProfileScreen save button state', () => {
  test('renders key non-edit content', () => {
    const { getByText } = renderProfileScreen('profile');
    expect(getByText('Asetukset')).toBeTruthy();
    expect(getByText('Tallennetut')).toBeTruthy();
    expect(getByText('Kieli, parisuhdestatus, turvallisuus ja uloskirjautuminen.')).toBeTruthy();
  });

  test('shows pinned live recordings on the main profile tab', async () => {
    mockUseFocusEffect.mockImplementation((callback: () => void) => {
      React.useEffect(callback, [callback]);
    });
    const restore = setProfileUpdateMock(async (path: string) => {
      if (path.startsWith('/media/posts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            {
              post_id: 'post_live_1',
              user_id: 'u1',
              username: 'tester',
              text: 'Tallenne: #Luonto',
              title: 'Tallenne: #Luonto',
              image: 'https://example.com/thumb.jpg',
              video: 'https://example.com/live.webm',
              duration: 45,
              type: 'live_recording',
              source: 'live_replay',
              pinned_to_profile: true,
              visibility: 'public',
              likes_count: 3,
              comments_count: 2,
              views: 12,
              replay_count: 4,
              is_liked: false,
              created_at: '2026-06-17T12:00:00.000Z',
            },
          ]),
        };
      }
      if (path === '/growth/achievements') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ achievements: [], creator_level: { level: 1, name: 'Starter', score: 0, progress: 5 } }),
        };
      }
      if (path === '/growth/creator-level') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ level: 1, name: 'Starter', score: 0, progress: 5 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { findByText, getByText } = renderProfileScreen('profile');

    expect(await findByText('Kiinnitetyt replayt')).toBeTruthy();
    expect(getByText('Profiilin live-tallenteet')).toBeTruthy();
    expect(getByText('Tallenne: #Luonto')).toBeTruthy();
    expect(getByText('45 s live')).toBeTruthy();
    restore();
  });

  test('locks copy link action for private recordings', async () => {
    mockUseFocusEffect.mockImplementation((callback: () => void) => {
      React.useEffect(callback, [callback]);
    });
    const restore = setProfileUpdateMock(async (path: string) => {
      if (path.startsWith('/media/posts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            {
              post_id: 'post_private_live',
              user_id: 'u1',
              username: 'tester',
              text: 'Tallenne: #Musiikki',
              title: 'Tallenne: #Musiikki',
              image: '',
              video: 'https://example.com/private.webm',
              duration: 75,
              type: 'live_recording',
              source: 'live_replay',
              pinned_to_profile: false,
              visibility: 'private',
              likes_count: 0,
              comments_count: 0,
              views: 0,
              replay_count: 0,
              is_liked: false,
              created_at: '2026-06-17T12:00:00.000Z',
            },
          ]),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { findByText, getByLabelText, getByText } = renderProfileScreen('profile');

    expect(await findByText('Recordings 1')).toBeTruthy();
    fireEvent.press(getByText('Recordings 1'));

    expect(getByText('Kansikuva puuttuu')).toBeTruthy();
    expect(getByLabelText('Yksityistä tallennetta ei voi jakaa linkillä')).toBeTruthy();
    restore();
  });

  test('saves recording thumbnail URL through the edit modal', async () => {
    mockUseFocusEffect.mockImplementation((callback: () => void) => {
      React.useEffect(callback, [callback]);
    });
    const requests: { path: string; options?: { method?: string; body?: string } }[] = [];
    const restore = setProfileUpdateMock(async (path: string, options?: { method?: string; body?: string }) => {
      requests.push({ path, options });
      if (path.startsWith('/media/posts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            {
              post_id: 'post_thumb_live',
              user_id: 'u1',
              username: 'tester',
              text: 'Tallenne: #Taide',
              title: 'Tallenne: #Taide',
              image: 'https://example.com/old.jpg',
              video: 'https://example.com/thumb.webm',
              duration: 90,
              type: 'live_recording',
              source: 'live_replay',
              pinned_to_profile: false,
              visibility: 'public',
              likes_count: 0,
              comments_count: 0,
              views: 0,
              replay_count: 0,
              is_liked: false,
              created_at: '2026-06-17T12:00:00.000Z',
            },
          ]),
        };
      }
      if (path === '/posts/post_thumb_live' && options?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            post_id: 'post_thumb_live',
            image: 'https://example.com/new.jpg',
            thumbnailUrl: 'https://example.com/new.jpg',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { findByText, getByPlaceholderText, getByText, getAllByText } = renderProfileScreen('profile');

    expect(await findByText('Recordings 1')).toBeTruthy();
    fireEvent.press(getByText('Recordings 1'));
    fireEvent.press(getByText('Muokkaa'));
    fireEvent.changeText(getByPlaceholderText('Tai liitä kansikuvan URL'), 'https://example.com/new.jpg');

    expect(getByText('Odottaa tallennusta')).toBeTruthy();
    expect(getByText('Uusi kansikuva julkaistaan, kun tallennat muutokset.')).toBeTruthy();

    fireEvent.press(getAllByText('Tallenna').at(-1));

    expect(await findByText('Tallenne päivitetty.')).toBeTruthy();
    const patchRequest = requests.find((request) => request.path === '/posts/post_thumb_live' && request.options?.method === 'PATCH');
    expect(JSON.parse(patchRequest?.options?.body || '{}')).toMatchObject({
      image: 'https://example.com/new.jpg',
      thumbnailUrl: 'https://example.com/new.jpg',
    });
    restore();
  });

  test('enables save only for valid changed username', () => {
    const { getByText, getByPlaceholderText, getByLabelText } = renderProfileScreen();

    fireEvent.press(getByText('Muokkaa profiilia'));

    const usernameInput = getByPlaceholderText('Käyttäjänimi');

    fireEvent.changeText(usernameInput, 'abc');
    fireEvent.changeText(usernameInput, 'valid_name');
    expect(getByLabelText('Tallenna profiilin muutokset')).toBeTruthy();
  });

  test('shows helper message for too-short username', () => {
    const { getByText, getByPlaceholderText } = renderProfileScreen();

    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'abc');

    expect(getByText('Käyttäjänimen pituuden tulee olla vähintään 4 merkkiä.')).toBeTruthy();
  });

  test('shows required helper message for empty username', () => {
    const { getByText, getByPlaceholderText } = renderProfileScreen();

    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), '');

    expect(getByText('Käyttäjänimi vaaditaan ennen tallennusta.')).toBeTruthy();
  });

  test('shows no-changes helper after resetting to original username', () => {
    const { getByText, getByPlaceholderText } = renderProfileScreen();

    fireEvent.press(getByText('Muokkaa profiilia'));
    const usernameInput = getByPlaceholderText('Käyttäjänimi');
    fireEvent.changeText(usernameInput, 'valid_name');
    fireEvent.changeText(usernameInput, 'tester');

    expect(getByText('Ei tallennettavia muutoksia.')).toBeTruthy();
  });

  test('renders zero stats correctly', () => {
    const originalUser = mockAuthValue.user;
    mockAuthValue.user = {
      ...originalUser,
      posts_count: 0,
      followers_count: 0,
      following_count: 0,
    };

    const { getAllByText } = renderProfileScreen('profile');
    expect(getAllByText('0').length).toBeGreaterThanOrEqual(3);
    mockAuthValue.user = originalUser;
  });

  test('shows inline error banner when save fails', async () => {
    const restore = setProfileUpdateMock(async (path: string, options?: { method?: string }) => {
      if (path === '/users/me' && options?.method === 'PUT') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Tallennus epäonnistui testissä' }),
          text: async () => JSON.stringify({ detail: 'Tallennus epäonnistui testissä' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { getByText, getByPlaceholderText, getByLabelText, findByText } = renderProfileScreen();
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Tallennus epäonnistui testissä')).toBeTruthy();
    restore();
  });

  test('shows inline success message when save succeeds', async () => {
    const restore = setProfileUpdateMock(async (path: string, options?: { method?: string }) => {
      if (path === '/users/me' && options?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...mockAuthValue.user,
            username: 'valid_name',
            posts_count: 1,
            followers_count: 2,
            following_count: 3,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { getByText, getByPlaceholderText, getByLabelText, findByText } = renderProfileScreen();
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Profiili tallennettu.')).toBeTruthy();
    restore();
  });

  test('auto-hides inline success message after 3 seconds', async () => {
    jest.useFakeTimers();
    const restore = setProfileUpdateMock(async (path: string, options?: { method?: string }) => {
      if (path === '/users/me' && options?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...mockAuthValue.user,
            username: 'valid_name',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { getByText, getByPlaceholderText, getByLabelText, findByText, queryByText } = renderProfileScreen();
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Profiili tallennettu.')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(queryByText('Profiili tallennettu.')).toBeNull();
    restore();
  });

  test('auto-hides inline error banner after 5 seconds', async () => {
    jest.useFakeTimers();
    const restore = setProfileUpdateMock(async (path: string, options?: { method?: string }) => {
      if (path === '/users/me' && options?.method === 'PUT') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Tallennus epäonnistui testissä' }),
          text: async () => JSON.stringify({ detail: 'Tallennus epäonnistui testissä' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ unread_count: 0, posts_count: 1, followers_count: 2, following_count: 3 }),
      };
    });

    const { getByText, getByPlaceholderText, getByLabelText, findByText, queryByText } = renderProfileScreen();
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Tallennus epäonnistui testissä')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(queryByText('Tallennus epäonnistui testissä')).toBeNull();
    restore();
  });

});
