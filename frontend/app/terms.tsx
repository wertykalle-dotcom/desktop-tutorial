import React from 'react';
import { ScrollView, StyleSheet, Text, View, TouchableOpacity, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../src/contexts/I18nContext';

const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || '';

export default function TermsScreen() {
  const router = useRouter();
  const { t, isRTL } = useI18n();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity style={[styles.backRow, isRTL && styles.rowReverse]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={22} color="#007AFF" />
        <Text style={styles.backText}>{t('back')}</Text>
      </TouchableOpacity>
      <View style={styles.card}>
        <Text style={[styles.title, isRTL && styles.textRight]}>{t('termsOfService')}</Text>
        <Text style={[styles.body, isRTL && styles.textRight]}>{t('termsSummary')}</Text>
        {!!TERMS_URL && (
          <TouchableOpacity onPress={() => void Linking.openURL(TERMS_URL)}>
            <Text style={styles.link}>{TERMS_URL}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f8fafc', minHeight: '100%' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  rowReverse: { flexDirection: 'row-reverse' },
  backText: { color: '#007AFF', fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  body: { color: '#374151', lineHeight: 22 },
  link: { color: '#007AFF', fontWeight: '700' },
  textRight: { textAlign: 'right' },
});
