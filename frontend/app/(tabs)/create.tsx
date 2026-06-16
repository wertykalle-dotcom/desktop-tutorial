import React, { useState } from 'react';
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

  const applyWebImageFile = (file: File) => {
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
  };

  const applyWebVideoFile = (file: File) => {
    if (!isAllowedVideoFile(file)) {
      Alert.alert(t('error'), t('createUnsupportedVideo'));
      return;
    }
    setWebVideoFile(file);
    setWebImageFile(null);
    setImage(null);
    setVideo(URL.createObjectURL(file));
    setSelectedFileName(file.name);
  };

  const handleDroppedFiles = (files?: FileList | null) => {
    if (!files?.length) return;
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
  };

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
        <View style={styles.content}>
          <Text style={styles.label}>{t('createTitle')}</Text>
          
          <TextInput
            style={styles.textInput}
            placeholder={t('createPlaceholder')}
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
            <Ionicons name="stats-chart-outline" size={22} color={pollEnabled ? '#fff' : '#0F62FE'} />
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
                value={pollQuestion}
                onChangeText={setPollQuestion}
              />
              {pollOptions.map((option, index) => (
                <TextInput
                  key={`poll-option-${index}`}
                  style={styles.pollOptionInput}
                  placeholder={`Vaihtoehto ${index + 1}`}
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
                  <Ionicons name="add" size={18} color="#0F62FE" />
                  <Text style={styles.addPollOptionText}>Lisää vaihtoehto</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {Platform.OS === 'web' ? (
            <View
              style={[styles.dropZone, dragActive && styles.dropZoneActive]}
              // @ts-ignore - react-native-web passes DOM drag events through.
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              // @ts-ignore - react-native-web passes DOM drag events through.
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              // @ts-ignore - react-native-web passes DOM drop events through.
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                handleDroppedFiles(event.dataTransfer?.files);
              }}
            >
              <Ionicons name="cloud-upload-outline" size={28} color={dragActive ? '#007AFF' : '#64748b'} />
              <Text style={styles.dropZoneTitle}>{t('createDropMediaTitle')}</Text>
              <Text style={styles.dropZoneText}>{t('createDropMediaBody')}</Text>
            </View>
          ) : null}

          {image && (
            <View style={styles.imageContainer}>
              <Image source={{ uri: image }} style={styles.selectedImage} resizeMode="contain" />
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={resetMedia}
              >
                <Ionicons name="close-circle" size={32} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {video && !image && (
            <View style={styles.videoContainer}>
              <View style={styles.videoPreview}>
                <Ionicons name="videocam" size={26} color="#fff" />
              </View>
              <View style={styles.videoCopy}>
                <Text style={styles.videoTitle}>{t('createVideoSelected')}</Text>
                <Text style={styles.videoSub}>{selectedFileName || video}</Text>
              </View>
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={resetMedia}
              >
                <Ionicons name="close-circle" size={32} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {selectedFileName ? (
            <Text style={styles.selectedFileName}>{selectedFileName}</Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.imageButton, isRTL && styles.rowReverse]}
              onPress={showImageOptions}
            >
              <Ionicons name="image-outline" size={24} color="#007AFF" />
              <Text style={[styles.imageButtonText, isRTL && styles.imageButtonTextRTL]}>{t('createAddImage')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.imageButton, isRTL && styles.rowReverse]}
              onPress={async () => pickMedia('video')}
            >
              <Ionicons name="videocam-outline" size={24} color="#7c3aed" />
              <Text style={[styles.imageButtonText, styles.videoButtonText, isRTL && styles.imageButtonTextRTL]}>{t('createAddVideo')}</Text>
            </TouchableOpacity>
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
  content: {
    padding: 16,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 120,
    color: '#000',
    marginBottom: 16,
  },
  pollToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  pollToggleActive: {
    backgroundColor: '#0F62FE',
    borderColor: '#0F62FE',
  },
  pollToggleText: {
    color: '#0F62FE',
    fontSize: 15,
    fontWeight: '800',
  },
  pollToggleTextActive: {
    color: '#fff',
  },
  pollBuilder: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginBottom: 16,
  },
  pollBuilderTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  pollQuestionInput: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
    fontSize: 14,
  },
  pollOptionInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#111827',
    fontSize: 14,
  },
  addPollOptionButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#eaf3ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addPollOptionText: {
    color: '#0F62FE',
    fontWeight: '900',
  },
  dropZone: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    padding: 18,
    marginBottom: 16,
  },
  dropZoneActive: {
    borderColor: '#007AFF',
    backgroundColor: '#eff6ff',
  },
  dropZoneTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  dropZoneText: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748b',
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
    marginBottom: 16,
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
    marginBottom: 24,
    gap: 10,
  },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  imageButtonText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  imageButtonTextRTL: {
    marginLeft: 0,
    marginRight: 8,
  },
  videoButtonText: {
    color: '#7c3aed',
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
