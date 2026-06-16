import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type SocialPost = {
  id: string;
  author: string;
  avatar: string;
  avatarColor: string;
  createdAt: string;
  text: string;
  likes: number;
  comments: number;
  liked?: boolean;
};

const initialPosts: SocialPost[] = [
  {
    id: 'seed_1',
    author: 'Anna Alumnus',
    avatar: 'A',
    avatarColor: '#8b5cf6',
    createdAt: '2 tuntia sitten',
    text: 'Koodasin juuri tämän sosiaalisen median käyttöliittymän rungon! GPT-5.5 auttoi luomaan siistin ja modernin ulkoasun todella nopeasti. #koodaus #webdev',
    likes: 12,
    comments: 4,
  },
];

export default function SomaVerkkoScreen() {
  const [postText, setPostText] = useState('');
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts);

  const submitPost = () => {
    const text = postText.trim();
    if (!text) {
      Alert.alert('Julkaisu puuttuu', 'Kirjoita jotain ennen julkaisemista!');
      return;
    }

    setPosts((current) => [
      {
        id: `post_${Date.now()}`,
        author: 'Sinä (Käyttäjä)',
        avatar: 'M',
        avatarColor: '#2563eb',
        createdAt: 'Juuri nyt',
        text,
        likes: 0,
        comments: 0,
      },
      ...current,
    ]);
    setPostText('');
  };

  const toggleLike = (postId: string) => {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? { ...post, liked: !post.liked, likes: post.likes + (post.liked ? -1 : 1) }
          : post
      )
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.navbar}>
        <View style={styles.navInner}>
          <Text style={styles.brand}>SomaVerkko</Text>
          <View style={styles.navActions}>
            <TouchableOpacity style={styles.navIcon} accessibilityRole="button" accessibilityLabel="Etusivu">
              <Ionicons name="home" size={21} color="#4b5563" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navIcon} accessibilityRole="button" accessibilityLabel="Ilmoitukset">
              <Ionicons name="notifications" size={21} color="#4b5563" />
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>3</Text>
              </View>
            </TouchableOpacity>
            <View style={[styles.avatar, styles.navAvatar]}>
              <Text style={styles.avatarText}>M</Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.composerCard}>
          <View style={styles.composerRow}>
            <View style={[styles.avatar, { backgroundColor: '#2563eb' }]}>
              <Text style={styles.avatarText}>M</Text>
            </View>
            <TextInput
              value={postText}
              onChangeText={setPostText}
              placeholder="Mitä sinulla on mielessä?"
              placeholderTextColor="#9ca3af"
              multiline
              style={styles.composerInput}
              textAlignVertical="top"
            />
          </View>
          <View style={styles.composerFooter}>
            <TouchableOpacity style={styles.addImageButton} accessibilityRole="button">
              <Ionicons name="image" size={18} color="#22c55e" />
              <Text style={styles.addImageText}>Lisää kuva</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitButton} onPress={submitPost}>
              <Text style={styles.submitButtonText}>Julkaise</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.feed}>
          {posts.map((post) => (
            <View key={post.id} style={styles.postCard}>
              <View style={styles.postHeader}>
                <View style={[styles.avatar, { backgroundColor: post.avatarColor }]}>
                  <Text style={styles.avatarText}>{post.avatar}</Text>
                </View>
                <View>
                  <Text style={styles.postAuthor}>{post.author}</Text>
                  <Text style={styles.postTime}>{post.createdAt}</Text>
                </View>
              </View>
              <Text style={styles.postText}>{post.text}</Text>
              <View style={styles.postActions}>
                <TouchableOpacity style={styles.actionButton} onPress={() => toggleLike(post.id)}>
                  <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={18} color={post.liked ? '#ef4444' : '#6b7280'} />
                  <Text style={[styles.actionText, post.liked && styles.likedText]}>{post.likes}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton}>
                  <Ionicons name="chatbubble-outline" size={18} color="#6b7280" />
                  <Text style={styles.actionText}>{post.comments} kommenttia</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  navbar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  navInner: {
    width: '100%',
    maxWidth: 896,
    height: 64,
    alignSelf: 'center',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: '#2563eb',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  navIcon: {
    position: 'relative',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3b82f6',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '900',
  },
  content: {
    width: '100%',
    maxWidth: 576,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  composerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
    marginBottom: 24,
  },
  composerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  composerInput: {
    flex: 1,
    minHeight: 86,
    color: '#374151',
    fontSize: 15,
    lineHeight: 21,
    paddingTop: 2,
  },
  composerFooter: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  addImageText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '800',
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  feed: {
    gap: 16,
  },
  postCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  postAuthor: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '900',
  },
  postTime: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  postText: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: '#f9fafb',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  actionText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '800',
  },
  likedText: {
    color: '#ef4444',
  },
});
