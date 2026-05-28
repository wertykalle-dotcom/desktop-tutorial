import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE, apiUrl, buildApiHeaders } from '../utils/api/http';

type ApiFetchOptions = {
  handleUnauthorized?: boolean;
  requireAuth?: boolean;
  handleNetworkError?: boolean;
};

export function useApiClient() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const hasHandledUnauthorizedRef = useRef(false);
  const hasHandledNetworkErrorRef = useRef(false);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}, options: ApiFetchOptions = {}) => {
      const { handleUnauthorized = true, requireAuth = true, handleNetworkError = true } = options;
      if (requireAuth && !token) return null;

      const headers = buildApiHeaders(init.headers, requireAuth ? token : null);
      let response: Response;
      try {
        response = await fetch(apiUrl(path), { ...init, headers });
      } catch (error) {
        if (handleNetworkError && !hasHandledNetworkErrorRef.current) {
          hasHandledNetworkErrorRef.current = true;
          Alert.alert(
            'Yhteysongelma',
            'Palvelimeen ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.'
          );
        }
        return null;
      }

      hasHandledNetworkErrorRef.current = false;

      if (response.status === 401 && requireAuth && handleUnauthorized) {
        if (!hasHandledUnauthorizedRef.current) {
          hasHandledUnauthorizedRef.current = true;
          Alert.alert('Istunto vanhentui', 'Kirjaudu uudelleen sisään.');
        }
        await logout();
        router.replace('/(auth)/login');
      }

      return response;
    },
    [token, logout, router]
  );

  return { apiFetch, apiBase: API_BASE };
}
