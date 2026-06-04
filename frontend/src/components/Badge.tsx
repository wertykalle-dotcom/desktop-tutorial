import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'muted';

type BadgeProps = {
  icon?: ReactNode;
  label?: string;
  count?: number;
  tone?: BadgeTone;
  compact?: boolean;
  countOnly?: boolean;
  children?: ReactNode;
};

const toneStyles: Record<BadgeTone, { backgroundColor: string; borderColor: string; color: string }> = {
  neutral: { backgroundColor: '#F8FAFC', borderColor: '#D1D5DB', color: '#334155' },
  brand: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', color: '#0F62FE' },
  success: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', color: '#0F766E' },
  warning: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' },
  muted: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', color: '#64748B' },
};

export function Badge({ icon, label, count, tone = 'neutral', compact = false, countOnly = false, children }: BadgeProps) {
  const palette = toneStyles[tone];
  const resolvedLabel = label || (typeof count === 'number' ? String(count) : '');
  return (
    <View
      style={[
        styles.badge,
        compact && (countOnly ? styles.countOnly : styles.compact),
        { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
      ]}
    >
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      {resolvedLabel ? <Text style={[styles.label, { color: palette.color }]} numberOfLines={1}>{resolvedLabel}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  compact: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    gap: 3,
  },
  countOnly: {
    minWidth: 18,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 0,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 0.15, maxWidth: 96 },
});
