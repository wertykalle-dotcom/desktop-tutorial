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
  Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';
import { extractApiErrorMessage } from '../../src/utils/api/http';
import { formatRelativeTime } from '../../src/utils/time';
import { formatCompactCount, formatReplayDate, formatReplayDuration, isLiveReplayPost } from '../../src/features/video/liveReplay';
import { copyPostLink } from '../../src/features/postActions/PostActionsButton';
import type { AchievementsPayload, CreatorLevel } from '../../src/features/growth/growthTypes';
import { localeLabels, SUPPORTED_LOCALES } from '../../src/i18n/locales';
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
import type { Post } from '../../src/features/feed/dwell';

type RelationshipStatus = 'single' | 'relationship' | 'complicated' | 'private';

const relationshipOptions: {
  value: RelationshipStatus;
  label: string;
  badge: string;
  description: string;
}[] = [
  { value: 'single', label: 'Sinkku', badge: '🔓', description: 'Avoin yhteyksille' },
  { value: 'relationship', label: 'Parisuhteessa', badge: '🔒', description: 'Yhteydessä' },
  { value: 'complicated', label: 'Se monimutkaista', badge: '⚡', description: 'Tilanne elää' },
  { value: 'private', label: 'En halua kertoa', badge: '', description: 'Yksityinen' },
];

const getRelationshipOption = (value?: string | null) =>
  relationshipOptions.find((option) => option.value === value) || relationshipOptions[3];

const getRecordingVisibility = (recording?: Pick<Post, 'visibility'> | null): RecordingVisibility =>
  recording?.visibility === 'private' ? 'private' : 'public';

const isRecordingPinned = (recording?: Pick<Post, 'pinned_to_profile' | 'is_pinned'> | null) =>
  Boolean(recording?.pinned_to_profile || recording?.is_pinned);

const getRecordingThumbnail = (recording?: Pick<Post, 'image' | 'thumbnailUrl' | 'thumbnail_url'> | null) =>
  recording?.image || recording?.thumbnailUrl || recording?.thumbnail_url || '';

type ProfileViewMode = 'profile' | 'saved' | 'settings';
type ProfileContentTab = 'posts' | 'recordings' | 'saved' | 'likes';
type RecordingSortMode = 'newest' | 'oldest' | 'longest' | 'popular';
type RecordingVisibility = 'public' | 'private';
type SavedCategoryKey = 'all' | 'posts' | 'discussions' | 'polls' | 'lives' | 'campaigns';

type AccountHealthStatus = 'good' | 'watch' | 'restricted';

type AccountHealth = {
  trust_score: number;
  status: AccountHealthStatus;
  active_restrictions_count: number;
  recovery_tip: string;
  recovery?: {
    applied_delta?: number;
    next_recovery_at?: string | null;
    recovery_cap?: number;
    last_negative_at?: string | null;
  };
  restricted_posts: {
    post_id: string;
    title?: string | null;
    text?: string | null;
    copyright_status?: string | null;
    music_risk?: string | null;
    distribution_limited?: boolean | number | null;
    status?: string | null;
  }[];
  recent_decisions: {
    moderation_id: string;
    status: string;
    reason?: string | null;
    reviewed_reason?: string | null;
    reviewed_at?: string | null;
    post_id?: string | null;
    target_id?: string | null;
  }[];
};

const savedCollections: { key: SavedCategoryKey; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: 'Kaikki', description: 'Kaikki tallennetut', icon: 'albums-outline' },
  { key: 'posts', label: 'Julkaisut', description: 'Postaukset ja ideat', icon: 'newspaper-outline' },
  { key: 'discussions', label: 'Keskustelut', description: 'Kommenttiketjut', icon: 'chatbubbles-outline' },
  { key: 'polls', label: 'Kyselyt', description: 'Gallupit ja tulokset', icon: 'stats-chart-outline' },
  { key: 'lives', label: 'Livet', description: 'Livehetket ja replayt', icon: 'radio-outline' },
  { key: 'campaigns', label: 'Kampanjat', description: 'Seurattavat tavoitteet', icon: 'flag-outline' },
];

