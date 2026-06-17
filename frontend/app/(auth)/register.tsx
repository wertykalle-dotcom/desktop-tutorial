import React, { useMemo, useState } from 'react';
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

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const { t, isRTL } = useI18n();
  const router = useRouter();

  const minimumAge = 18;

  const ageCheck = useMemo(() => {
    if (!dateOfBirth.trim()) return { valid: false, age: null as number | null, message: null as string | null };
    const parsed = new Date(dateOfBirth);
    if (Number.isNaN(parsed.getTime())) return { valid: false, age: null, message: t('registerDobInvalid') };
    const today = new Date();
    let age = today.getUTCFullYear() - parsed.getUTCFullYear();
    const monthDelta = today.getUTCMonth() - parsed.getUTCMonth();
    if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < parsed.getUTCDate())) age -= 1;
    if (age < minimumAge) {
      return { valid: false, age, message: t('registerUnderage').replace('{age}', String(minimumAge)) };
    }
    return { valid: true, age, message: null };
  }, [dateOfBirth, minimumAge, t]);

  const handleRegister = async () => {
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword || !normalizedUsername) {
      Alert.alert(t('error'), t('requiredFields'));
      return;
    }

    if (normalizedPassword.length < 6) {
      Alert.alert(t('error'), t('passwordMin'));
      return;
    }

    if (!acceptTerms || !acceptPrivacy) {
      Alert.alert(t('error'), t('registerMustAcceptPolicies'));
      return;
    }

    if (!dateOfBirth.trim()) {
      Alert.alert(t('error'), t('registerDobRequired'));
      return;
    }

    if (!ageCheck.valid) {
      Alert.alert(t('error'), ageCheck.message || t('registerUnderage').replace('{age}', String(minimumAge)));
      return;
    }

    setLoading(true);
    try {
      await register(normalizedEmail, normalizedPassword, normalizedUsername, dateOfBirth.trim(), acceptTerms, acceptPrivacy);
      router.replace('/(tabs)/feed');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('at least')) {
        router.replace('/(auth)/age-gate?reason=underage' as never);
        return;
      }
      Alert.alert(t('registerFailed'), message || t('retry'));
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
          <Ionicons name="person-add-outline" size={80} color="#007AFF" />
          <Text style={styles.title}>{t('createAccount')}</Text>
          <Text style={[styles.subtitle, isRTL && styles.subtitleRTL]}>{t('joinToday')}</Text>
        </View>

        <View style={styles.form}>
          <View style={[styles.inputContainer, isRTL && styles.rowReverse]}>
            <Ionicons name="person-outline" size={20} color="#666" style={[styles.inputIcon, isRTL && styles.inputIconRTL]} />
            <TextInput
              style={styles.input}
              placeholder={t('username')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>

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
              placeholder={t('passwordMin')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={[styles.inputContainer, isRTL && styles.rowReverse]}>
            <Ionicons name="calendar-outline" size={20} color="#666" style={[styles.inputIcon, isRTL && styles.inputIconRTL]} />
            <TextInput
              style={styles.input}
              placeholder={t('registerDobPlaceholder')}
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
          </View>
          {dateOfBirth.trim() && ageCheck.message ? <Text style={styles.noticeError}>{ageCheck.message}</Text> : null}

          <TouchableOpacity style={styles.checkboxRow} onPress={() => setAcceptTerms((v) => !v)}>
            <View style={[styles.checkbox, acceptTerms && styles.checkboxActive]}>{acceptTerms ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}</View>
            <Text style={styles.checkboxLabel}>{t('registerAcceptTerms')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.checkboxRow} onPress={() => setAcceptPrivacy((v) => !v)}>
            <View style={[styles.checkbox, acceptPrivacy && styles.checkboxActive]}>{acceptPrivacy ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}</View>
            <Text style={styles.checkboxLabel}>{t('registerAcceptPrivacy')}</Text>
          </TouchableOpacity>

          <View style={styles.policyRow}>
            <TouchableOpacity onPress={() => router.push('/terms' as never)}>
              <Text style={styles.policyLink}>{t('termsOfService')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/privacy' as never)}>
              <Text style={styles.policyLink}>{t('privacyPolicy')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('register')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.back()}
          >
            <Text style={styles.linkText}>
              {t('alreadyHaveAccount')} <Text style={styles.linkTextBold}>{t('signIn')}</Text>
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkboxLabel: {
    flex: 1,
    color: '#334155',
    fontSize: 14,
  },
  policyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  policyLink: {
    color: '#007AFF',
    fontWeight: '600',
  },
  noticeError: {
    color: '#b91c1c',
    marginTop: -8,
    marginBottom: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
