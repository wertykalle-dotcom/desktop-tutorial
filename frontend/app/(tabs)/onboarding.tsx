import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { useI18n } from '../../src/contexts/I18nContext';
import { getOnboardingStepState, isNewUserProfile, markOnboardingCompleted } from '../../src/utils/onboarding';

export default function OnboardingScreen() {
  const { user } = useAuth();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const isNewUser = isNewUserProfile(user);
  const stepState = getOnboardingStepState(user);

  const completeOnboarding = async () => {
    if (user?.user_id) {
      await markOnboardingCompleted(user.user_id);
    }
    router.replace('/(tabs)/profile');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.card, isNewUser ? styles.cardExplore : styles.cardPersonal]}>
        <Text style={[styles.eyebrow, isRTL && styles.textRight]}>
          {isNewUser ? t('onboardingExploreLabel') : t('onboardingReadyLabel')}
        </Text>
        <Text style={[styles.title, isRTL && styles.textRight]}>{t('onboardingTitle')}</Text>
        <Text style={[styles.body, isRTL && styles.textRight]}>{t('onboardingIntro')}</Text>
        <View style={styles.list}>
          <View style={[styles.row, isRTL && styles.rowReverse]}>
            <View style={[styles.stepBadge, stepState.follow ? styles.stepDone : styles.stepTodo]}>
              <Ionicons name={stepState.follow ? 'checkmark' : 'people-outline'} size={14} color={stepState.follow ? '#067647' : '#007AFF'} />
            </View>
            <Text style={[styles.item, isRTL && styles.textRight]}>{t('onboardingStepFollow')}</Text>
          </View>
          <View style={[styles.row, isRTL && styles.rowReverse]}>
            <View style={[styles.stepBadge, stepState.post ? styles.stepDone : styles.stepTodo]}>
              <Ionicons name={stepState.post ? 'checkmark' : 'create-outline'} size={14} color={stepState.post ? '#067647' : '#007AFF'} />
            </View>
            <Text style={[styles.item, isRTL && styles.textRight]}>{t('onboardingStepPost')}</Text>
          </View>
          <View style={[styles.row, isRTL && styles.rowReverse]}>
            <View style={[styles.stepBadge, stepState.react ? styles.stepDone : styles.stepTodo]}>
              <Ionicons name={stepState.react ? 'checkmark' : 'chatbubble-ellipses-outline'} size={14} color={stepState.react ? '#067647' : '#007AFF'} />
            </View>
            <Text style={[styles.item, isRTL && styles.textRight]}>{t('onboardingStepReact')}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.primaryButton, isRTL && styles.rowReverse]} onPress={completeOnboarding}>
          <Text style={styles.primaryButtonText}>{t('onboardingGoProfile')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/(tabs)/feed')}>
          <Text style={styles.secondaryButtonText}>{t('onboardingContinue')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#f5f7fb',
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  cardExplore: {
    backgroundColor: '#F7FBFF',
    borderColor: '#CFE4FF',
  },
  cardPersonal: {
    backgroundColor: '#F5F9F4',
    borderColor: '#D6E8D1',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#60708A',
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#16233A',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#3F4B63',
    marginBottom: 18,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBadge: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  stepDone: {
    backgroundColor: '#ECFDF3',
    borderColor: '#A6F4C5',
  },
  stepTodo: {
    backgroundColor: '#fff',
    borderColor: '#CFE4FF',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  item: {
    flex: 1,
    fontSize: 14,
    color: '#31415E',
    fontWeight: '600',
  },
  textRight: {
    textAlign: 'right',
  },
  actions: {
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderColor: '#D0D5DD',
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#16233A',
    fontSize: 16,
    fontWeight: '700',
  },
});
