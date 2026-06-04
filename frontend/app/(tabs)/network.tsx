import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../src/contexts/I18nContext';
import { useAuth } from '../../src/contexts/AuthContext';
import { defaultNetwork, type NetworkItem } from '../../src/features/directories/directory-data';
import { useApiClient } from '../../src/hooks/useApiClient';

export default function NetworkScreen() {
  const { isRTL } = useI18n();
  const { token } = useAuth();
  const { apiFetch } = useApiClient();
  const [metrics, setMetrics] = useState<NetworkItem[]>(defaultNetwork);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      const response = await apiFetch('/network', {}, { requireAuth: true });
      const data = response ? await response.json() : null;
      if (!mounted) return;
      setMetrics(Array.isArray(data?.metrics) ? data.metrics : defaultNetwork);
      setLoading(false);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [apiFetch, token]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.title, isRTL && styles.textRight]}>Verkosto</Text>
      <Text style={[styles.body, isRTL && styles.textRight]}>Aktiiviset yhteydet, yhteistyöehdotukset ja debug-näkymät.</Text>
      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      <View style={styles.metricRow}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metric}><Text style={styles.metricValue}>{metric.value}</Text><Text style={styles.metricLabel}>{metric.label}</Text></View>
        ))}
      </View>
      <TouchableOpacity style={styles.button}>
        <Ionicons name="analytics" size={18} color="#fff" />
        <Text style={styles.buttonText}>A/B Debug -paneeli</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  body: { color: '#4b5563', fontSize: 15, marginBottom: 16, lineHeight: 22 },
  metricRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  metric: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, alignItems: 'center' },
  metricValue: { fontSize: 22, fontWeight: '900', color: '#007AFF' },
  metricLabel: { fontSize: 12, color: '#6b7280', marginTop: 4, fontWeight: '700' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 14, paddingVertical: 14 },
  buttonText: { color: '#fff', fontWeight: '800' },
  textRight: { textAlign: 'right' },
});
