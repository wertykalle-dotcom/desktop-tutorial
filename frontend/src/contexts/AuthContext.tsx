import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiUrl, buildApiHeaders } from '../utils/api/http';
import { normalizeRole, type RoleKey } from '../utils/roles';

interface User {
  user_id: string;
  email: string;
  username: string;
  profile_picture?: string;
  bio?: string;
  relationship_status?: 'single' | 'relationship' | 'complicated' | 'private';
  followers_count: number;
  following_count: number;
  posts_count: number;
  role?: RoleKey;
  banned_until?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string, dateOfBirth: string, acceptTerms: boolean, acceptPrivacy: boolean) => Promise<void>;
  loginWithGoogle: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

const TOKEN_KEY = 'auth_token';

const parseErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        return payload.detail;
      }
    } else {
      const text = await response.text();
      if (text.trim()) return text.trim();
    }
  } catch {
    // Ignore parse errors and fall back to generic message.
  }
  return fallback;
};

const getFriendlyAuthErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    const raw = error.message || '';
    const normalized = raw.toLowerCase();
    if (
      normalized.includes('network request failed') ||
      normalized.includes('failed to fetch') ||
      normalized.includes('networkerror') ||
      normalized.includes('load failed')
    ) {
      return 'Palvelimeen ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.';
    }
    if (raw.trim()) return raw;
  }
  return fallback;
};

const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return localStorage.getItem(TOKEN_KEY);
  }
  return await SecureStore.getItemAsync(TOKEN_KEY);
};

const setToken = async (token: string): Promise<void> => {
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
};

const removeToken = async (): Promise<void> => {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
};

const normalizeUser = (userData: Record<string, unknown> | null | undefined): User | null => {
  if (!userData) return null;
  const user = userData as unknown as User;
  return {
    ...user,
    role: normalizeRole(typeof userData.role === 'string' ? userData.role : user.role),
  };
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      const savedToken = await getToken();
      if (savedToken) {
        const response = await fetch(apiUrl('/auth/me'), {
          headers: buildApiHeaders(undefined, savedToken),
        });

        if (response.ok) {
          const userData = await response.json();
          setUser(normalizeUser(userData));
          setTokenState(savedToken);
        } else {
          await removeToken();
          setTokenState(null);
          setUser(null);
        }
      }
    } catch (error) {
      console.error('Error checking session:', error);
      await removeToken();
      setTokenState(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response, 'Kirjautuminen epäonnistui');
        throw new Error(message);
      }

      const data = await response.json();
      await setToken(data.token);
      setTokenState(data.token);
      setUser(normalizeUser(data.user));
    } catch (error) {
      console.error('Login error:', error);
      throw new Error(getFriendlyAuthErrorMessage(error, 'Kirjautuminen epäonnistui'));
    }
  };

  const register = async (
    email: string,
    password: string,
    username: string,
    dateOfBirth: string,
    acceptTerms: boolean,
    acceptPrivacy: boolean,
  ) => {
    try {
      const response = await fetch(apiUrl('/auth/register'), {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          password,
          username,
          date_of_birth: dateOfBirth,
          accept_terms: acceptTerms,
          accept_privacy: acceptPrivacy,
        })
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response, 'Rekisteröinti epäonnistui');
        throw new Error(message);
      }

      const data = await response.json();
      await setToken(data.token);
      setTokenState(data.token);
      setUser(normalizeUser(data.user));
    } catch (error) {
      console.error('Registration error:', error);
      throw new Error(getFriendlyAuthErrorMessage(error, 'Rekisteröinti epäonnistui'));
    }
  };

  const loginWithGoogle = async (sessionId: string) => {
    try {
      const response = await fetch(apiUrl('/auth/google/session'), {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ session_id: sessionId })
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response, 'Google-kirjautuminen epäonnistui');
        throw new Error(message);
      }

      const data = await response.json();
      await setToken(data.token);
      setTokenState(data.token);
      setUser(normalizeUser(data.user));
    } catch (error) {
      console.error('Google login error:', error);
      throw new Error(getFriendlyAuthErrorMessage(error, 'Google-kirjautuminen epäonnistui'));
    }
  };

  const logout = async () => {
    const previousToken = token;
    try {
      if (previousToken) {
        await fetch(apiUrl('/auth/logout'), {
          method: 'POST',
          headers: buildApiHeaders(undefined, previousToken),
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      try {
        await removeToken();
      } catch (storageError) {
        console.error('Logout storage cleanup error:', storageError);
      }
      setTokenState(null);
      setUser(null);
      setLoading(false);
    }
  };

  const updateUser = (userData: Partial<User>) => {
    setUser((prevUser) => (prevUser ? { ...prevUser, ...userData, role: normalizeRole(userData.role ?? prevUser.role) } : prevUser));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        loginWithGoogle,
        logout,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
