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

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const API_BASE = `${EXPO_PUBLIC_BACKEND_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`;

export default function CreatePostScreen() {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [webImageFile, setWebImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { token } = useAuth();
  const router = useRouter();

  const pickImage = async (useCamera: boolean) => {
    try {
      if (Platform.OS === 'web') {
        if (useCamera) {
          Alert.alert('Huom', 'Webissä valitaan kuva tiedostosta.');
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          setWebImageFile(file);
          setImage(URL.createObjectURL(file));
        };
        input.click();
        return;
      }

      let result;
      
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Lupa vaaditaan', 'Kameran käyttöoikeus vaaditaan');
          return;
        }
        
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.7,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Lupa vaaditaan', 'Gallerian käyttöoikeus vaaditaan');
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
        setWebImageFile(null);
        setImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Virhe', 'Kuvan valinta epäonnistui');
    }
  };

  const handlePost = async () => {
    if (!text.trim() && !image) {
      Alert.alert('Virhe', 'Lisää tekstiä tai kuva');
      return;
    }
    if (!EXPO_PUBLIC_BACKEND_URL || !/^https?:\/\//i.test(EXPO_PUBLIC_BACKEND_URL)) {
      Alert.alert('Virhe', 'Backend URL puuttuu tai on virheellinen (.env: EXPO_PUBLIC_BACKEND_URL)');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('text', text.trim());

      if (image) {
        if (Platform.OS === 'web' && webImageFile) {
          formData.append('image', webImageFile, webImageFile.name || 'photo.jpg');
        } else {
        // Resize / compress the image before upload to avoid large payloads
          let uploadUri = image;
          try {
            const MAX_WIDTH = 1280;
            const compressQuality = 0.7;
            const manipResult = await ImageManipulator.manipulateAsync(
              image,
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

      const response = await fetch(`${API_BASE}/posts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-Tunnel-Skip-Bypassing-Warning': 'true',
        },
        body: formData,
      });

      if (response.ok) {
        Alert.alert('Onnistui!', 'Julkaisu luotu');
        setText('');
        setImage(null);
        setWebImageFile(null);
        router.push('/(tabs)/feed');
      } else {
        const raw = await response.text();
        let detail = 'Julkaisun luonti epäonnistui';
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.detail || detail;
        } catch {
          if (raw) detail = `Palvelinvirhe (${response.status})`;
        }
        Alert.alert('Virhe', detail);
      }
    } catch (error) {
      console.error('Error creating post:', error);
      Alert.alert('Virhe', 'Julkaisun luonti epäonnistui');
    } finally {
      setLoading(false);
    }
  };

  const showImageOptions = () => {
    Alert.alert(
      'Valitse kuva',
      'Mistä haluat valita kuvan?',
      [
        {
          text: 'Kamera',
          onPress: () => pickImage(true),
        },
        {
          text: 'Galleria',
          onPress: () => pickImage(false),
        },
        {
          text: 'Peruuta',
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
          <Text style={styles.label}>Mitä sinulla on mielessä?</Text>
          
          <TextInput
            style={styles.textInput}
            placeholder="Kirjoita jotain..."
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

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.imageButton}
              onPress={showImageOptions}
            >
              <Ionicons name="image-outline" size={24} color="#007AFF" />
              <Text style={styles.imageButtonText}>Lisää kuva</Text>
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
              <Text style={styles.postButtonText}>Julkaise</Text>
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
  imageButtonText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
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