const formatHealthDate = (value?: string | null) => {
  if (!value) return 'Ei tiedossa';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const formatWatchTime = (seconds?: number | null) => {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
};

const formatCompletionRate = (value?: number | null) => `${Math.max(0, Math.min(100, Math.round(Number(value || 0))))}%`;

const getSavedPostCategory = (post: Post): SavedCategoryKey => {
  const metadata = post as Post & { type?: string | null; source?: string | null; is_clip?: boolean; campaign_id?: string | null };
  const text = post.text || '';
  if (metadata.source === 'live_replay' || metadata.source === 'live_recording' || metadata.type === 'live_recording' || metadata.type === 'live_replay' || metadata.type === 'clip' || metadata.is_clip || /Live Replay|Live Recording|Tallenne:/i.test(text)) {
    return 'lives';
  }
  if (metadata.type === 'poll' || post.poll) return 'polls';
  if (metadata.type === 'discussion' || post.comments_count > 0) return 'discussions';
  if (metadata.type === 'campaign' || metadata.campaign_id || /kampanja|campaign/i.test(text)) return 'campaigns';
  return 'posts';
};

export default function ProfileScreen({ initialView = 'profile' }: { initialView?: ProfileViewMode }) {
  const { user, token, logout, updateUser } = useAuth();
  const { locale, setLocale, isRTL, t } = useI18n();
  const { apiFetch } = useApiClient();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [profilePicture, setProfilePicture] = useState(user?.profile_picture || '');
  const [relationshipStatus, setRelationshipStatus] = useState<RelationshipStatus>(
    getRelationshipOption(user?.relationship_status).value
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [stats, setStats] = useState(normalizeProfileStats(user));
  const [lastActiveAt, setLastActiveAt] = useState<string | null>(null);
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedCategory, setSavedCategory] = useState<SavedCategoryKey>('all');
  const [profileContentTab, setProfileContentTab] = useState<ProfileContentTab>('posts');
  const [recordings, setRecordings] = useState<Post[]>([]);
  const [recordingSortMode, setRecordingSortMode] = useState<RecordingSortMode>('newest');
  const [recordingEditorVisible, setRecordingEditorVisible] = useState(false);
  const [editingRecording, setEditingRecording] = useState<Post | null>(null);
  const [recordingTitleDraft, setRecordingTitleDraft] = useState('');
  const [recordingDescriptionDraft, setRecordingDescriptionDraft] = useState('');
  const [recordingThumbnailDraft, setRecordingThumbnailDraft] = useState('');
  const [recordingOriginalThumbnail, setRecordingOriginalThumbnail] = useState('');
  const [recordingVisibilityDraft, setRecordingVisibilityDraft] = useState<RecordingVisibility>('public');
  const [recordingPinnedDraft, setRecordingPinnedDraft] = useState(false);
  const [achievementsPayload, setAchievementsPayload] = useState<AchievementsPayload | null>(null);
  const [creatorLevel, setCreatorLevel] = useState<CreatorLevel | null>(null);
  const [accountHealth, setAccountHealth] = useState<AccountHealth | null>(null);
  const [livePromptVisible, setLivePromptVisible] = useState(false);
  const [liveTopic, setLiveTopic] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (editing) return;
    setUsername(user?.username || '');
    setBio(user?.bio || '');
    setProfilePicture(user?.profile_picture || '');
    setRelationshipStatus(getRelationshipOption(user?.relationship_status).value);
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

      const presenceResp = await apiFetch('/users/me/presence');
      if (presenceResp?.ok) {
        const presence = await presenceResp.json();
        setLastActiveAt(presence?.last_active_at || null);
      }

      setSavedLoading(true);
      const savedResp = await apiFetch('/users/me/bookmarks?limit=500');
      if (savedResp?.ok) {
        const payload = await savedResp.json();
        setSavedPosts(Array.isArray(payload) ? payload : []);
      }

      const mediaResp = await apiFetch('/media/posts?limit=200&includeOwnPrivate=true');
      if (mediaResp?.ok) {
        const payload = await mediaResp.json();
        const ownRecordings = Array.isArray(payload)
          ? payload.filter((post: Post) => post.user_id === user?.user_id && isLiveReplayPost(post))
          : [];
        setRecordings(ownRecordings);
      }
      const achievementsResp = await apiFetch('/growth/achievements');
      if (achievementsResp?.ok) {
        const payload = await achievementsResp.json();
        setAchievementsPayload(payload);
        setCreatorLevel(payload?.creator_level || null);
      }
      const levelResp = await apiFetch('/growth/creator-level');
      if (levelResp?.ok) {
        setCreatorLevel(await levelResp.json());
      }
      const healthResp = await apiFetch('/users/me/account-health');
      if (healthResp?.ok) {
        setAccountHealth(await healthResp.json());
      }
    } catch (error) {
      console.error('Error refreshing profile stats:', error);
      setRefreshError(PROFILE_MESSAGES.profileRefreshFailed);
    } finally {
      setSavedLoading(false);
    }
  }, [token, updateUser, apiFetch, user?.user_id]);

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
  const profileHasChanges = hasProfileChanges(user, normalizedUsername, normalizedBio, profilePicture, relationshipStatus);
  const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);
  const isSaveDisabled =
    isBusy || !!usernameValidationMessage || !profileHasChanges;
  const saveHelperText = getSaveHelperText(usernameValidationMessage, profileHasChanges);
  const isNewProfile = stats.posts_count < 3 && stats.followers_count === 0 && stats.following_count <= 2;
  const healthStatus = accountHealth?.status || 'good';
  const healthTone = healthStatus === 'restricted' ? '#dc2626' : healthStatus === 'watch' ? '#d97706' : '#0f766e';
  const healthLabel = healthStatus === 'restricted' ? 'Rajoitettu' : healthStatus === 'watch' ? 'Tarkkailussa' : 'Hyvä';
  const hasCompleteProfile =
    normalizedUsername.length >= 4 &&
    normalizedBio.length > 0 &&
    !!profilePicture &&
    !usernameValidationMessage;

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
      Alert.alert(t('error'), PROFILE_MESSAGES.imagePickFailed);
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
        body: JSON.stringify(buildProfileUpdatePayload(normalizedUsername, normalizedBio, profilePicture, relationshipStatus)),
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

  const performLogout = async () => {
    try {
      await logout();
    } finally {
      router.replace('/(auth)/login');
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      const confirmed =
        typeof window === 'undefined' ? true : window.confirm(t('profileLogout') + '?');
      if (confirmed) {
        void performLogout();
      }
      return;
    }

    Alert.alert(t('profileLogout'), t('profileLogout') + '?', [
      {
        text: t('cancel'),
        style: 'cancel',
      },
      {
        text: t('profileLogout'),
        style: 'destructive',
        onPress: () => {
          void performLogout();
        },
      },
    ]);
  };

  const cancelEdit = () => {
    setUsername(user?.username || '');
    setBio(user?.bio || '');
    setProfilePicture(user?.profile_picture || '');
    setRelationshipStatus(getRelationshipOption(user?.relationship_status).value);
    setRefreshError(null);
    setSaveSuccessMessage(null);
    setEditing(false);
  };

  const handleLocaleChange = async (nextLocale: typeof locale) => {
    await setLocale(nextLocale);
  };

  const openLivePrompt = () => {
    setLiveTopic('');
    setLivePromptVisible(true);
  };

  const startLiveStream = () => {
    if (!user?.user_id) {
      Alert.alert(t('error'), 'Live-lähetyksen aloittaminen vaatii kirjautumisen.');
      return;
    }
    const topic = liveTopic.trim() || '#YOSLA';
    setLivePromptVisible(false);
    router.push({
      pathname: '/live',
      params: { roomId: user.user_id, topic },
    });
  };

  const sortedRecordings = [...recordings].sort((a, b) => {
    const pinnedDelta = Number(isRecordingPinned(b)) - Number(isRecordingPinned(a));
    if (pinnedDelta !== 0) return pinnedDelta;
    if (recordingSortMode === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (recordingSortMode === 'longest') return (b.duration || 0) - (a.duration || 0);
    if (recordingSortMode === 'popular') return ((b.views || 0) + (b.likes_count || 0) * 2 + (b.comments_count || 0) * 3) - ((a.views || 0) + (a.likes_count || 0) * 2 + (a.comments_count || 0) * 3);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const pinnedProfileRecordings = sortedRecordings.filter(isRecordingPinned).slice(0, 2);
  const thumbnailDraftChanged = recordingThumbnailDraft !== recordingOriginalThumbnail;
  const recordingAnalytics = recordings.reduce(
    (summary, recording) => ({
      views: summary.views + Number(recording.views || 0),
      replays: summary.replays + Number(recording.replay_count || 0),
      watchTime: summary.watchTime + Number(recording.watch_time || 0),
      completionTotal: summary.completionTotal + Number(recording.completion_rate || 0),
      completionSamples: summary.completionSamples + (Number(recording.completion_rate || 0) > 0 ? 1 : 0),
    }),
    { views: 0, replays: 0, watchTime: 0, completionTotal: 0, completionSamples: 0 }
  );
  const averageRecordingCompletion = recordingAnalytics.completionSamples
    ? recordingAnalytics.completionTotal / recordingAnalytics.completionSamples
    : 0;

  const openRecordingEditor = (recording: Post) => {
    const thumbnail = getRecordingThumbnail(recording);
    setEditingRecording(recording);
    setRecordingTitleDraft(recording.title || '');
    setRecordingDescriptionDraft(recording.text || '');
    setRecordingThumbnailDraft(thumbnail);
    setRecordingOriginalThumbnail(thumbnail);
    setRecordingVisibilityDraft(getRecordingVisibility(recording));
    setRecordingPinnedDraft(isRecordingPinned(recording));
    setRecordingEditorVisible(true);
  };

  const patchRecording = async (recording: Post, updates: Record<string, unknown>) => {
    const response = await apiFetch(`/posts/${recording.post_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response?.ok) {
      const message = response ? await extractApiErrorMessage(response, 'Tallenteen päivitys epäonnistui.') : 'Tallenteen päivitys epäonnistui.';
      throw new Error(message);
    }
    const updated = await response.json();
    setRecordings((current) => current.map((item) => item.post_id === updated.post_id ? { ...item, ...updated } : item));
    return updated as Post;
  };

  const copyRecordingLink = async (recording: Post) => {
    if (getRecordingVisibility(recording) !== 'public') {
      setSaveSuccessMessage('Yksityistä tallennetta ei voi jakaa linkillä.');
      return;
    }
    try {
      await copyPostLink(recording, setSaveSuccessMessage);
    } catch (error) {
      console.error('Recording link copy failed:', error);
      setRefreshError(error instanceof Error ? error.message : 'Tallenteen linkin kopiointi epäonnistui.');
    }
  };

  const toggleRecordingPinned = async (recording: Post) => {
    const nextPinned = !isRecordingPinned(recording);
    setLoading(true);
    try {
      await patchRecording(recording, { pinned_to_profile: nextPinned, is_pinned: nextPinned });
      setSaveSuccessMessage(nextPinned ? 'Tallenne kiinnitetty profiiliin.' : 'Tallenteen kiinnitys poistettu.');
    } catch (error) {
      console.error('Recording pin update failed:', error);
      setRefreshError(error instanceof Error ? error.message : 'Tallenteen kiinnitys epäonnistui.');
    } finally {
      setLoading(false);
    }
  };

  const toggleRecordingVisibility = async (recording: Post) => {
    const nextVisibility: RecordingVisibility = getRecordingVisibility(recording) === 'public' ? 'private' : 'public';
    setLoading(true);
    try {
      await patchRecording(recording, { visibility: nextVisibility });
      setSaveSuccessMessage(nextVisibility === 'public' ? 'Tallenne on nyt julkinen.' : 'Tallenne on nyt yksityinen.');
    } catch (error) {
      console.error('Recording visibility update failed:', error);
      setRefreshError(error instanceof Error ? error.message : 'Tallenteen näkyvyyden päivitys epäonnistui.');
    } finally {
      setLoading(false);
    }
  };

  const pickRecordingThumbnail = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(PROFILE_MESSAGES.galleryPermissionTitle, PROFILE_MESSAGES.galleryPermissionDescription);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.65,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setLoading(true);
        const manipulatedImage = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 1280 } }],
          { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        const nextThumbnail = manipulatedImage.base64
          ? `data:image/jpeg;base64,${manipulatedImage.base64}`
          : manipulatedImage.uri;
        setRecordingThumbnailDraft(nextThumbnail);
      }
    } catch (error) {
      console.error('Recording thumbnail pick failed:', error);
      setRefreshError(error instanceof Error ? error.message : 'Kansikuvan valinta epäonnistui.');
    } finally {
      setLoading(false);
    }
  };

  const saveRecordingEdits = async () => {
    if (!editingRecording) return;
    setLoading(true);
    try {
      await patchRecording(editingRecording, {
        title: recordingTitleDraft,
        text: recordingDescriptionDraft,
        image: recordingThumbnailDraft,
        thumbnailUrl: recordingThumbnailDraft,
        visibility: recordingVisibilityDraft,
        pinned_to_profile: recordingPinnedDraft,
        is_pinned: recordingPinnedDraft,
      });
      setRecordingEditorVisible(false);
      setEditingRecording(null);
      setRecordingOriginalThumbnail('');
      setSaveSuccessMessage('Tallenne päivitetty.');
    } catch (error) {
      console.error('Recording update failed:', error);
      setRefreshError(error instanceof Error ? error.message : 'Tallenteen päivitys epäonnistui.');
    } finally {
      setLoading(false);
    }
  };

  const deleteRecording = (recording: Post) => {
    const runDelete = async () => {
      setLoading(true);
      try {
        const response = await apiFetch(`/posts/${recording.post_id}`, { method: 'DELETE' });
        if (!response?.ok) {
          const message = response ? await extractApiErrorMessage(response, 'Tallenteen poisto epäonnistui.') : 'Tallenteen poisto epäonnistui.';
          throw new Error(message);
        }
        setRecordings((current) => current.filter((item) => item.post_id !== recording.post_id));
        setSaveSuccessMessage('Tallenne poistettu.');
      } catch (error) {
        console.error('Recording delete failed:', error);
        setRefreshError(error instanceof Error ? error.message : 'Tallenteen poisto epäonnistui.');
      } finally {
        setLoading(false);
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || window.confirm('Poistetaanko tämä tallenne?')) {
        void runDelete();
      }
      return;
    }
    Alert.alert('Poista tallenne', 'Poistetaanko tämä tallenne?', [
      { text: t('cancel'), style: 'cancel' },
      { text: 'Poista', style: 'destructive', onPress: () => void runDelete() },
    ]);
  };

  const rtlRowStyle = isRTL ? styles.rowReverse : undefined;
  const selectedRelationshipOption = getRelationshipOption(user?.relationship_status);
  const shouldShowRelationshipStatus = selectedRelationshipOption.value !== 'private';
  const isSavedView = initialView === 'saved';
  const isSettingsView = initialView === 'settings';
  const isProfileView = !isSavedView && !isSettingsView;
  const filteredSavedPosts = savedCategory === 'all'
    ? savedPosts
    : savedPosts.filter((post) => getSavedPostCategory(post) === savedCategory);

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
          {isSavedView ? (
            <View style={styles.sectionIntroCard}>
              <Text style={[styles.sectionIntroKicker, isRTL && styles.textRight]}>Kirjanmerkit</Text>
              <Text style={[styles.sectionIntroTitle, isRTL && styles.textRight]}>Tallennetut</Text>
              <Text style={[styles.sectionIntroBody, isRTL && styles.textRight]}>
                Palaa tallennettuihin julkaisuihin, keskusteluihin, kyselyihin, livehetkiin ja kampanjoihin nopeasti.
              </Text>
            </View>
          ) : null}

          {isSettingsView ? (
            <View style={styles.sectionIntroCard}>
              <Text style={[styles.sectionIntroKicker, isRTL && styles.textRight]}>Oma tili</Text>
              <Text style={[styles.sectionIntroTitle, isRTL && styles.textRight]}>Asetukset</Text>
              <Text style={[styles.sectionIntroBody, isRTL && styles.textRight]}>
                Hallitse profiilitietoja, näkyvyyttä, kieltä, turvallisuutta ja kirjautumista yhdestä selkeästä paikasta.
              </Text>
            </View>
          ) : null}

          {isProfileView && hasCompleteProfile ? (
            <View style={[styles.personaBanner, styles.personaBannerComplete]}>
              <Text style={[styles.personaEyebrow, isRTL && styles.textRight]}>{t('profileCompleteLabel')}</Text>
              <Text style={[styles.personaTitle, isRTL && styles.textRight]}>{t('profileCompleteTitle')}</Text>
              <Text style={[styles.personaBody, isRTL && styles.textRight]}>{t('profileCompleteBody')}</Text>
            </View>
          ) : null}
          {isProfileView && !hasCompleteProfile ? (
            <View style={[styles.personaBanner, isNewProfile ? styles.personaBannerExplore : styles.personaBannerPersonal]}>
              <Text style={[styles.personaEyebrow, isRTL && styles.textRight]}>
                {isNewProfile ? t('profileExploreModeLabel') : t('profilePersonalModeLabel')}
              </Text>
              <Text style={[styles.personaTitle, isRTL && styles.textRight]}>
                {isNewProfile ? t('profileExploreModeTitle') : t('profilePersonalModeTitle')}
              </Text>
              <Text style={[styles.personaBody, isRTL && styles.textRight]}>
                {isNewProfile ? t('profileExploreModeBody') : t('profilePersonalModeBody')}
              </Text>
              {isNewProfile ? (
                <TouchableOpacity
                  style={[styles.personaAction, isRTL && styles.rowReverse]}
                  onPress={() => setEditing(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('profileEdit')}
                >
                  <Ionicons name="create-outline" size={16} color="#007AFF" />
                  <Text style={styles.personaActionText}>{t('profileCompleteNow')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {isSettingsView ? <View style={[styles.languageCard, isRTL && styles.languageCardRTL]}>
            <Text style={[styles.languageLabel, isRTL && styles.textRight]}>{t('profileLanguage')}</Text>
            <View style={styles.languagePills}>
              {SUPPORTED_LOCALES.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.languagePill, locale === item && styles.languagePillActive]}
                  onPress={() => handleLocaleChange(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: locale === item }}
                >
                  <Text style={[styles.languagePillText, locale === item && styles.languagePillTextActive]}>
                    {localeLabels[item]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View> : null}
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
                  <Text style={styles.retryButtonText}>{t('retry')}</Text>
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

          {isProfileView || isSettingsView ? <View style={styles.avatarContainer}>
            <View style={styles.avatarHalo} />
            {profilePicture ? (
              <Image source={{ uri: profilePicture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={60} color="#fff" />
              </View>
            )}
            <View style={styles.avatarPresenceDot} />
            {lastActiveAt ? <Text style={styles.lastActiveText}>{t('profileLastActive')}: {formatRelativeTime(lastActiveAt)}</Text> : null}
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
          </View> : null}

          {isSettingsView && editing ? (
            <View style={styles.editForm}>
              <Text style={[styles.label, isRTL && styles.textRight]}>{t('username')}</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder={t('username')}
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

              <Text style={[styles.label, isRTL && styles.textRight]}>{t('profileBio')}</Text>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={bio}
                onChangeText={setBio}
                placeholder={t('feedWriteComment')}
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

              <View style={styles.relationshipCard}>
                <Text style={[styles.relationshipHeading, isRTL && styles.textRight]}>
                  Parisuhdestatus uutisvirrassa
                </Text>
                <Text style={[styles.relationshipSubtitle, isRTL && styles.textRight]}>
                  Valitse, miten haluat statuksesi näkyvän muille käyttäjille profiilissasi. Voit myös piilottaa sen kokonaan.
                </Text>
                <View style={[styles.relationshipOptions, isRTL && styles.rowReverseWrap]}>
                  {relationshipOptions.map((option) => {
                    const selected = relationshipStatus === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[styles.relationshipOption, selected && styles.relationshipOptionActive]}
                        onPress={() => setRelationshipStatus(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Parisuhdestatus: ${option.label}`}
                      >
                        <View style={styles.relationshipOptionTextWrap}>
                          <Text style={[styles.relationshipOptionLabel, selected && styles.relationshipOptionLabelActive]}>
                            {option.label} {option.badge}
                          </Text>
                          <Text style={[styles.relationshipOptionDescription, selected && styles.relationshipOptionDescriptionActive]}>
                            {option.description}
                          </Text>
                        </View>
                        {selected ? (
                          <View style={styles.relationshipCheck}>
                            <Ionicons name="checkmark" size={14} color="#0066FF" />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}

          {isProfileView ? (
            <View style={styles.profileInfo}>
              <Text style={styles.username}>{user?.username}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              {user?.bio && <Text style={styles.bio}>{user.bio}</Text>}
              {shouldShowRelationshipStatus ? (
                <Text style={styles.relationshipStatusLine}>
                  Status: {selectedRelationshipOption.label} {selectedRelationshipOption.badge}
                </Text>
              ) : null}
            </View>
          ) : null}

          {isSettingsView && !editing ? (
            <View style={styles.settingsSummaryCard}>
              <Text style={[styles.settingsSummaryTitle, isRTL && styles.textRight]}>Profiilin näkyvyys</Text>
              <Text style={[styles.settingsSummaryBody, isRTL && styles.textRight]}>
                Muokkaa profiilitietoja avataksesi käyttäjänimen, bion, profiilikuvan ja parisuhdestatuksen asetukset.
              </Text>
            </View>
          ) : null}

          {isSettingsView && !editing ? (
            <View style={styles.accountHealthCard}>
              <View style={[styles.accountHealthHeader, isRTL && styles.rowReverse]}>
                <View>
                  <Text style={[styles.accountHealthEyebrow, isRTL && styles.textRight]}>Account Health</Text>
                  <Text style={[styles.accountHealthTitle, isRTL && styles.textRight]}>Tilin luotettavuus</Text>
                </View>
                <View style={[styles.accountHealthStatus, { borderColor: healthTone, backgroundColor: `${healthTone}14` }]}>
                  <Text style={[styles.accountHealthStatusText, { color: healthTone }]}>{healthLabel}</Text>
                </View>
              </View>
              <View style={styles.trustMeterTrack}>
                <View
                  style={[
                    styles.trustMeterFill,
                    {
                      width: `${Math.max(0, Math.min(100, accountHealth?.trust_score ?? user?.trust_score ?? 100))}%`,
                      backgroundColor: healthTone,
                    },
                  ]}
                />
              </View>
              <View style={[styles.accountHealthStats, isRTL && styles.rowReverse]}>
                <View style={styles.accountHealthStat}>
                  <Text style={styles.accountHealthStatValue}>{accountHealth?.trust_score ?? user?.trust_score ?? 100}</Text>
                  <Text style={styles.accountHealthStatLabel}>Trust Score</Text>
                </View>
                <View style={styles.accountHealthStat}>
                  <Text style={styles.accountHealthStatValue}>{accountHealth?.active_restrictions_count ?? 0}</Text>
                  <Text style={styles.accountHealthStatLabel}>Aktiiviset rajoitukset</Text>
                </View>
                <View style={styles.accountHealthStat}>
                  <Text style={styles.accountHealthStatValue}>{accountHealth?.recent_decisions?.length ?? 0}</Text>
                  <Text style={styles.accountHealthStatLabel}>Päätökset</Text>
                </View>
              </View>
              <View style={styles.recoveryPanel}>
                <View style={[styles.recoveryRow, isRTL && styles.rowReverse]}>
                  <Ionicons name="trending-up-outline" size={16} color="#38bdf8" />
                  <Text style={[styles.recoveryText, isRTL && styles.textRight]}>
                    Seuraava palautuminen: {formatHealthDate(accountHealth?.recovery?.next_recovery_at)}
                  </Text>
                </View>
                <Text style={[styles.recoveryMeta, isRTL && styles.textRight]}>
                  Automaattinen palautumiskatto {accountHealth?.recovery?.recovery_cap ?? 90}. Viimeisin rikkomus: {formatHealthDate(accountHealth?.recovery?.last_negative_at)}
                </Text>
              </View>
              <Text style={[styles.accountHealthTip, isRTL && styles.textRight]}>
                {accountHealth?.recovery_tip || 'Tilisi on hyvässä kunnossa. Jatka turvallista ja alkuperäistä sisällöntuotantoa.'}
              </Text>
              {accountHealth?.restricted_posts?.length ? (
                <View style={styles.accountHealthList}>
                  <Text style={[styles.accountHealthListTitle, isRTL && styles.textRight]}>Tarkistuksessa tai rajoitettu</Text>
                  {accountHealth.restricted_posts.slice(0, 3).map((post) => (
                    <TouchableOpacity
                      key={post.post_id}
                      style={styles.accountHealthItem}
                      onPress={() => router.push(`/posts/${post.post_id}`)}
                      activeOpacity={0.84}
                    >
                      <Ionicons name="warning-outline" size={16} color="#d97706" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.accountHealthItemTitle} numberOfLines={1}>
                          {post.title || post.text || 'Julkaisu'}
                        </Text>
                        <Text style={styles.accountHealthItemMeta}>
                          {post.copyright_status || 'clear'} · music {post.music_risk || 'none'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {isProfileView ? <View style={[styles.statsContainer, rtlRowStyle]}>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.posts_count}</Text>
              <Text style={styles.statLabel}>{t('profilePosts')}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.followers_count}</Text>
              <Text style={styles.statLabel}>{t('profileFollowers')}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.following_count}</Text>
              <Text style={styles.statLabel}>{t('profileFollowing')}</Text>
            </View>
          </View> : null}

          {isProfileView ? (
            <View style={styles.profileTabs}>
              {[
                { key: 'posts' as const, label: 'Posts' },
                { key: 'recordings' as const, label: 'Recordings', count: recordings.length },
                { key: 'saved' as const, label: 'Saved' },
                { key: 'likes' as const, label: 'Likes' },
              ].map((tab) => {
                const active = profileContentTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.profileTab, active && styles.profileTabActive]}
                    onPress={() => {
                      if (tab.key === 'saved') {
                        router.push('/(tabs)/saved' as never);
                        return;
                      }
                      setProfileContentTab(tab.key);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.profileTabText, active && styles.profileTabTextActive]}>
                      {tab.label}{typeof tab.count === 'number' ? ` ${tab.count}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {isProfileView && profileContentTab === 'posts' && pinnedProfileRecordings.length ? (
            <View style={styles.pinnedRecordingsPanel}>
              <View style={[styles.pinnedRecordingsHeader, rtlRowStyle]}>
                <View style={styles.pinnedRecordingsHeaderText}>
                  <Text style={[styles.pinnedRecordingsEyebrow, isRTL && styles.textRight]}>Kiinnitetyt replayt</Text>
                  <Text style={[styles.pinnedRecordingsTitle, isRTL && styles.textRight]}>Profiilin live-tallenteet</Text>
                </View>
                <TouchableOpacity
                  style={styles.pinnedRecordingsViewAll}
                  onPress={() => setProfileContentTab('recordings')}
                  accessibilityRole="button"
                  accessibilityLabel="Avaa kaikki live-tallenteet"
                >
                  <Ionicons name="albums-outline" size={15} color="#e0f2fe" />
                  <Text style={styles.pinnedRecordingsViewAllText}>Kaikki</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.pinnedRecordingsGrid, isRTL && styles.rowReverseWrap]}>
                {pinnedProfileRecordings.map((recording) => {
                  const thumbnail = getRecordingThumbnail(recording);
                  return (
                    <TouchableOpacity
                      key={recording.post_id}
                      style={styles.pinnedRecordingCard}
                      onPress={() => router.push(`/posts/${recording.post_id}`)}
                      activeOpacity={0.86}
                      accessibilityRole="button"
                      accessibilityLabel={`Avaa kiinnitetty tallenne ${recording.title || recording.text || 'Live-tallenne'}`}
                    >
                      <View style={styles.pinnedRecordingThumb}>
                        {thumbnail ? (
                          <Image source={{ uri: thumbnail }} style={styles.pinnedRecordingImage} />
                        ) : (
                          <View style={styles.pinnedRecordingFallback}>
                            <Ionicons name="videocam-outline" size={26} color="#60a5fa" />
                          </View>
                        )}
                        <View style={styles.pinnedRecordingReplayBadge}>
                          <View style={styles.recordingReplayDot} />
                          <Text style={styles.pinnedRecordingReplayText}>LIVE REPLAY</Text>
                        </View>
                        <Text style={styles.pinnedRecordingDuration}>{formatReplayDuration(recording.duration || 0)}</Text>
                      </View>
                      <View style={styles.pinnedRecordingBody}>
                        <Text style={[styles.pinnedRecordingTitle, isRTL && styles.textRight]} numberOfLines={2}>
                          {recording.title || recording.text || 'YOSLA Live -tallenne'}
                        </Text>
                        <View style={[styles.pinnedRecordingStats, isRTL && styles.rowReverseWrap]}>
                          <View style={styles.pinnedRecordingStat}>
                            <Ionicons name="eye-outline" size={12} color="#bfdbfe" />
                            <Text style={styles.pinnedRecordingStatText}>{formatCompactCount(recording.views || 0)}</Text>
                          </View>
                          <View style={styles.pinnedRecordingStat}>
                            <Ionicons name="heart-outline" size={12} color="#fecaca" />
                            <Text style={styles.pinnedRecordingStatText}>{formatCompactCount(recording.likes_count || 0)}</Text>
                          </View>
                          <View style={styles.pinnedRecordingStat}>
                            <Ionicons name="chatbubble-outline" size={12} color="#bae6fd" />
                            <Text style={styles.pinnedRecordingStatText}>{formatCompactCount(recording.comments_count || 0)}</Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {isProfileView ? (
            <View style={styles.creatorGrowthCard}>
              <View style={[styles.creatorGrowthHeader, rtlRowStyle]}>
                <View style={styles.creatorGrowthTitleWrap}>
                  <Text style={[styles.creatorGrowthEyebrow, isRTL && styles.textRight]}>Creator Levels</Text>
                  <Text style={[styles.creatorGrowthTitle, isRTL && styles.textRight]}>
                    Taso {creatorLevel?.level || 1}: {creatorLevel?.name || 'Starter'}
                  </Text>
                  <Text style={[styles.creatorGrowthMeta, isRTL && styles.textRight]}>
                    {Math.round(Number(creatorLevel?.score || 0))} YOSLA Rank -pistettä
                  </Text>
                </View>
                <View style={styles.creatorLevelBadge}>
                  <Text style={styles.creatorLevelBadgeText}>{creatorLevel?.level || 1}</Text>
                </View>
              </View>
              <View style={styles.creatorProgressTrack}>
                <View style={[styles.creatorProgressFill, { width: `${Math.max(5, Math.min(100, Number(creatorLevel?.progress || 0)))}%` }]} />
              </View>
              <View style={[styles.achievementPreviewGrid, isRTL && styles.rowReverseWrap]}>
                {(achievementsPayload?.achievements || []).slice(0, 3).map((achievement) => (
                  <View
                    key={achievement.achievement_id}
                    style={[styles.achievementPreviewPill, achievement.unlocked && styles.achievementPreviewUnlocked]}
                  >
                    <Ionicons
                      name={(achievement.icon || 'ribbon-outline') as keyof typeof Ionicons.glyphMap}
                      size={15}
                      color={achievement.unlocked ? '#f8fafc' : '#38bdf8'}
                    />
                    <View style={styles.achievementPreviewTextWrap}>
                      <Text style={[styles.achievementPreviewTitle, achievement.unlocked && styles.achievementPreviewTitleUnlocked]} numberOfLines={1}>
                        {achievement.title}
                      </Text>
                      <Text style={[styles.achievementPreviewMeta, achievement.unlocked && styles.achievementPreviewMetaUnlocked]}>
                        {achievement.progress}%
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {isProfileView && profileContentTab === 'recordings' ? (
            <View style={styles.recordingsSection}>
              <View style={[styles.recordingsHeaderRow, rtlRowStyle]}>
                <View style={styles.recordingsHeaderText}>
                  <Text style={[styles.recordingsTitle, isRTL && styles.textRight]}>Live-tallenteet</Text>
                  <Text style={[styles.recordingsSubtitle, isRTL && styles.textRight]}>
                    Hallitse julkaistuja replay-videoita, otsikoita ja kansikuvia.
                  </Text>
                </View>
                <Ionicons name="videocam" size={22} color="#38bdf8" />
              </View>
              <View style={[styles.recordingSortRow, isRTL && styles.rowReverseWrap]}>
                {[
                  { key: 'newest' as const, label: 'Uusimmat' },
                  { key: 'oldest' as const, label: 'Vanhimmat' },
                  { key: 'longest' as const, label: 'Pisimmät' },
                  { key: 'popular' as const, label: 'Suositut' },
                ].map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.recordingSortPill,
                      recordingSortMode === item.key && styles.recordingSortPillActive,
                    ]}
                    onPress={() => setRecordingSortMode(item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: recordingSortMode === item.key }}
                  >
                    <Text
                      style={[
                        styles.recordingSortText,
                        recordingSortMode === item.key && styles.recordingSortTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[styles.recordingAnalyticsGrid, isRTL && styles.rowReverseWrap]}>
                <View style={styles.recordingAnalyticsCard}>
                  <Ionicons name="eye-outline" size={16} color="#bfdbfe" />
                  <Text style={styles.recordingAnalyticsValue}>{formatCompactCount(recordingAnalytics.views)}</Text>
                  <Text style={styles.recordingAnalyticsLabel}>Views yhteensä</Text>
                </View>
                <View style={styles.recordingAnalyticsCard}>
                  <Ionicons name="repeat-outline" size={16} color="#ddd6fe" />
                  <Text style={styles.recordingAnalyticsValue}>{formatCompactCount(recordingAnalytics.replays)}</Text>
                  <Text style={styles.recordingAnalyticsLabel}>Replayt</Text>
                </View>
                <View style={styles.recordingAnalyticsCard}>
                  <Ionicons name="time-outline" size={16} color="#bbf7d0" />
                  <Text style={styles.recordingAnalyticsValue}>{formatWatchTime(recordingAnalytics.watchTime)}</Text>
                  <Text style={styles.recordingAnalyticsLabel}>Watch time</Text>
                </View>
                <View style={styles.recordingAnalyticsCard}>
                  <Ionicons name="analytics-outline" size={16} color="#fef3c7" />
                  <Text style={styles.recordingAnalyticsValue}>{formatCompletionRate(averageRecordingCompletion)}</Text>
                  <Text style={styles.recordingAnalyticsLabel}>Avg completion</Text>
                </View>
              </View>
              {sortedRecordings.length ? (
                <View style={styles.recordingGrid}>
                  {sortedRecordings.map((recording) => (
                    <View key={recording.post_id} style={styles.recordingCard}>
                      <TouchableOpacity
                        style={styles.recordingThumb}
                        onPress={() => router.push(`/posts/${recording.post_id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`Avaa tallenne ${recording.title || recording.text || 'Live-tallenne'}`}
                      >
                        {getRecordingThumbnail(recording) ? (
                          <Image
                            source={{ uri: getRecordingThumbnail(recording) }}
                            style={styles.recordingThumbImage}
                          />
                        ) : (
                          <View style={styles.recordingThumbFallback}>
                            <Ionicons name="play-circle" size={42} color="#e0f2fe" />
                            <Text style={styles.recordingMissingThumbnailText}>Kansikuva puuttuu</Text>
                          </View>
                        )}
                        <View style={styles.recordingReplayBadge}>
                          <View style={styles.recordingReplayDot} />
                          <Text style={styles.recordingReplayText}>LIVE REPLAY</Text>
                        </View>
                        <View style={styles.recordingThumbOverlay}>
                          <Text style={styles.recordingDuration}>{formatReplayDuration(recording.duration || 0)}</Text>
                          <View style={styles.recordingThumbMetricRow}>
                            <View style={styles.recordingThumbMetricPill}>
                              <Ionicons name="eye-outline" size={11} color="#bfdbfe" />
                              <Text style={styles.recordingThumbMetricText}>{formatCompactCount(recording.views || 0)}</Text>
                            </View>
                            <View style={styles.recordingThumbMetricPill}>
                              <Ionicons name="repeat-outline" size={11} color="#ddd6fe" />
                              <Text style={styles.recordingThumbMetricText}>{formatCompactCount(recording.replay_count || 0)}</Text>
                            </View>
                          </View>
                        </View>
                      </TouchableOpacity>
                      <View style={styles.recordingBody}>
                        <View style={[styles.recordingMetaTopRow, isRTL && styles.rowReverse]}>
                          <View style={styles.recordingCreatorBadge}>
                            <Ionicons name="person-circle-outline" size={14} color="#93c5fd" />
                            <Text style={styles.recordingCreatorText}>@{recording.username || user?.username || 'creator'}</Text>
                          </View>
                          <Text style={[styles.recordingCardDate, isRTL && styles.textRight]}>
                            {formatReplayDate(recording.created_at)}
                          </Text>
                        </View>
                        <View style={[styles.recordingStatusRow, isRTL && styles.rowReverseWrap]}>
                          {isRecordingPinned(recording) ? (
                            <View style={styles.recordingPinnedBadge}>
                              <Ionicons name="pin" size={12} color="#fde68a" />
                              <Text style={styles.recordingPinnedText}>Kiinnitetty</Text>
                            </View>
                          ) : null}
                          <View style={styles.recordingVisibilityBadge}>
                            <Ionicons
                              name={getRecordingVisibility(recording) === 'public' ? 'earth-outline' : 'lock-closed-outline'}
                              size={12}
                              color={getRecordingVisibility(recording) === 'public' ? '#bbf7d0' : '#c4b5fd'}
                            />
                            <Text style={styles.recordingVisibilityText}>
                              {getRecordingVisibility(recording) === 'public' ? 'Julkinen' : 'Yksityinen'}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.recordingCardTitle, isRTL && styles.textRight]} numberOfLines={2}>
                          {recording.title || recording.text || 'YOSLA Live -tallenne'}
                        </Text>
                        <View style={[styles.recordingStatsRow, isRTL && styles.rowReverseWrap]}>
                          <View style={styles.recordingStatPill}>
                            <Ionicons name="eye-outline" size={12} color="#bfdbfe" />
                            <Text style={styles.recordingStat}>Views {formatCompactCount(recording.views || 0)}</Text>
                          </View>
                          <View style={styles.recordingStatPill}>
                            <Ionicons name="heart-outline" size={12} color="#fecaca" />
                            <Text style={styles.recordingStat}>Likes {formatCompactCount(recording.likes_count || 0)}</Text>
                          </View>
                          <View style={styles.recordingStatPill}>
                            <Ionicons name="chatbubble-outline" size={12} color="#bae6fd" />
                            <Text style={styles.recordingStat}>Comments {formatCompactCount(recording.comments_count || 0)}</Text>
                          </View>
                          <View style={styles.recordingStatPill}>
                            <Ionicons name="repeat-outline" size={12} color="#ddd6fe" />
                            <Text style={styles.recordingStat}>Replays {formatCompactCount(recording.replay_count || 0)}</Text>
                          </View>
                        </View>
                        <View style={[styles.recordingInsightRow, isRTL && styles.rowReverseWrap]}>
                          <View style={styles.recordingInsightPill}>
                            <Ionicons name="time-outline" size={12} color="#bbf7d0" />
                            <Text style={styles.recordingInsightText}>Watch {formatWatchTime(recording.watch_time || 0)}</Text>
                          </View>
                          <View style={styles.recordingInsightPill}>
                            <Ionicons name="analytics-outline" size={12} color="#fef3c7" />
                            <Text style={styles.recordingInsightText}>Completion {formatCompletionRate(recording.completion_rate || 0)}</Text>
                          </View>
                        </View>
                        <View style={[styles.recordingActionsRow, isRTL && styles.rowReverse]}>
                          <TouchableOpacity
                            style={styles.recordingActionButton}
                            onPress={() => router.push(`/posts/${recording.post_id}`)}
                          >
                            <Ionicons name="open-outline" size={15} color="#0f172a" />
                            <Text style={styles.recordingActionText}>Avaa</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.recordingActionButton}
                            onPress={() => openRecordingEditor(recording)}
                          >
                            <Ionicons name="create-outline" size={15} color="#0f172a" />
                            <Text style={styles.recordingActionText}>Muokkaa</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.recordingActionButton,
                              getRecordingVisibility(recording) !== 'public' && styles.recordingDisabledActionButton,
                            ]}
                            onPress={() => copyRecordingLink(recording)}
                            disabled={getRecordingVisibility(recording) !== 'public'}
                            accessibilityRole="button"
                            accessibilityLabel={
                              getRecordingVisibility(recording) === 'public'
                                ? 'Kopioi tallenteen linkki'
                                : 'Yksityistä tallennetta ei voi jakaa linkillä'
                            }
                          >
                            <Ionicons
                              name={getRecordingVisibility(recording) === 'public' ? 'link-outline' : 'lock-closed-outline'}
                              size={15}
                              color={getRecordingVisibility(recording) === 'public' ? '#0f172a' : '#64748b'}
                            />
                            <Text
                              style={[
                                styles.recordingActionText,
                                getRecordingVisibility(recording) !== 'public' && styles.recordingDisabledActionText,
                              ]}
                            >
                              Kopioi
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.recordingActionButton, isRecordingPinned(recording) && styles.recordingPinnedActionButton]}
                            onPress={() => toggleRecordingPinned(recording)}
                            disabled={loading}
                          >
                            <Ionicons name={isRecordingPinned(recording) ? 'pin' : 'pin-outline'} size={15} color="#0f172a" />
                            <Text style={styles.recordingActionText}>{isRecordingPinned(recording) ? 'Irrota' : 'Kiinnitä'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.recordingActionButton}
                            onPress={() => toggleRecordingVisibility(recording)}
                            disabled={loading}
                          >
                            <Ionicons name={getRecordingVisibility(recording) === 'public' ? 'lock-closed-outline' : 'earth-outline'} size={15} color="#0f172a" />
                            <Text style={styles.recordingActionText}>{getRecordingVisibility(recording) === 'public' ? 'Yksityinen' : 'Julkinen'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.recordingActionButton, styles.recordingDeleteButton]}
                            onPress={() => deleteRecording(recording)}
                          >
                            <Ionicons name="trash-outline" size={15} color="#fecaca" />
                            <Text style={styles.recordingDeleteText}>Poista</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.recordingsEmptyCard}>
                  <Ionicons name="film-outline" size={28} color="#64748b" />
                  <Text style={styles.recordingsEmptyTitle}>Ei live-tallenteita vielä</Text>
                  <Text style={styles.recordingsEmptyText}>
                    Kun julkaiset live-replayn, se ilmestyy tähän muokattavaksi ja jaettavaksi.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {isProfileView ? (
            <TouchableOpacity
              style={[styles.startLiveButton, rtlRowStyle]}
              onPress={openLivePrompt}
              accessibilityRole="button"
              accessibilityLabel="Aloita live-lähetys"
              accessibilityHint="Avaa aiheen ja hashtagien valinnan ennen live-studioon siirtymistä"
            >
              <View style={styles.startLiveIcon}>
                <Ionicons name="radio-outline" size={22} color="#fff" />
              </View>
              <View style={styles.startLiveTextWrap}>
                <Text style={[styles.startLiveTitle, isRTL && styles.textRight]}>🔴 Aloita live-lähetys</Text>
                <Text style={[styles.startLiveSubtitle, isRTL && styles.textRight]}>Valitse aihe ja siirry WebRTC-studioon</Text>
              </View>
              <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color="#fff" />
            </TouchableOpacity>
          ) : null}

          {isProfileView ? <TouchableOpacity
            style={[styles.messagesCard, rtlRowStyle]}
            onPress={() => router.push('/messages')}
            accessibilityRole="button"
            accessibilityLabel={t('messages')}
            accessibilityHint={t('messagesSubtitle')}
          >
            <View style={styles.messagesIconWrap}>
              <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
            </View>
            <View style={styles.messagesTextWrap}>
              <Text style={[styles.messagesEyebrow, isRTL && styles.textRight]}>{t('messages')}</Text>
              <Text style={[styles.messagesTitle, isRTL && styles.textRight]}>{t('messages')}</Text>
              <Text style={[styles.messagesBody, isRTL && styles.textRight]}>{t('messagesSubtitle')}</Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color="#0F62FE" />
          </TouchableOpacity> : null}

          {isProfileView ? <TouchableOpacity
            style={[styles.messagesCard, rtlRowStyle]}
            onPress={() => router.push('/(tabs)/settings' as never)}
            accessibilityRole="button"
            accessibilityLabel="Avaa asetukset"
            accessibilityHint="Siirtyy profiilin asetuksiin"
          >
            <View style={styles.settingsIconWrap}>
              <Ionicons name="settings" size={22} color="#fff" />
            </View>
            <View style={styles.messagesTextWrap}>
              <Text style={[styles.messagesEyebrow, isRTL && styles.textRight]}>Asetukset</Text>
              <Text style={[styles.messagesTitle, isRTL && styles.textRight]}>Muokkaa profiilia ja näkyvyyttä</Text>
              <Text style={[styles.messagesBody, isRTL && styles.textRight]}>Kieli, parisuhdestatus, turvallisuus ja uloskirjautuminen.</Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color="#0F62FE" />
          </TouchableOpacity> : null}

          {isProfileView ? <TouchableOpacity
            style={[styles.messagesCard, rtlRowStyle]}
            onPress={() => router.push('/(tabs)/saved' as never)}
            accessibilityRole="button"
            accessibilityLabel="Avaa tallennetut julkaisut"
            accessibilityHint="Siirtyy omiin kirjanmerkkeihin"
          >
            <View style={styles.savedIconWrap}>
              <Ionicons name="bookmark" size={22} color="#fff" />
            </View>
            <View style={styles.messagesTextWrap}>
              <Text style={[styles.messagesEyebrow, isRTL && styles.textRight]}>Tallennetut</Text>
              <Text style={[styles.messagesTitle, isRTL && styles.textRight]}>Kirjanmerkit omana näkymänä</Text>
              <Text style={[styles.messagesBody, isRTL && styles.textRight]}>Avaa julkaisut, keskustelut, kyselyt, livet ja kampanjat, jotka olet merkinnyt talteen.</Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color="#0F62FE" />
          </TouchableOpacity> : null}

          {isSavedView ? <View style={styles.savedSection}>
            <View style={[styles.savedHeaderRow, rtlRowStyle]}>
              <View>
                <Text style={[styles.savedTitle, isRTL && styles.textRight]}>Tallennetut</Text>
                <Text style={[styles.savedSubtitle, isRTL && styles.textRight]}>Palaa tallennettuihin julkaisuihin, keskusteluihin, kyselyihin ja livehetkiin nopeasti.</Text>
              </View>
              {savedLoading ? <ActivityIndicator size="small" color="#007AFF" /> : <Ionicons name="bookmark" size={20} color="#0F62FE" />}
            </View>
            <View style={[styles.savedCollectionGrid, isRTL && styles.rowReverseWrap]}>
              {savedCollections.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.savedCollectionPill,
                    savedCategory === item.key && styles.savedCollectionPillActive,
                  ]}
                  onPress={() => setSavedCategory(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: savedCategory === item.key }}
                >
                  <View style={styles.savedCollectionIcon}>
                    <Ionicons name={item.icon} size={15} color="#0F62FE" />
                  </View>
                  <View style={styles.savedCollectionTextWrap}>
                    <Text style={styles.savedCollectionLabel}>{item.label}</Text>
                    <Text style={styles.savedCollectionDescription}>{item.description}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            {filteredSavedPosts.length ? (
              <View style={styles.savedList}>
                {filteredSavedPosts.map((post) => (
                  <TouchableOpacity
                    key={post.post_id}
                    style={styles.savedPostCard}
                    onPress={() => router.push(`/posts/${post.post_id}`)}
                  >
                    <View style={[styles.savedPostTopRow, rtlRowStyle]}>
                      <Text style={styles.savedPostAuthor}>@{post.username}</Text>
                      <Text style={styles.savedPostTime}>{formatRelativeTime(post.created_at)}</Text>
                    </View>
                    <Text style={[styles.savedPostText, isRTL && styles.textRight]} numberOfLines={2}>
                      {post.poll?.question || post.text || 'Tallennettu julkaisu'}
                    </Text>
                    <View style={[styles.savedPostMetaRow, rtlRowStyle]}>
                      <Text style={styles.savedPostMeta}>{post.comments_count || 0} kommenttia</Text>
                      <Text style={styles.savedPostMeta}>{post.reaction_counts ? Object.values(post.reaction_counts).reduce((sum, value) => sum + Number(value || 0), 0) : 0} reaktiota</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.savedEmptyCard}>
                <Ionicons name="bookmark-outline" size={24} color="#64748b" />
                <Text style={styles.savedEmptyText}>Et ole vielä tallentanut julkaisuja, keskusteluja, kyselyitä, livejä tai kampanjoita.</Text>
              </View>
            )}
          </View> : null}
        </View>

        {isSettingsView ? <View style={styles.actions}>
          {editing ? (
            <>
              <View style={[styles.editActions, rtlRowStyle]}>
                <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={cancelEdit}>
                  <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.saveButton, isSaveDisabled && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={isSaveDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Tallenna profiilin muutokset"
                  accessibilityHint="Lähettää muokatut profiilitiedot palvelimelle"
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('profileSave')}</Text>}
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
                <Text style={[styles.editButtonText, isRTL && styles.editButtonTextRTL]}>{t('profileEdit')}</Text>
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
                <Text style={[styles.logoutButtonText, isRTL && styles.logoutButtonTextRTL]}>{t('profileLogout')}</Text>
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
                <Text style={[styles.editButtonText, isRTL && styles.editButtonTextRTL]}>{t('profileSafety')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.editButton, isBusy && styles.buttonDisabled]}
                onPress={() => router.push('/(tabs)/notifications' as never)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Avaa ilmoitukset"
                accessibilityHint="Siirtyy ilmoitusnäkymään"
              >
                <Ionicons name="notifications-outline" size={20} color="#007AFF" />
                <Text style={[styles.editButtonText, isRTL && styles.editButtonTextRTL]}>{formatNotificationsLabel(unreadNotifications)}</Text>
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
                <Text style={[styles.editButtonText, isRTL && styles.editButtonTextRTL]}>{t('profileDrafts')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View> : null}
      </ScrollView>
      <Modal
        visible={livePromptVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setLivePromptVisible(false)}
      >
        <View style={styles.livePromptOverlay}>
          <View style={styles.livePromptCard}>
            <View style={styles.livePromptHeader}>
              <View style={styles.livePromptDot} />
              <Text style={styles.livePromptTitle}>Aloita live-lähetys</Text>
            </View>
            <Text style={styles.livePromptBody}>Kirjoita lähetyksen aihe tai hashtagit, esimerkiksi #Luonto tai #Musiikki.</Text>
            <TextInput
              style={styles.livePromptInput}
              value={liveTopic}
              onChangeText={setLiveTopic}
              placeholder="#Luonto #Musiikki"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={startLiveStream}
            />
            <View style={styles.livePromptActions}>
              <TouchableOpacity style={styles.livePromptSecondary} onPress={() => setLivePromptVisible(false)}>
                <Text style={styles.livePromptSecondaryText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.livePromptPrimary} onPress={startLiveStream}>
                <Text style={styles.livePromptPrimaryText}>Aloita</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={recordingEditorVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setRecordingEditorVisible(false)}
      >
        <View style={styles.livePromptOverlay}>
          <View style={styles.recordingEditorCard}>
            <View style={styles.recordingEditorHeader}>
              <View>
                <Text style={styles.recordingEditorEyebrow}>LIVE REPLAY</Text>
                <Text style={styles.recordingEditorTitle}>Muokkaa tallennetta</Text>
              </View>
              <TouchableOpacity
                style={styles.recordingEditorClose}
                onPress={() => setRecordingEditorVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Sulje tallenteen muokkaus"
              >
                <Ionicons name="close" size={20} color="#cbd5e1" />
              </TouchableOpacity>
            </View>
            <Text style={styles.recordingEditorLabel}>Otsikko</Text>
            <TextInput
              style={styles.recordingEditorInput}
              value={recordingTitleDraft}
              onChangeText={setRecordingTitleDraft}
              placeholder="Tallenne: #Luonto"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.recordingEditorLabel}>Kuvaus</Text>
            <TextInput
              style={[styles.recordingEditorInput, styles.recordingEditorTextarea]}
              value={recordingDescriptionDraft}
              onChangeText={setRecordingDescriptionDraft}
              placeholder="Lisää kuvaus tai hashtagit"
              placeholderTextColor="#64748b"
              multiline
            />
            <Text style={styles.recordingEditorLabel}>Näkyvyys</Text>
            <View style={styles.recordingVisibilityControl}>
              {(['public', 'private'] as RecordingVisibility[]).map((visibility) => (
                <TouchableOpacity
                  key={visibility}
                  style={[
                    styles.recordingVisibilityOption,
                    recordingVisibilityDraft === visibility && styles.recordingVisibilityOptionActive,
                  ]}
                  onPress={() => setRecordingVisibilityDraft(visibility)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: recordingVisibilityDraft === visibility }}
                >
                  <Ionicons
                    name={visibility === 'public' ? 'earth-outline' : 'lock-closed-outline'}
                    size={16}
                    color={recordingVisibilityDraft === visibility ? '#020617' : '#cbd5e1'}
                  />
                  <Text
                    style={[
                      styles.recordingVisibilityOptionText,
                      recordingVisibilityDraft === visibility && styles.recordingVisibilityOptionTextActive,
                    ]}
                  >
                    {visibility === 'public' ? 'Julkinen' : 'Yksityinen'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.recordingPinToggle, recordingPinnedDraft && styles.recordingPinToggleActive]}
              onPress={() => setRecordingPinnedDraft((current) => !current)}
              accessibilityRole="switch"
              accessibilityState={{ checked: recordingPinnedDraft }}
            >
              <Ionicons name={recordingPinnedDraft ? 'pin' : 'pin-outline'} size={17} color={recordingPinnedDraft ? '#fde68a' : '#cbd5e1'} />
              <View style={styles.recordingPinToggleTextWrap}>
                <Text style={styles.recordingPinToggleTitle}>Kiinnitä profiiliin</Text>
                <Text style={styles.recordingPinToggleSubtitle}>Näytä tallenne oman profiilin kärjessä.</Text>
              </View>
            </TouchableOpacity>
            <Text style={styles.recordingEditorLabel}>Kansikuva</Text>
            <View style={styles.recordingThumbnailPanel}>
              <View style={styles.recordingThumbnailHeaderRow}>
                <Text style={styles.recordingThumbnailPreviewLabel}>Esikatselu ennen tallennusta</Text>
                {thumbnailDraftChanged ? (
                  <View style={styles.recordingThumbnailPendingBadge}>
                    <Ionicons name="sparkles-outline" size={12} color="#fde68a" />
                    <Text style={styles.recordingThumbnailPendingText}>Odottaa tallennusta</Text>
                  </View>
                ) : null}
              </View>
              {recordingThumbnailDraft ? (
                <Image source={{ uri: recordingThumbnailDraft }} style={styles.recordingThumbnailPreview} />
              ) : (
                <View style={styles.recordingThumbnailEmpty}>
                  <Ionicons name="image-outline" size={28} color="#64748b" />
                  <Text style={styles.recordingThumbnailEmptyText}>Ei kansikuvaa</Text>
                </View>
              )}
              <View style={styles.recordingThumbnailActions}>
                <TouchableOpacity
                  style={styles.recordingThumbnailButton}
                  onPress={pickRecordingThumbnail}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="Valitse tallenteelle kansikuva"
                >
                  <Ionicons name="images-outline" size={16} color="#e0f2fe" />
                  <Text style={styles.recordingThumbnailButtonText}>Valitse kuva</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recordingThumbnailButton, styles.recordingThumbnailRemoveButton]}
                  onPress={() => setRecordingThumbnailDraft('')}
                  disabled={loading || !recordingThumbnailDraft}
                  accessibilityRole="button"
                  accessibilityLabel="Poista tallenteen kansikuva"
                >
                  <Ionicons name="close-circle-outline" size={16} color="#fecaca" />
                  <Text style={styles.recordingThumbnailRemoveText}>Poista</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.recordingEditorInput, styles.recordingThumbnailUrlInput]}
                value={recordingThumbnailDraft}
                onChangeText={setRecordingThumbnailDraft}
                placeholder="Tai liitä kansikuvan URL"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.recordingThumbnailHelperText}>
                {thumbnailDraftChanged
                  ? recordingThumbnailDraft
                    ? 'Uusi kansikuva julkaistaan, kun tallennat muutokset.'
                    : 'Kansikuva poistetaan, kun tallennat muutokset.'
                  : 'Valitse kuva tai liita URL, ja tarkista esikatselu ennen tallennusta.'}
              </Text>
            </View>
            <View style={styles.recordingEditorActions}>
              <TouchableOpacity
                style={styles.livePromptSecondary}
                onPress={() => setRecordingEditorVisible(false)}
                disabled={loading}
              >
                <Text style={styles.livePromptSecondaryText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.livePromptPrimary, loading && styles.buttonDisabled]}
                onPress={saveRecordingEdits}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.livePromptPrimaryText}>Tallenna</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  languageCard: {
    width: '100%',
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  languageCardRTL: {
    alignSelf: 'stretch',
  },
  sectionIntroCard: {
    width: '100%',
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCEBFF',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0066FF',
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  sectionIntroKicker: {
    color: '#0066FF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionIntroTitle: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '900',
  },
  sectionIntroBody: {
    marginTop: 6,
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
  personaBanner: {
    width: '100%',
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  personaBannerExplore: {
    backgroundColor: '#F7FBFF',
    borderColor: '#CFE4FF',
  },
  personaBannerPersonal: {
    backgroundColor: '#F5F9F4',
    borderColor: '#D6E8D1',
  },
  personaBannerComplete: {
    backgroundColor: '#ECFDF3',
    borderColor: '#A6F4C5',
  },
  personaEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#60708A',
    marginBottom: 4,
  },
  personaTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#16233A',
    marginBottom: 4,
  },
  personaBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#3F4B63',
    marginBottom: 10,
  },
  personaAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#CFE4FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  personaActionText: {
    color: '#007AFF',
    fontWeight: '700',
    fontSize: 13,
  },
  languageLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
    color: '#101828',
  },
  textRight: {
    textAlign: 'right',
  },
  languagePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  languagePill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F2F4F7',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  languagePillActive: {
    backgroundColor: '#101828',
    borderColor: '#101828',
  },
  languagePillText: {
    fontSize: 13,
    color: '#344054',
    fontWeight: '600',
  },
  languagePillTextActive: {
    color: '#fff',
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
  avatarHalo: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 66,
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.22)',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#e0e0e0',
  },
  avatarPresenceDot: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#10b981',
    borderWidth: 3,
    borderColor: '#fff',
  },
  lastActiveText: {
    marginTop: 8,
    alignSelf: 'center',
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '600',
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
  relationshipStatusLine: {
    marginTop: 7,
    color: '#718096',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
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
  relationshipCard: {
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#F8FBFF',
    padding: 14,
    shadowColor: '#0066FF',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  relationshipHeading: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
  },
  relationshipSubtitle: {
    marginTop: 5,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  relationshipOptions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  relationshipOption: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 150,
    minHeight: 58,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#D7E8FF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  relationshipOptionActive: {
    backgroundColor: '#0066FF',
    borderColor: '#0066FF',
    shadowColor: '#0066FF',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 12,
    elevation: 3,
  },
  relationshipOptionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  relationshipOptionLabel: {
    color: '#1E3A8A',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  relationshipOptionLabelActive: {
    color: '#FFFFFF',
  },
  relationshipOptionDescription: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  relationshipOptionDescriptionActive: {
    color: '#DBEAFE',
  },
  relationshipCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
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
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  rowReverseWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
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
  profileTabs: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
    padding: 4,
    borderRadius: 18,
    backgroundColor: '#e5e7eb',
  },
  profileTab: {
    flexGrow: 1,
    minWidth: 84,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  profileTabActive: {
    backgroundColor: '#07111f',
    shadowColor: '#020617',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 3,
  },
  profileTabText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  profileTabTextActive: {
    color: '#f8fafc',
  },
  pinnedRecordingsPanel: {
    width: '100%',
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07111f',
    padding: 14,
  },
  pinnedRecordingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  pinnedRecordingsHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pinnedRecordingsEyebrow: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  pinnedRecordingsTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 3,
  },
  pinnedRecordingsViewAll: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.38)',
    backgroundColor: 'rgba(37,99,235,0.18)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pinnedRecordingsViewAllText: {
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '900',
  },
  pinnedRecordingsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pinnedRecordingCard: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 220,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.22)',
    backgroundColor: '#020617',
    overflow: 'hidden',
  },
  pinnedRecordingThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#0f172a',
  },
  pinnedRecordingImage: {
    width: '100%',
    height: '100%',
  },
  pinnedRecordingFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  pinnedRecordingReplayBadge: {
    position: 'absolute',
    top: 9,
    left: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(127,29,29,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.42)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  pinnedRecordingReplayText: {
    color: '#fee2e2',
    fontSize: 9,
    fontWeight: '900',
  },
  pinnedRecordingDuration: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.86)',
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  pinnedRecordingBody: {
    padding: 11,
  },
  pinnedRecordingTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 17,
    minHeight: 34,
  },
  pinnedRecordingStats: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  pinnedRecordingStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  pinnedRecordingStatText: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingsSection: {
    width: '100%',
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07111f',
    padding: 14,
  },
  recordingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  recordingsHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  recordingsTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '900',
  },
  recordingsSubtitle: {
    marginTop: 3,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  recordingSortRow: {
    marginTop: 13,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recordingSortPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recordingSortPillActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0c4a6e',
  },
  recordingSortText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingSortTextActive: {
    color: '#f0f9ff',
  },
  recordingAnalyticsGrid: {
    marginTop: 13,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  recordingAnalyticsCard: {
    flexGrow: 1,
    minWidth: 132,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.22)',
    backgroundColor: 'rgba(15,23,42,0.86)',
    padding: 11,
    gap: 5,
  },
  recordingAnalyticsValue: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '900',
  },
  recordingAnalyticsLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  recordingGrid: {
    marginTop: 14,
    gap: 12,
  },
  recordingCard: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.42)',
    backgroundColor: '#07111f',
    shadowColor: '#dc2626',
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  recordingThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#020617',
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(248,113,113,0.24)',
  },
  recordingThumbImage: {
    width: '100%',
    height: '100%',
  },
  recordingThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#111827',
  },
  recordingMissingThumbnailText: {
    color: '#bfdbfe',
    fontSize: 11,
    fontWeight: '900',
  },
  recordingReplayBadge: {
    position: 'absolute',
    left: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(220,38,38,0.22)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  recordingReplayDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  recordingReplayText: {
    color: '#fecaca',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingThumbOverlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.42)',
    backgroundColor: 'rgba(2,6,23,0.86)',
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 7,
    shadowColor: '#ef4444',
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  recordingDuration: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
  },
  recordingThumbMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  recordingThumbMetricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  recordingThumbMetricText: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingBody: {
    padding: 12,
  },
  recordingMetaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 9,
  },
  recordingStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 8,
  },
  recordingPinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(120,53,15,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.44)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  recordingPinnedText: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingVisibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  recordingVisibilityText: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingCreatorBadge: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(37,99,235,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.24)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  recordingCreatorText: {
    color: '#bfdbfe',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingCardTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  recordingCardDate: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
  },
  recordingStatsRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  recordingStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  recordingStat: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingInsightRow: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  recordingInsightPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  recordingInsightText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recordingActionButton: {
    flexGrow: 1,
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: '#e0f2fe',
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  recordingPinnedActionButton: {
    backgroundColor: '#fde68a',
  },
  recordingDisabledActionButton: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  recordingActionText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingDisabledActionText: {
    color: '#64748b',
  },
  recordingDeleteButton: {
    backgroundColor: '#7f1d1d',
  },
  recordingDeleteText: {
    color: '#fecaca',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingsEmptyCard: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#243244',
    backgroundColor: '#0f172a',
    padding: 18,
  },
  recordingsEmptyTitle: {
    marginTop: 8,
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
  },
  recordingsEmptyText: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
  creatorGrowthCard: {
    width: '100%',
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07111f',
    padding: 14,
  },
  creatorGrowthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  creatorGrowthTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  creatorGrowthEyebrow: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  creatorGrowthTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 3,
  },
  creatorGrowthMeta: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  creatorLevelBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f62fe',
    borderWidth: 1,
    borderColor: '#60a5fa',
  },
  creatorLevelBadgeText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  creatorProgressTrack: {
    height: 9,
    borderRadius: 999,
    backgroundColor: '#0f172a',
    overflow: 'hidden',
    marginTop: 13,
  },
  creatorProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#38bdf8',
  },
  achievementPreviewGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  achievementPreviewPill: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#243244',
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  achievementPreviewUnlocked: {
    borderColor: '#0f62fe',
    backgroundColor: '#0f62fe',
  },
  achievementPreviewTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  achievementPreviewTitle: {
    color: '#e0f2fe',
    fontSize: 11,
    fontWeight: '900',
  },
  achievementPreviewTitleUnlocked: {
    color: '#fff',
  },
  achievementPreviewMeta: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
  },
  achievementPreviewMetaUnlocked: {
    color: '#dbeafe',
  },
  startLiveButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#f87171',
    borderRadius: 20,
    padding: 15,
    marginTop: 18,
    shadowColor: '#dc2626',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  startLiveIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startLiveTextWrap: { flex: 1 },
  startLiveTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  startLiveSubtitle: {
    marginTop: 3,
    color: '#fee2e2',
    fontSize: 12,
    fontWeight: '700',
  },
  messagesCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 18,
    padding: 14,
    marginTop: 18,
  },
  livePromptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  livePromptCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07111f',
    padding: 18,
  },
  livePromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  livePromptDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#ef4444',
  },
  livePromptTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  livePromptBody: {
    marginTop: 10,
    color: '#cbd5e1',
    lineHeight: 21,
  },
  livePromptInput: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    backgroundColor: '#020617',
    color: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
  },
  livePromptActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  livePromptSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 12,
  },
  livePromptSecondaryText: {
    color: '#cbd5e1',
    fontWeight: '900',
  },
  livePromptPrimary: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#dc2626',
  },
  livePromptPrimaryText: {
    color: '#fff',
    fontWeight: '900',
  },
  recordingEditorCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07111f',
    padding: 18,
  },
  recordingEditorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  recordingEditorEyebrow: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  recordingEditorTitle: {
    marginTop: 2,
    color: '#f8fafc',
    fontSize: 19,
    fontWeight: '900',
  },
  recordingEditorClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  recordingEditorLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 7,
  },
  recordingEditorInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    backgroundColor: '#020617',
    color: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 13,
  },
  recordingEditorTextarea: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  recordingVisibilityControl: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  recordingVisibilityOption: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  recordingVisibilityOptionActive: {
    borderColor: '#7dd3fc',
    backgroundColor: '#bae6fd',
  },
  recordingVisibilityOptionText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingVisibilityOptionTextActive: {
    color: '#020617',
  },
  recordingPinToggle: {
    marginBottom: 13,
    minHeight: 56,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordingPinToggleActive: {
    borderColor: 'rgba(251,191,36,0.68)',
    backgroundColor: 'rgba(120,53,15,0.36)',
  },
  recordingPinToggleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  recordingPinToggleTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
  },
  recordingPinToggleSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  recordingThumbnailPanel: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 16,
    backgroundColor: '#020617',
    padding: 10,
    marginBottom: 13,
  },
  recordingThumbnailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  recordingThumbnailPreviewLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingThumbnailPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.42)',
    backgroundColor: 'rgba(120,53,15,0.34)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  recordingThumbnailPendingText: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '900',
  },
  recordingThumbnailPreview: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    marginBottom: 10,
  },
  recordingThumbnailEmpty: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#334155',
    backgroundColor: '#07111f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
  },
  recordingThumbnailEmptyText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '800',
  },
  recordingThumbnailActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  recordingThumbnailButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  recordingThumbnailRemoveButton: {
    backgroundColor: '#3f1115',
    borderColor: '#7f1d1d',
  },
  recordingThumbnailButtonText: {
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingThumbnailRemoveText: {
    color: '#fecaca',
    fontSize: 12,
    fontWeight: '900',
  },
  recordingThumbnailUrlInput: {
    marginBottom: 0,
  },
  recordingThumbnailHelperText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 9,
  },
  recordingEditorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  messagesIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0F62FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#8A2BE2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  messagesEyebrow: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  messagesTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '900',
  },
  messagesBody: {
    color: '#4B5563',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  savedSection: {
    width: '100%',
    marginTop: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    padding: 14,
  },
  settingsSummaryCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#F8FBFF',
    padding: 14,
    marginBottom: 12,
  },
  settingsSummaryTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
  },
  settingsSummaryBody: {
    marginTop: 5,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  accountHealthCard: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  accountHealthHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  accountHealthEyebrow: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  accountHealthTitle: {
    marginTop: 3,
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '900',
  },
  accountHealthStatus: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  accountHealthStatusText: {
    fontSize: 12,
    fontWeight: '900',
  },
  trustMeterTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
  },
  trustMeterFill: {
    height: '100%',
    borderRadius: 999,
  },
  accountHealthStats: {
    flexDirection: 'row',
    gap: 8,
  },
  accountHealthStat: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 10,
  },
  accountHealthStatValue: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '900',
  },
  accountHealthStatLabel: {
    marginTop: 3,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
  },
  recoveryPanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a8a',
    backgroundColor: '#082f49',
    padding: 10,
    gap: 5,
  },
  recoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recoveryText: {
    flex: 1,
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '900',
  },
  recoveryMeta: {
    color: '#bae6fd',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  accountHealthTip: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  accountHealthList: {
    gap: 8,
  },
  accountHealthListTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
  },
  accountHealthItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    padding: 10,
  },
  accountHealthItemTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
  },
  accountHealthItemMeta: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  savedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  savedTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '900',
  },
  savedSubtitle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  savedCollectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  savedCollectionPill: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 138,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  savedCollectionPillActive: {
    borderColor: '#0F62FE',
    backgroundColor: '#eff6ff',
  },
  savedCollectionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
  savedCollectionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  savedCollectionLabel: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '900',
  },
  savedCollectionDescription: {
    marginTop: 1,
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  savedList: {
    gap: 10,
  },
  savedPostCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  savedPostTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  savedPostAuthor: {
    color: '#0F62FE',
    fontSize: 12,
    fontWeight: '900',
  },
  savedPostTime: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  savedPostText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  savedPostMetaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  savedPostMeta: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  savedEmptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
  },
  savedEmptyText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
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
  editButtonTextRTL: {
    marginLeft: 0,
    marginRight: 8,
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
  logoutButtonTextRTL: {
    marginLeft: 0,
    marginRight: 8,
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
