import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import ProfileScreen from '../profile';

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

jest.mock('../../../src/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../../src/hooks/useApiClient', () => ({
  useApiClient: () => ({ apiFetch: mockApiFetch }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useFocusEffect: jest.fn(),
}));

describe('ProfileScreen save button state', () => {
  test('renders key non-edit content', () => {
    const { getByText } = render(<ProfileScreen />);
    expect(getByText('Muokkaa profiilia')).toBeTruthy();
    expect(getByText('Kirjaudu ulos')).toBeTruthy();
    expect(getByText('Turvallisuusasetukset')).toBeTruthy();
  });

  test('enables save only for valid changed username', () => {
    const { getByText, getByPlaceholderText, getByLabelText } = render(<ProfileScreen />);

    fireEvent.press(getByText('Muokkaa profiilia'));

    const saveButton = getByLabelText('Tallenna profiilin muutokset');
    expect(saveButton).toBeDisabled();

    const usernameInput = getByPlaceholderText('Käyttäjänimi');

    fireEvent.changeText(usernameInput, 'abc');
    expect(saveButton).toBeDisabled();

    fireEvent.changeText(usernameInput, 'valid_name');
    expect(saveButton).toBeEnabled();
  });

  test('shows helper message for too-short username', () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />);

    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'abc');

    expect(getByText('Käyttäjänimen pituuden tulee olla vähintään 4 merkkiä.')).toBeTruthy();
  });

  test('shows required helper message for empty username', () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />);

    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), '');

    expect(getByText('Käyttäjänimi vaaditaan ennen tallennusta.')).toBeTruthy();
  });

  test('shows no-changes helper after resetting to original username', () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />);

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

    const { getAllByText } = render(<ProfileScreen />);
    expect(getAllByText('0').length).toBeGreaterThanOrEqual(3);

    mockAuthValue.user = originalUser;
  });

  test('shows inline error banner when save fails', async () => {
    const originalImplementation = mockApiFetch.getMockImplementation();
    mockApiFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
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

    const { getByText, getByPlaceholderText, getByLabelText, findByText } = render(<ProfileScreen />);
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Tallennus epäonnistui testissä')).toBeTruthy();

    if (originalImplementation) {
      mockApiFetch.mockImplementation(originalImplementation);
    }
  });

  test('shows inline success message when save succeeds', async () => {
    const originalImplementation = mockApiFetch.getMockImplementation();
    mockApiFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
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

    const { getByText, getByPlaceholderText, getByLabelText, findByText } = render(<ProfileScreen />);
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Profiili tallennettu.')).toBeTruthy();

    if (originalImplementation) {
      mockApiFetch.mockImplementation(originalImplementation);
    }
  });

  test('auto-hides inline success message after 3 seconds', async () => {
    jest.useFakeTimers();
    const originalImplementation = mockApiFetch.getMockImplementation();
    mockApiFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
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

    const { getByText, getByPlaceholderText, getByLabelText, findByText, queryByText } = render(<ProfileScreen />);
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Profiili tallennettu.')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(queryByText('Profiili tallennettu.')).toBeNull();

    if (originalImplementation) {
      mockApiFetch.mockImplementation(originalImplementation);
    }
    jest.useRealTimers();
  });

  test('auto-hides inline error banner after 5 seconds', async () => {
    jest.useFakeTimers();
    const originalImplementation = mockApiFetch.getMockImplementation();
    mockApiFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
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

    const { getByText, getByPlaceholderText, getByLabelText, findByText, queryByText } = render(<ProfileScreen />);
    fireEvent.press(getByText('Muokkaa profiilia'));
    fireEvent.changeText(getByPlaceholderText('Käyttäjänimi'), 'valid_name');
    fireEvent.press(getByLabelText('Tallenna profiilin muutokset'));

    expect(await findByText('Tallennus epäonnistui testissä')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(queryByText('Tallennus epäonnistui testissä')).toBeNull();

    if (originalImplementation) {
      mockApiFetch.mockImplementation(originalImplementation);
    }
    jest.useRealTimers();
  });

});
