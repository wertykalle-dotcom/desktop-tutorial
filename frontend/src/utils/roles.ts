export type RoleKey = 'super_admin' | 'moderator' | 'user';

export const ROLE_LABELS: Record<RoleKey, string> = {
  super_admin: 'Super Admin',
  moderator: 'Moderator',
  user: 'User',
};

export const ROLE_OPTIONS: RoleKey[] = ['user', 'moderator', 'super_admin'];

export const normalizeRole = (raw?: string | null): RoleKey => {
  const normalized = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'super_admin' || normalized === 'superadmin' || normalized === 'admin') return 'super_admin';
  if (normalized === 'moderator' || normalized === 'mod') return 'moderator';
  return 'user';
};

export const roleLabel = (raw?: string | null): string => ROLE_LABELS[normalizeRole(raw)];

export const isSuperAdmin = (raw?: string | null): boolean => normalizeRole(raw) === 'super_admin';
export const canModerate = (raw?: string | null): boolean => {
  const role = normalizeRole(raw);
  return role === 'super_admin' || role === 'moderator';
};
