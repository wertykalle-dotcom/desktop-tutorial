import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../src/contexts/I18nContext';

export default function AgeGateScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const router = useRouter();
  const { t, isRTL } = useI18n();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Ionicons name="warning-outline" size={54} color="#b91c1c" />
        <Text style={[styles.title, isRTL && styles.textRight]}>{t('ageGateTitle')}</Text>
        <Text style={[styles.body, isRTL && styles.textRight]}>
          {reason === 'underage' ? t('ageGateUnderageBody') : t('ageGateBody')}
        </Text>
        <View style={styles.links}>
          <TouchableOpacity onPress={() => router.push('/terms' as never)}>
            <Text style={styles.link}>{t('termsOfService')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/privacy' as never)}>
            <Text style={styles.link}>{t('privacyPolicy')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.buttonText}>{t('signIn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 20, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center' },
  body: { color: '#4b5563', textAlign: 'center', lineHeight: 22 },
  links: { flexDirection: 'row', gap: 18, marginTop: 6 },
  link: { color: '#007AFF', fontWeight: '700' },
  button: { marginTop: 8, backgroundColor: '#007AFF', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '800' },
  textRight: { textAlign: 'right' },
});
