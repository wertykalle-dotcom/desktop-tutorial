import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import { useApiClient } from '../src/hooks/useApiClient';

type UserMini = {
  user_id: string;
  username: string;
  profile_picture?: string;
};

export default function SafetyScreen() {
  const { token } = useAuth();
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const [blockedUsers, setBlockedUsers] = useState<UserMini[]>([]);
  const [mutedUsers, setMutedUsers] = useState<UserMini[]>([]);

  const refreshSafetyLists = useCallback(async () => {
    if (!token) return;
    try {
      const [blockedResp, mutedResp] = await Promise.all([
        apiFetch('/users/me/blocked'),
        apiFetch('/users/me/muted'),
      ]);
      if (!blockedResp || !mutedResp) return;
      if (blockedResp.status === 401 || mutedResp.status === 401) return;
      if (blockedResp.ok) setBlockedUsers(await blockedResp.json());
      if (mutedResp.ok) setMutedUsers(await mutedResp.json());
    } catch (error) {
      console.error('Error refreshing safety lists:', error);
    }
  }, [token, apiFetch]);

  useFocusEffect(
    useCallback(() => {
      refreshSafetyLists();
    }, [refreshSafetyLists])
  );

  const unblockUser = async (targetUserId: string) => {
    if (!token) return;
    try {
      const response = await apiFetch(`/users/${targetUserId}/block`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (response.ok) {
        setBlockedUsers((prev) => prev.filter((u) => u.user_id !== targetUserId));
      } else {
        Alert.alert('Virhe', 'Eston poisto epäonnistui');
      }
    } catch (error) {
      console.error('Error unblocking user:', error);
      Alert.alert('Virhe', 'Eston poisto epäonnistui');
    }
  };

  const unmuteUser = async (targetUserId: string) => {
    if (!token) return;
    try {
      const response = await apiFetch(`/users/${targetUserId}/mute`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (response.ok) {
        setMutedUsers((prev) => prev.filter((u) => u.user_id !== targetUserId));
      } else {
        Alert.alert('Virhe', 'Hiljennyksen poisto epäonnistui');
      }
    } catch (error) {
      console.error('Error unmuting user:', error);
      Alert.alert('Virhe', 'Hiljennyksen poisto epäonnistui');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#007AFF" />
          <Text style={styles.backText}>Takaisin</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Turvallisuusasetukset</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Estetyt käyttäjät</Text>
          {blockedUsers.length === 0 ? (
            <Text style={styles.empty}>Ei estettyjä käyttäjiä</Text>
          ) : (
            blockedUsers.map((u) => (
              <View key={`blocked-${u.user_id}`} style={styles.row}>
                <Text style={styles.name}>@{u.username}</Text>
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert('Poista esto', `Poistetaanko käyttäjän @${u.username} esto?`, [
                      { text: 'Peruuta', style: 'cancel' },
                      { text: 'Poista esto', onPress: () => unblockUser(u.user_id) },
                    ])
                  }
                >
                  <Text style={styles.action}>Poista esto</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Hiljennetyt käyttäjät</Text>
          {mutedUsers.length === 0 ? (
            <Text style={styles.empty}>Ei hiljennettyjä käyttäjiä</Text>
          ) : (
            mutedUsers.map((u) => (
              <View key={`muted-${u.user_id}`} style={styles.row}>
                <Text style={styles.name}>@{u.username}</Text>
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert('Poista hiljennys', `Poistetaanko käyttäjän @${u.username} hiljennys?`, [
                      { text: 'Peruuta', style: 'cancel' },
                      { text: 'Poista', onPress: () => unmuteUser(u.user_id) },
                    ])
                  }
                >
                  <Text style={styles.action}>Poista hiljennys</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9e9e9',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  backText: {
    color: '#007AFF',
    fontWeight: '600',
    marginLeft: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    padding: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#222',
    marginBottom: 8,
  },
  empty: {
    fontSize: 13,
    color: '#777',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  name: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  action: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '700',
  },
});
