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

export default function CreatePostScreen() {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [webImageFile, setWebImageFile] = useState<File | null>(null);
  const [webVideoFile, setWebVideoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { token } = useAuth();
  const { t, isRTL } = useI18n();
  const router = useRouter();

  const pickMedia = async (kind: 'image' | 'video') => {
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = kind === 'video' ? 'video/*' : 'image/*';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          if (kind === 'video') {
            setWebVideoFile(file);
            setWebImageFile(null);
            setVideo(URL.createObjectURL(file));
            setImage(null);
          } else {
            setWebImageFile(file);
            setWebVideoFile(null);
            setImage(URL.createObjectURL(file));
            setVideo(null);
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
        } else {
          setWebVideoFile(null);
          setVideo(null);
          setImage(result.assets[0].uri);
        }
      }
    } catch (error) {
      console.error('Error picking media:', error);
      Alert.alert(t('error'), t('createImagePickFailed'));
    }
  };

  const handlePost = async () => {
    if (!text.trim() && !image && !video) {
      Alert.alert(t('error'), t('createAddTextOrImage'));
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('text', text.trim());

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

      const response = await fetch(apiUrl('/posts'), {
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
        setImage(null);
        setVideo(null);
        setWebImageFile(null);
        setWebVideoFile(null);
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
    }
  };

  const showImageOptions = () => {
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

          {image && (
            <View style={styles.imageContainer}>
              <Image source={{ uri: image }} style={styles.selectedImage} />
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={() => {
                  setImage(null);
                  setWebImageFile(null);
                }}
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
              <View style={{ flex: 1 }}>
                <Text style={styles.videoTitle}>{t('createVideoSelected')}</Text>
                <Text style={styles.videoSub}>{video}</Text>
              </View>
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={() => {
                  setVideo(null);
                  setWebVideoFile(null);
                }}
              >
                <Ionicons name="close-circle" size={32} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

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
  imageContainer: {
    position: 'relative',
    marginBottom: 16,
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
    height: 250,
    borderRadius: 12,
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
});
