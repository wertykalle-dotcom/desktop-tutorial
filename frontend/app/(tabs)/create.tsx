import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useI18n } from '../../src/contexts/I18nContext';
import { apiUrl } from '../../src/utils/api/http';

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';
const VIDEO_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm';

const getFileExtension = (name: string) => {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
};

const isAllowedImageFile = (file: File) =>
  ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(getFileExtension(file.name)) ||
  ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type);

const isAllowedVideoFile = (file: File) =>
  ['.mp4', '.mov', '.webm'].includes(getFileExtension(file.name)) ||
  ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type);

export default function CreatePostScreen() {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [webImageFile, setWebImageFile] = useState<File | null>(null);
  const [webVideoFile, setWebVideoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const { token } = useAuth();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktopCreate = width >= 980;
  const hasMedia = Boolean(image || video);
  const hasReadyText = Boolean(text.trim());
  const hasValidPoll = pollEnabled && Boolean(pollQuestion.trim()) && pollOptions.map((option) => option.trim()).filter(Boolean).length >= 2;

  const resetMedia = () => {
    setImage(null);
    setVideo(null);
    setWebImageFile(null);
    setWebVideoFile(null);
    setSelectedFileName('');
    setUploadProgress(0);
  };

  const resetPoll = () => {
    setPollEnabled(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  };

  const applyWebImageFile = useCallback((file: File) => {
    if (!isAllowedImageFile(file)) {
      Alert.alert(t('error'), t('createUnsupportedImage'));
      return;
    }
    setWebImageFile(file);
    setWebVideoFile(null);
    setVideo(null);
    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImage(reader.result);
      }
    };
    reader.onerror = () => {
      Alert.alert(t('error'), t('createImagePickFailed'));
    };
    reader.readAsDataURL(file);
  }, [t]);

  const applyWebVideoFile = useCallback((file: File) => {
    if (!isAllowedVideoFile(file)) {
      Alert.alert(t('error'), t('createUnsupportedVideo'));
      return;
    }
    setWebVideoFile(file);
    setWebImageFile(null);
    setImage(null);
    setVideo(URL.createObjectURL(file));
    setSelectedFileName(file.name);
  }, [t]);

  const handleDroppedFiles = useCallback((files?: FileList | null) => {
    if (!files?.length) return;
    setDragActive(false);
    const file = files[0];
    if (isAllowedImageFile(file)) {
      applyWebImageFile(file);
      return;
    }
    if (isAllowedVideoFile(file)) {
      applyWebVideoFile(file);
      return;
    }
    Alert.alert(t('error'), t('createUnsupportedMedia'));
  }, [applyWebImageFile, applyWebVideoFile, t]);

  const pickWebMediaFile = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;
    input.onchange = () => handleDroppedFiles(input.files);
    input.click();
  }, [handleDroppedFiles]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const findDropZone = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('#create-media-dropzone') : null;

    const hasDraggedFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const handleWindowDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      setDragActive(Boolean(findDropZone(event.target)));
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      const droppedInsideZone = Boolean(findDropZone(event.target));
      setDragActive(false);
      if (droppedInsideZone) {
        handleDroppedFiles(event.dataTransfer?.files);
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [handleDroppedFiles]);

  const pickMedia = async (kind: 'image' | 'video') => {
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = kind === 'video' ? VIDEO_ACCEPT : IMAGE_ACCEPT;
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          if (kind === 'video') {
            applyWebVideoFile(file);
          } else {
            applyWebImageFile(file);
          }
        };
        input.click();
        return;
      }

      let result;

      if (kind === 'video') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t('createCameraPermissionTitle'), t('createGalleryPermissionBody'));
          return;
        }

        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'],
          quality: 0.7,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t('createCameraPermissionTitle'), t('createGalleryPermissionBody'));
          return;
        }

        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.7,
        });
      }

      if (!result.canceled && result.assets && result.assets[0] && result.assets[0].uri) {
        if (kind === 'video') {
          setWebImageFile(null);
          setImage(null);
          setVideo(result.assets[0].uri);
          setSelectedFileName(result.assets[0].uri.split('/').pop() || t('createVideoSelected'));
        } else {
          setWebVideoFile(null);
          setVideo(null);
          setImage(result.assets[0].uri);
          setSelectedFileName(result.assets[0].uri.split('/').pop() || t('createImageSelected'));
        }
      }
    } catch (error) {
      console.error('Error picking media:', error);
      Alert.alert(t('error'), t('createImagePickFailed'));
    }
  };

  const handlePost = async () => {
    const pollChoices = pollOptions.map((option) => option.trim()).filter(Boolean);
    const hasPoll = pollEnabled && pollQuestion.trim() && pollChoices.length >= 2;
    if (!text.trim() && !image && !video && !hasPoll) {
      Alert.alert(t('error'), t('createAddTextOrImage'));
      return;
    }
    if (pollEnabled && !hasPoll) {
      Alert.alert(t('error'), 'Lisää gallupiin kysymys ja vähintään kaksi vaihtoehtoa.');
      return;
    }
    setLoading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('text', text.trim());
      if (hasPoll) {
        formData.append('poll', JSON.stringify({
          question: pollQuestion.trim(),
          options: pollChoices.slice(0, 4),
        }));
      }

      if (image || video) {
        const mediaUri = video || image || '';
        if (!mediaUri) {
          throw new Error('Missing media URI');
        }
        if (Platform.OS === 'web' && webImageFile) {
          formData.append('image', webImageFile, webImageFile.name || 'photo.jpg');
        } else if (Platform.OS === 'web' && webVideoFile) {
          formData.append('video', webVideoFile, webVideoFile.name || 'video.mp4');
        } else {
          if (video) {
            const uriParts = mediaUri.split('/');
            let name = uriParts[uriParts.length - 1] || 'video.mp4';
            if (!name.match(/\.(mp4|mov|webm)$/i)) name = `${name}.mp4`;
            let type = 'video/mp4';
            if (name.toLowerCase().endsWith('.mov')) type = 'video/quicktime';
            if (name.toLowerCase().endsWith('.webm')) type = 'video/webm';
            // @ts-ignore - React Native FormData file
            formData.append('video', { uri: mediaUri, name, type });
          } else {
            // Resize / compress the image before upload to avoid large payloads
            let uploadUri = mediaUri;
            try {
              const MAX_WIDTH = 1280;
              const compressQuality = 0.7;
              const manipResult = await ImageManipulator.manipulateAsync(
                mediaUri,
                [{ resize: { width: MAX_WIDTH } }],
                { compress: compressQuality, format: ImageManipulator.SaveFormat.JPEG }
              );
              if (manipResult && manipResult.uri) {
                uploadUri = manipResult.uri;
              }
            } catch (err) {
              console.warn('Image manipulation failed, uploading original image', err);
            }

            const uriParts = uploadUri.split('/');
            let name = uriParts[uriParts.length - 1] || 'photo.jpg';
            if (!name.match(/\.(jpg|jpeg|png)$/i)) {
              name = `${name}.jpg`;
            }
            let type = 'image/jpeg';
            if (name.toLowerCase().endsWith('.png')) type = 'image/png';

            // @ts-ignore - React Native FormData file
            formData.append('image', { uri: uploadUri, name, type });
          }
        }
      }

      const response = Platform.OS === 'web'
        ? await new Promise<Response>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', apiUrl('/posts'));
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.setRequestHeader('X-Tunnel-Skip-Bypassing-Warning', 'true');
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                setUploadProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
              }
            };
            xhr.onload = () => {
              setUploadProgress(100);
              resolve(new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText }));
            };
            xhr.onerror = () => reject(new Error('Upload failed'));
            xhr.send(formData);
          })
        : await fetch(apiUrl('/posts'), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              'X-Tunnel-Skip-Bypassing-Warning': 'true',
            },
            body: formData,
          });

      if (response.ok) {
        Alert.alert(t('createSuccessTitle'), t('createSuccessBody'));
        setText('');
        resetPoll();
        resetMedia();
        router.push('/(tabs)/feed');
      } else {
        const raw = await response.text();
        let detail = t('createFailed');
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.detail || detail;
        } catch {
          if (raw) detail = `Palvelinvirhe (${response.status})`;
        }
        Alert.alert(t('error'), detail);
      }
    } catch (error) {
      console.error('Error creating post:', error);
      Alert.alert(t('error'), t('createFailed'));
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const showImageOptions = () => {
    if (Platform.OS === 'web') {
      void pickMedia('image');
      return;
    }

    Alert.alert(
      t('createChooseImage'),
      t('createChooseImagePrompt'),
      [
        {
          text: t('createCamera'),
          onPress: () => pickMedia('image'),
        },
        {
          text: t('createGallery'),
          onPress: () => pickMedia('image'),
        },
        {
          text: t('cancel'),
          style: 'cancel',
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        <View style={[styles.content, isDesktopCreate && styles.contentDesktop]}>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>YOSLA Studio</Text>
            <Text style={styles.heroTitle}>{t('createTitle')}</Text>
            <Text style={styles.heroBody}>Kirjoita julkaisu, lisää kuva tai video ja tarkista esikatselu ennen julkaisua.</Text>
          </View>

          <View style={[styles.createGrid, !isDesktopCreate && styles.createGridMobile]}>
            <View style={styles.composerPanel}>
              <Text style={styles.panelTitle}>Sisältö</Text>
              <TextInput
                style={styles.textInput}
                placeholder={t('createPlaceholder')}
                placeholderTextColor="#94a3b8"
                value={text}
                onChangeText={setText}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.pollToggle, pollEnabled && styles.pollToggleActive, isRTL && styles.rowReverse]}
                onPress={() => setPollEnabled((current) => !current)}
              >
                <Ionicons name="stats-chart-outline" size={22} color={pollEnabled ? '#fff' : '#60a5fa'} />
                <Text style={[styles.pollToggleText, pollEnabled && styles.pollToggleTextActive]}>
                  Lisää gallup / äänestys
                </Text>
              </TouchableOpacity>

              {pollEnabled ? (
                <View style={styles.pollBuilder}>
                  <Text style={styles.pollBuilderTitle}>Gallup</Text>
                  <TextInput
                    style={styles.pollQuestionInput}
                    placeholder="Mitä haluat kysyä?"
                    placeholderTextColor="#94a3b8"
                    value={pollQuestion}
                    onChangeText={setPollQuestion}
                  />
                  {pollOptions.map((option, index) => (
                    <TextInput
                      key={`poll-option-${index}`}
                      style={styles.pollOptionInput}
                      placeholder={`Vaihtoehto ${index + 1}`}
                      placeholderTextColor="#94a3b8"
                      value={option}
                      onChangeText={(value) =>
                        setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))
                      }
                    />
                  ))}
                  {pollOptions.length < 4 ? (
                    <TouchableOpacity
                      style={styles.addPollOptionButton}
                      onPress={() => setPollOptions((current) => [...current, ''])}
                    >
                      <Ionicons name="add" size={18} color="#60a5fa" />
                      <Text style={styles.addPollOptionText}>Lisää vaihtoehto</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {Platform.OS === 'web' ? (
                <View
                  nativeID="create-media-dropzone"
                  style={[styles.dropZone, dragActive && styles.dropZoneActive]}
                  // @ts-ignore - react-native-web passes DOM drag events through.
                  onDragEnter={(event) => {
                    event.preventDefault();
                    event.stopPropagation?.();
                    setDragActive(true);
                  }}
                  // @ts-ignore - react-native-web passes DOM drag events through.
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation?.();
                    setDragActive(true);
                  }}
                  // @ts-ignore - react-native-web passes DOM drag events through.
                  onDragLeave={(event) => {
                    event.preventDefault();
                    event.stopPropagation?.();
                    setDragActive(false);
                  }}
                  // @ts-ignore - react-native-web passes DOM drop events through.
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation?.();
                    setDragActive(false);
                    handleDroppedFiles(event.dataTransfer?.files);
                  }}
                >
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={styles.dropZoneButton}
                    onPress={pickWebMediaFile}
                  >
                    <Ionicons name="cloud-upload-outline" size={28} color={dragActive ? '#60a5fa' : '#94a3b8'} />
                    <Text style={styles.dropZoneTitle}>{t('createDropMediaTitle')}</Text>
                    <Text style={styles.dropZoneText}>{t('createDropMediaBody')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.imageButton, isRTL && styles.rowReverse]}
                  onPress={showImageOptions}
                >
                  <Ionicons name="image-outline" size={22} color="#60a5fa" />
                  <Text style={[styles.imageButtonText, isRTL && styles.imageButtonTextRTL]}>{t('createAddImage')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.imageButton, isRTL && styles.rowReverse]}
                  onPress={async () => pickMedia('video')}
                >
                  <Ionicons name="videocam-outline" size={22} color="#c4b5fd" />
                  <Text style={[styles.imageButtonText, styles.videoButtonText, isRTL && styles.imageButtonTextRTL]}>{t('createAddVideo')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.previewPanel}>
              <View style={styles.previewHeader}>
                <Text style={styles.previewTitle}>Esikatselu</Text>
                <Text style={styles.previewBadge}>Preview</Text>
              </View>
              <View style={styles.previewCard}>
                <View style={styles.previewAuthorRow}>
                  <View style={styles.previewAvatar}>
                    <Ionicons name="person" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.previewAuthor}>YOSLA julkaisu</Text>
                    <Text style={styles.previewMeta}>Näkyy syötteessä ja profiilissa</Text>
                  </View>
                </View>
                <Text style={[styles.previewText, !hasReadyText && styles.previewPlaceholder]} numberOfLines={4}>
                  {hasReadyText ? text.trim() : 'Kirjoita julkaisu vasemmalle nähdäksesi esikatselun.'}
                </Text>
                {image ? (
                  <View style={styles.imageContainer}>
                    <Image source={{ uri: image }} style={styles.selectedImage} resizeMode="contain" />
                    <TouchableOpacity style={styles.removeImageButton} onPress={resetMedia}>
                      <Ionicons name="close-circle" size={32} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : null}
                {video && !image ? (
                  <View style={styles.videoContainer}>
                    <View style={styles.videoPreview}>
                      <Ionicons name="videocam" size={26} color="#fff" />
                    </View>
                    <View style={styles.videoCopy}>
                      <Text style={styles.videoTitle}>{t('createVideoSelected')}</Text>
                      <Text style={styles.videoSub}>{selectedFileName || video}</Text>
                    </View>
                    <TouchableOpacity style={styles.removeImageButton} onPress={resetMedia}>
                      <Ionicons name="close-circle" size={32} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : null}
                {selectedFileName ? (
                  <Text style={styles.selectedFileName}>{selectedFileName}</Text>
                ) : null}
              </View>

              <View style={styles.publishChecklist}>
                <View style={styles.checkRow}>
                  <Ionicons name={hasReadyText ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={hasReadyText ? '#22c55e' : '#64748b'} />
                  <Text style={styles.checkText}>Teksti {text.length}/500</Text>
                </View>
                <View style={styles.checkRow}>
                  <Ionicons name={hasMedia ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={hasMedia ? '#22c55e' : '#64748b'} />
                  <Text style={styles.checkText}>Kuva tai video</Text>
                </View>
                <View style={styles.checkRow}>
                  <Ionicons name={hasValidPoll ? 'checkmark-circle' : pollEnabled ? 'alert-circle' : 'ellipse-outline'} size={17} color={hasValidPoll ? '#22c55e' : pollEnabled ? '#f59e0b' : '#64748b'} />
                  <Text style={styles.checkText}>Gallup {pollEnabled ? 'käytössä' : 'ei käytössä'}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.postButton, loading && styles.postButtonDisabled]}
                onPress={handlePost}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.postButtonText}>{t('createPublish')}</Text>
                )}
              </TouchableOpacity>
              {loading ? (
                <View style={styles.progressWrap}>
                  <View style={[styles.progressBar, { width: `${Math.max(uploadProgress, 8)}%` }]} />
                  <Text style={styles.progressText}>{uploadProgress > 0 ? `${uploadProgress}%` : t('loading')}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    padding: 16,
    gap: 16,
  },
  contentDesktop: {
    padding: 24,
  },
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.24)',
    backgroundColor: '#07111f',
    padding: 18,
    shadowColor: '#0f62fe',
    shadowOpacity: 0.13,
    shadowRadius: 18,
  },
  heroKicker: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '900',
  },
  heroBody: {
    marginTop: 8,
    maxWidth: 760,
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  createGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
  },
  createGridMobile: {
    flexDirection: 'column',
  },
  composerPanel: {
    flex: 1.45,
    minWidth: 0,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07111f',
    padding: 16,
    gap: 14,
  },
  previewPanel: {
    flex: 0.95,
    minWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dbe4f0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  panelTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '900' },
  previewTitle: { color: '#0f172a', fontSize: 17, fontWeight: '900' },
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#243244',
    padding: 16,
    fontSize: 16,
    minHeight: 180,
    color: '#f8fafc',
    lineHeight: 23,
  },
  pollToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: 'rgba(37,99,235,0.14)',
    borderRadius: 12,
    padding: 12,
  },
  pollToggleActive: {
    backgroundColor: '#0F62FE',
    borderColor: '#0F62FE',
  },
  pollToggleText: {
    color: '#bfdbfe',
    fontSize: 15,
    fontWeight: '800',
  },
  pollToggleTextActive: {
    color: '#fff',
  },
  pollBuilder: {
    borderWidth: 1,
    borderColor: '#243244',
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  pollBuilderTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
  },
  pollQuestionInput: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
  },
  pollOptionInput: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#f8fafc',
    fontSize: 14,
  },
  addPollOptionButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(96,165,250,0.13)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addPollOptionText: {
    color: '#bfdbfe',
    fontWeight: '900',
  },
  dropZone: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    padding: 18,
  },
  dropZoneActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#082f49',
  },
  dropZoneButton: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropZoneTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '800',
    color: '#f8fafc',
  },
  dropZoneText: {
    marginTop: 4,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  imageContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  videoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    padding: 12,
    position: 'relative',
  },
  videoPreview: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoCopy: {
    flex: 1,
    minWidth: 0,
  },
  videoTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4c1d95',
  },
  videoSub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  selectedImage: {
    width: '100%',
    maxWidth: '100%',
    height: Platform.OS === 'web' ? 320 : 250,
    borderRadius: 12,
    objectFit: 'contain' as any,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 16,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageButton: {
    flexGrow: 1,
    minWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#243244',
    borderRadius: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  imageButtonText: {
    fontSize: 16,
    color: '#bfdbfe',
    marginLeft: 8,
    fontWeight: '900',
  },
  imageButtonTextRTL: {
    marginLeft: 0,
    marginRight: 8,
  },
  videoButtonText: {
    color: '#ddd6fe',
  },
  postButton: {
    backgroundColor: '#007AFF',
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postButtonDisabled: {
    opacity: 0.6,
  },
  postButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  selectedFileName: {
    color: '#475569',
    fontSize: 12,
    marginTop: -6,
    marginBottom: 14,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  previewBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#eff6ff',
    color: '#0F62FE',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  previewCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 14,
    gap: 12,
  },
  previewAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#0F62FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewAuthor: { color: '#0f172a', fontSize: 14, fontWeight: '900' },
  previewMeta: { color: '#64748b', fontSize: 12, fontWeight: '700', marginTop: 2 },
  previewText: { color: '#0f172a', fontSize: 15, lineHeight: 21, fontWeight: '800' },
  previewPlaceholder: { color: '#94a3b8' },
  publishChecklist: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 12,
    gap: 9,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { color: '#334155', fontSize: 13, fontWeight: '800' },
  progressWrap: {
    height: 24,
    marginTop: 12,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#007AFF',
  },
  progressText: {
    textAlign: 'center',
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
});
