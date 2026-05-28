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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import { useApiClient } from '../../src/hooks/useApiClient';

export default function ProfileScreen() {
  const { user, token, logout, updateUser } = useAuth();
  const { apiFetch } = useApiClient();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [profilePicture, setProfilePicture] = useState(user?.profile_picture || '');
  const [loading, setLoading] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [stats, setStats] = useState({
    posts_count: user?.posts_count || 0,
    followers_count: user?.followers_count || 0,
    following_count: user?.following_count || 0,
  });
  const router = useRouter();

  useEffect(() => {
    if (editing) return;
    setUsername(user?.username || '');
    setBio(user?.bio || '');
    setProfilePicture(user?.profile_picture || '');
    setStats({
      posts_count: user?.posts_count || 0,
      followers_count: user?.followers_count || 0,
      following_count: user?.following_count || 0,
    });
  }, [user, editing]);

  const refreshProfileStats = useCallback(async () => {
    if (!token) return;
    try {
      const response = await apiFetch('/users/me');
      if (!response || response.status === 401) return;
      if (response.ok) {
        const freshUser = await response.json();
        setStats({
          posts_count: freshUser?.posts_count || 0,
          followers_count: freshUser?.followers_count || 0,
          following_count: freshUser?.following_count || 0,
        });
        updateUser(freshUser);
      }
      const unreadResp = await apiFetch('/notifications/unread-count');
      if (!unreadResp || unreadResp.status === 401) return;
      if (unreadResp.ok) {
        const payload = await unreadResp.json();
        setUnreadNotifications(Number(payload?.unread_count || 0));
      }
    } catch (error) {
      console.error('Error refreshing profile stats:', error);
    }
  }, [token, updateUser, apiFetch]);

  useFocusEffect(
    useCallback(() => {
      refreshProfileStats();
    }, [refreshProfileStats])
  );

    const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert('Lupa vaaditaan', 'Gallerian käyttöoikeus vaaditaan');
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
      Alert.alert('Virhe', 'Kuvan valinta tai pienennys epäonnistui');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
  if (!username.trim()) {
    Alert.alert('Virhe', 'Käyttäjänimi vaaditaan');
    return;
  }

  setLoading(true);
  try {
    const response = await apiFetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          bio: bio.trim() || null,
          profile_picture: profilePicture || null,
        }),
      });
      if (!response || response.status === 401) return;

      if (response.ok) {
        const updatedUser = await response.json();
        updateUser(updatedUser);
        setEditing(false);
        setStats({
          posts_count: updatedUser?.posts_count || stats.posts_count,
          followers_count: updatedUser?.followers_count || stats.followers_count,
          following_count: updatedUser?.following_count || stats.following_count,
        });
        Alert.alert('Onnistui!', 'Profiili päivitetty');
      } else {
        const error = await response.json();
        Alert.alert('Virhe', error.detail || 'Profiilin päivitys epäonnistui');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Virhe', 'Profiilin päivitys epäonnistui');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Kirjaudu ulos',
      'Haluatko varmasti kirjautua ulos?',
      [
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
      ]
    );
  };

  const cancelEdit = () => {
    setUsername(user?.username || '');
    setBio(user?.bio || '');
    setProfilePicture(user?.profile_picture || '');
    setEditing(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
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
                style={styles.changePhotoButton}
                onPress={pickImage}
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
              />

              <Text style={styles.label}>Bio</Text>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={bio}
                onChangeText={setBio}
                placeholder="Kerro itsestäsi..."
                multiline
                maxLength={150}
              />
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
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={cancelEdit}
              >
                <Text style={styles.cancelButtonText}>Peruuta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.saveButton]}
                onPress={handleSave}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Tallenna</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.button, styles.editButton]}
                onPress={() => setEditing(true)}
              >
                <Ionicons name="create-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>Muokkaa profiilia</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.logoutButton]}
                onPress={handleLogout}
              >
                <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
                <Text style={styles.logoutButtonText}>Kirjaudu ulos</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.editButton]}
                onPress={() => router.push('/safety')}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>Turvallisuusasetukset</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.editButton]}
                onPress={() => router.push('/notifications')}
              >
                <Ionicons name="notifications-outline" size={20} color="#007AFF" />
                <Text style={styles.editButtonText}>
                  Ilmoitukset {unreadNotifications > 0 ? `(${unreadNotifications})` : ''}
                </Text>
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
