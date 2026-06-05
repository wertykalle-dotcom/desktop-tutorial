const EXPO_PUBLIC_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const resolveBackendBaseUrl = () => {
  const rawEnvUrl = EXPO_PUBLIC_API_BASE_URL || EXPO_PUBLIC_BACKEND_URL;
  const envUrl = rawEnvUrl.replace(/\/+$/, '').replace(/\/api$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    const browserOrigin = window.location.origin;
    const browserBackendOrigin = browserOrigin
      .replace(/:8084$/, ':8000')
      .replace(/-8084(\.)/, '-8000$1');

    if (
      !envUrl ||
      envUrl.includes('localhost') ||
      envUrl.includes('127.0.0.1')
    ) {
      return browserBackendOrigin;
    }

    return envUrl;
  }

  if (envUrl) return envUrl;
  return 'http://127.0.0.1:8000';
};

export const API_BASE = `${resolveBackendBaseUrl()}/api`;

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

export const extractApiErrorMessage = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  try {
    const data = await response.json();
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (data?.detail) return data.detail;
  } catch {
    // JSON parse failed, fall through
  }
  return fallbackMessage;
};
