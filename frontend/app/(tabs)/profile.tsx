import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import { useApiClient } from '../../src/hooks/useApiClient';
import { extractApiErrorMessage } from '../../src/utils/api/http';
import {
  BIO_WARNING_THRESHOLD,
  MAX_BIO_LENGTH,
  MAX_USERNAME_LENGTH,
  PROFILE_ERROR_BANNER_TIMEOUT_MS,
  PROFILE_MESSAGES,
  PROFILE_SUCCESS_BANNER_TIMEOUT_MS,
  buildProfileUpdatePayload,
  getSaveHelperText,
  getUsernameValidationMessage,
  hasProfileChanges,
  formatNotificationsLabel,
  normalizeProfileStats,
} from '../../src/features/profile/profile-helpers';

export default function ProfileScreen() {
  const { user, token, logout, updateUser } = useAuth();
  const { apiFetch } = useApiClient();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [profilePicture, setProfilePicture] = useState(user?.profile_picture || '');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [stats, setStats] = useState(normalizeProfileStats(user));
  const router = useRouter();

  useEffect(() => {
    if (editing) return;
    setUsername(user?.username || '');
    setBio(user?.bio || '');
    setProfilePicture(user?.profile_picture || '');
    setStats(normalizeProfileStats(user));
  }, [user, editing]);

  useEffect(() => {
    if (!refreshError) return;

    const timer = setTimeout(() => {
      setRefreshError(null);
    }, PROFILE_ERROR_BANNER_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [refreshError]);

  useEffect(() => {
    if (!saveSuccessMessage) return;
    const timer = setTimeout(() => setSaveSuccessMessage(null), PROFILE_SUCCESS_BANNER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [saveSuccessMessage]);

  const refreshProfileStats = useCallback(async () => {
    if (!token) return;
    try {
      setRefreshError(null);
      const response = await apiFetch('/users/me');
      if (!response || response.status === 401) return;
      if (response.ok) {
        const freshUser = await response.json();
        setStats(normalizeProfileStats(freshUser));
        updateUser(freshUser);
      }

      const unreadResp = await apiFetch('/notifications/unread-count');
      if (!unreadResp || unreadResp.status === 401) return;
      if (unreadResp.ok) {
        const payload = await unreadResp.json();
        setUnreadNotifications(Number(payload?.unread_count ?? 0));
      }
    } catch (error) {
      console.error('Error refreshing profile stats:', error);
      setRefreshError(PROFILE_MESSAGES.profileRefreshFailed);
    }
  }, [token, updateUser, apiFetch]);

  useFocusEffect(
    useCallback(() => {
      refreshProfileStats();
    }, [refreshProfileStats])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshProfileStats();
    } finally {
      setRefreshing(false);
    }
  }, [refreshProfileStats]);

  const isBusy = loading || refreshing;
  const normalizedUsername = username.trim();
  const normalizedBio = bio.trim();
  const isUsernameNearLimit = username.length >= MAX_USERNAME_LENGTH - 4;
  const isBioNearLimit = bio.length >= BIO_WARNING_THRESHOLD;
  const profileHasChanges = hasProfileChanges(user, normalizedUsername, normalizedBio, profilePicture);
  const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);
  const isSaveDisabled =
    isBusy || !!usernameValidationMessage || !profileHasChanges;
  const saveHelperText = getSaveHelperText(usernameValidationMessage, profileHasChanges);

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(PROFILE_MESSAGES.galleryPermissionTitle, PROFILE_MESSAGES.galleryPermissionDescription);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setLoading(true);

        const manipulatedImage = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 1000 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );

        setProfilePicture(manipulatedImage.uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Virhe', PROFILE_MESSAGES.imagePickFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (usernameValidationMessage) {
      setRefreshError(usernameValidationMessage);
      return;
    }

    setLoading(true);
    setSaveSuccessMessage(null);
    try {
      const response = await apiFetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildProfileUpdatePayload(normalizedUsername, normalizedBio, profilePicture)),
      });
      if (!response || response.status === 401) return;

      if (response.ok) {
        const updatedUser = await response.json();
        updateUser(updatedUser);
        setEditing(false);
        setStats(normalizeProfileStats(updatedUser, stats));
        setSaveSuccessMessage(PROFILE_MESSAGES.profileSaved);
      } else {
        const errorMessage = await extractApiErrorMessage(response, PROFILE_MESSAGES.profileUpdateFailed);
        setRefreshError(errorMessage);
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      setRefreshError(PROFILE_MESSAGES.profileUpdateFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Kirjaudu ulos', 'Haluatko varmasti kirjautua ulos?', [
      {
        text: 'Peruuta',
        style: 'cancel',
      },
      {
        text: 'Kirjaudu ulos',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const cancelEdit = () => {
    setUsername(user?.username || '');
    setBio(user?.bio || '');
    setProfilePicture(user?.profile_picture || '');
    setRefreshError(null);
    setSaveSuccessMessage(null);
    setEditing(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          {refreshError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color="#B42318" />
              <Text style={styles.errorBannerText}>{refreshError}</Text>
              <TouchableOpacity
                style={[styles.retryButton, isBusy && styles.buttonDisabled]}
                onPress={onRefresh}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Yritä päivittää profiilin tiedot uudelleen"
                accessibilityHint="Hakee profiilin tiedot ja ilmoitusten määrän uudelleen"
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color="#B42318" />
                ) : (
                  <Text style={styles.retryButtonText}>Yritä uudelleen</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
          {saveSuccessMessage ? (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#067647" />
              <Text style={styles.successBannerText}>{saveSuccessMessage}</Text>
            </View>
          ) : null}

          <View style={styles.avatarContainer}>
            {profilePicture ? (
              <Image source={{ uri: profilePicture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={60} color="#fff" />
              </View>
            )}
            {editing && (
              <TouchableOpacity
                style={[styles.changePhotoButton, isBusy && styles.buttonDisabled]}
                onPress={pickImage}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Vaihda profiilikuva"
                accessibilityHint="Avaa kuvan valinnan laitteesi galleriasta"
              >
                <Ionicons name="camera" size={24} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {editing ? (
            <View style={styles.editForm}>
              <Text style={styles.label}>Käyttäjänimi</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Käyttäjänimi"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                returnKeyType="done"
                maxLength={MAX_USERNAME_LENGTH}
                accessibilityLabel="Käyttäjänimi"
                accessibilityHint="Syötä käyttäjänimi, vähintään 4 merkkiä"
              />
              <Text style={[styles.inputCounter, isUsernameNearLimit && styles.inputCounterWarning]}>
                {username.length}/{MAX_USERNAME_LENGTH}
              </Text>

              <Text style={styles.label}>Bio</Text>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={bio}
                onChangeText={setBio}
                placeholder="Kerro itsestäsi..."
                multiline
                autoCorrect={true}
                textAlignVertical="top"
                maxLength={MAX_BIO_LENGTH}
                accessibilityLabel="Bio"
                accessibilityHint="Kirjoita lyhyt esittely itsestäsi"
              />
              <Text style={[styles.inputCounter, isBioNearLimit && styles.inputCounterWarning]}>
                {bio.length}/{MAX_BIO_LENGTH}
              </Text>
            </View>
          ) : (
            <View style={styles.profileInfo}>
              <Text style={styles.username}>{user?.username}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              {user?.bio && <Text style={styles.bio}>{user.bio}</Text>}
            </View>
          )}

          <View style={styles.statsContainer}>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.posts_count}</Text>
              <Text style={styles.statLabel}>Julkaisut</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.followers_count}</Text>
              <Text style={styles.statLabel}>Seuraajat</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.following_count}</Text>
              <Text style={styles.statLabel}>Seurattavat</Text>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          {editing ? (
            <>
              <View style={styles.editActions}>
                <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={cancelEdit}>
                  <Text style={styles.cancelButtonText}>Peruuta</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.saveButton, isSaveDisabled && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={isSaveDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Tallenna profiilin muutokset"
                  accessibilityHint="Lähettää muokatut profiilitiedot palvelimelle"
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Tallenna</Text>}
                </TouchableOpacity>
              </View>
              {saveHelperText ? <Text style={styles.saveHelperText}>{saveHelperText}</Text> : null}
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.button, styles.editButton, isBusy && styles.buttonDisabled]}
                onPress={() => setEditing(true)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Muokkaa profiilia"
                accessibilityHint="Avaa profiilin muokkauskentät"
              >
                <Ionicons name="create-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>Muokkaa profiilia</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.logoutButton, isBusy && styles.buttonDisabled]}
                onPress={handleLogout}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Kirjaudu ulos"
                accessibilityHint="Kirjaa sinut ulos sovelluksesta"
              >
                <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
                <Text style={styles.logoutButtonText}>Kirjaudu ulos</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.editButton, isBusy && styles.buttonDisabled]}
                onPress={() => router.push('/safety')}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Avaa turvallisuusasetukset"
                accessibilityHint="Siirtyy turvallisuusasetusten näkymään"
              >
                <Ionicons name="shield-checkmark-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>Turvallisuusasetukset</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.editButton, isBusy && styles.buttonDisabled]}
                onPress={() => router.push('/notifications')}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Avaa ilmoitukset"
                accessibilityHint="Siirtyy ilmoitusnäkymään"
              >
                <Ionicons name="notifications-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>{formatNotificationsLabel(unreadNotifications)}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.editButton, isBusy && styles.buttonDisabled]}
                onPress={() => router.push('/drafts' as never)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Avaa luonnokset"
                accessibilityHint="Siirtyy omiin luonnoksiin"
              >
                <Ionicons name="document-text-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>Luonnokset</Text>
              </TouchableOpacity>
            </>
          )}
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
  scrollView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f9f9f9',
  },
  errorBanner: {
    width: '100%',
    backgroundColor: '#FEF3F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successBanner: {
    width: '100%',
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#A6F4C5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#067647',
    fontWeight: '500',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#B42318',
    fontWeight: '500',
  },
  retryButton: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  retryButtonText: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '700',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#e0e0e0',
  },
  avatarPlaceholder: {
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  changePhotoButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#007AFF',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  profileInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  editForm: {
    width: '100%',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: '#000',
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputCounter: {
    marginTop: -10,
    marginBottom: 8,
    textAlign: 'right',
    fontSize: 12,
    color: '#666',
  },
  inputCounterWarning: {
    color: '#B42318',
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  actions: {
    padding: 16,
  },
  button: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  editButton: {
    backgroundColor: '#f0f0f0',
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginLeft: 8,
  },
  logoutButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
    marginLeft: 8,
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
  },
  saveHelperText: {
    marginTop: -4,
    marginBottom: 8,
    fontSize: 12,
    color: '#666',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
