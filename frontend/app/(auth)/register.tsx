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

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const { t, isRTL } = useI18n();
  const router = useRouter();

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

    setLoading(true);
    try {
      await register(normalizedEmail, normalizedPassword, normalizedUsername);
      router.replace('/(tabs)/feed');
    } catch (error: any) {
      Alert.alert(t('registerFailed'), error.message || t('retry'));
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
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
