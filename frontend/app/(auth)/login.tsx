import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../src/contexts/I18nContext';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { t, isRTL } = useI18n();
  const router = useRouter();

  const handleLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      Alert.alert(t('error'), t('requiredFields'));
      return;
    }

    setLoading(true);
    try {
      await login(normalizedEmail, normalizedPassword);
      router.replace('/(tabs)/feed');
    } catch (error: unknown) {
      Alert.alert(t('loginFailed'), error instanceof Error && error.message ? error.message : t('retry'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Ionicons name="people-circle" size={80} color="#007AFF" />
          <Text style={styles.title}>{t('welcomeBack')}</Text>
          <Text style={[styles.subtitle, isRTL && styles.subtitleRTL]}>{t('signInToContinue')}</Text>
        </View>

        <View style={styles.onboardingCard}>
          <Text style={[styles.onboardingEyebrow, isRTL && styles.textRight]}>{t('onboardingLabel')}</Text>
          <Text style={[styles.onboardingTitle, isRTL && styles.textRight]}>{t('onboardingTitle')}</Text>
          <Text style={[styles.onboardingBody, isRTL && styles.textRight]}>{t('onboardingBody')}</Text>
          <View style={styles.onboardingList}>
            <View style={[styles.onboardingRow, isRTL && styles.rowReverse]}>
              <Ionicons name="people-outline" size={16} color="#007AFF" />
              <Text style={[styles.onboardingItem, isRTL && styles.textRight]}>{t('onboardingStepFollow')}</Text>
            </View>
            <View style={[styles.onboardingRow, isRTL && styles.rowReverse]}>
              <Ionicons name="create-outline" size={16} color="#007AFF" />
              <Text style={[styles.onboardingItem, isRTL && styles.textRight]}>{t('onboardingStepPost')}</Text>
            </View>
            <View style={[styles.onboardingRow, isRTL && styles.rowReverse]}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#007AFF" />
              <Text style={[styles.onboardingItem, isRTL && styles.textRight]}>{t('onboardingStepReact')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.form}>
          <View style={[styles.inputContainer, isRTL && styles.rowReverse]}>
            <Ionicons name="mail-outline" size={20} color="#666" style={[styles.inputIcon, isRTL && styles.inputIconRTL]} />
            <TextInput
              style={styles.input}
              placeholder={t('email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          <View style={[styles.inputContainer, isRTL && styles.rowReverse]}>
            <Ionicons name="lock-closed-outline" size={20} color="#666" style={[styles.inputIcon, isRTL && styles.inputIconRTL]} />
            <TextInput
              style={styles.input}
              placeholder={t('password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('signIn')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push('/(auth)/register')}
          >
            <Text style={styles.linkText}>
              {t('noAccountPrompt')} <Text style={styles.linkTextBold}>{t('register')}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 16,
    color: '#000',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  subtitleRTL: {
    textAlign: 'right',
  },
  form: {
    width: '100%',
  },
  onboardingCard: {
    width: '100%',
    backgroundColor: '#F7FBFF',
    borderColor: '#CFE4FF',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  onboardingEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#60708A',
    marginBottom: 4,
  },
  onboardingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#16233A',
    marginBottom: 4,
  },
  onboardingBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#3F4B63',
    marginBottom: 12,
  },
  textRight: {
    textAlign: 'right',
  },
  onboardingList: {
    gap: 8,
  },
  onboardingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onboardingItem: {
    flex: 1,
    fontSize: 13,
    color: '#31415E',
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  inputIconRTL: {
    marginRight: 0,
    marginLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#000',
  },
  button: {
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#666',
    fontSize: 14,
  },
  linkButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#666',
  },
  linkTextBold: {
    color: '#007AFF',
    fontWeight: '600',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
