const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export const API_BASE = `${EXPO_PUBLIC_BACKEND_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`;

export const buildApiHeaders = (
  initHeaders?: HeadersInit,
  token?: string | null
): Record<string, string> => {
  const headers: Record<string, string> = {
    'X-Tunnel-Skip-Bypassing-Warning': 'true',
    ...(initHeaders as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

export const apiUrl = (path: string): string => `${API_BASE}${path}`;
