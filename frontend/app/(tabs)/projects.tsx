import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useI18n } from '../../src/contexts/I18nContext';
import { defaultProjects, type ProjectItem } from '../../src/features/directories/directory-data';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';
import { isSuperAdmin } from '../../src/utils/roles';

export default function ProjectsScreen() {
  const { isRTL } = useI18n();
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const canAccess = isSuperAdmin(user?.role);
  const [projects, setProjects] = useState<ProjectItem[]>(defaultProjects);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canAccess) return;
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      const response = await apiFetch('/projects?limit=12', {}, { requireAuth: true });
      const data = response ? await response.json() : null;
      if (!mounted) return;
      setProjects(Array.isArray(data?.projects) ? data.projects : defaultProjects);
      setLoading(false);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [apiFetch, canAccess, token]);

  if (!canAccess) {
    return <Redirect href="/(tabs)/feed" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.title, isRTL && styles.textRight]}>Projektit</Text>
      <Text style={[styles.body, isRTL && styles.textRight]}>Käynnistys, luonnokset ja kuvalliset projektikortit.</Text>
      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      {projects.map((project) => (
        <View key={project.name} style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="briefcase" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, isRTL && styles.textRight]}>{project.name}</Text>
            <Text style={[styles.cardSub, isRTL && styles.textRight]}>{project.status} · {project.description}</Text>
          </View>
          <TouchableOpacity style={styles.joinButton}>
            <Text style={styles.joinText}>Avaa</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  body: { color: '#4b5563', fontSize: 15, marginBottom: 16, lineHeight: 22 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  joinButton: { backgroundColor: '#f3e8ff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  joinText: { color: '#7c3aed', fontWeight: '800' },
  textRight: { textAlign: 'right' },
});
