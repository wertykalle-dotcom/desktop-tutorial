import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { useLocalSearchParams } from 'expo-router';
import { liveSignalingSocket } from '../../src/realtime/live-signaling';
import { useApiClient } from '../../src/hooks/useApiClient';
import { apiUrl, buildApiHeaders } from '../../src/utils/api/http';

const liveHosts = [
  { id: 'live_1', name: 'YOSLA', topic: '#Luonto', viewers: 128 },
  { id: 'live_2', name: 'Studio FI', topic: '#build', viewers: 74 },
  { id: 'live_3', name: 'Creator Lab', topic: '#design', viewers: 51 },
  { id: 'live_4', name: 'Yhteisöilta', topic: '#community', viewers: 39 },
];

type LiveHost = typeof liveHosts[number];

const chatSpeedInterval = 4000;
const LIVE_REPLAY_MAX_MS = 25 * 60 * 1000;

type LiveChatMessage = {
  id: string;
  author: string;
  text: string;
  mine?: boolean;
  upvotes?: number;
};

type BroadcastStatus = 'idle' | 'camera-ready' | 'connecting' | 'connected';
type VideoQuality = '720p' | '1080p';
type RecordingSaveStatus = 'idle' | 'recording' | 'processing' | 'uploading' | 'saved' | 'failed';

type LiveSessionDescriptionPayload = {
  roomId?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
};

type LiveIceCandidatePayload = {
  roomId?: string;
  candidate?: RTCIceCandidateInit;
};

type LiveGiftBadge = {
  badgeType: string;
  title: string;
  priceLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  featured?: boolean;
};

type LiveGiftPayload = {
  roomId?: string;
  badgeType?: string;
  username?: string;
};

type LiveViewerCountPayload = {
  roomId?: string;
  count?: number;
  type?: string;
};

type VideoReadyPayload = {
  postId?: string;
  status?: 'processing' | 'ready' | 'failed';
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  post?: LiveRecordingItem;
};

type LiveGiftToast = LiveGiftPayload & {
  id: string;
};

type MediaDeviceOption = {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
};

type LiveRecordingItem = {
  post_id: string;
  title?: string | null;
  text?: string;
  video?: string | null;
  videoUrl?: string | null;
  duration?: number | null;
  created_at?: string;
};

const broadcastStatusLabels: Record<BroadcastStatus, string> = {
  idle: 'Valmiina',
  'camera-ready': 'Kamera valmis',
  connecting: 'Yhdistetään...',
  connected: 'Yhteydessä',
};

const recordingSaveStatusLabels: Record<RecordingSaveStatus, string> = {
  idle: 'Valmiina tallentamaan',
  recording: 'Tallennetaan...',
  processing: 'Käsitellään tallennetta...',
  uploading: 'Lähetetään...',
  saved: 'Tallenne valmis',
  failed: 'Tallennusvirhe - tarkka syy alla',
};

const formatLiveDuration = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const nativeSelectStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 38,
  borderRadius: 10,
  border: '1px solid #475569',
  backgroundColor: '#020617',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  padding: '8px 10px',
};

const getVideoConstraints = (deviceId: string, quality: VideoQuality): MediaTrackConstraints => {
  const dimensions = quality === '1080p'
    ? { width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 } };
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...dimensions,
    frameRate: { ideal: 30, max: 30 },
  };
};

const getAudioConstraints = (deviceId: string): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});

const getTrackDiagnostics = (stream: MediaStream | null) => {
  if (!stream) return { videoTracks: [], audioTracks: [] };
  const describeTrack = (track: MediaStreamTrack) => ({
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings: typeof track.getSettings === 'function' ? track.getSettings() : null,
    constraints: typeof track.getConstraints === 'function' ? track.getConstraints() : null,
  });
  return {
    videoTracks: stream.getVideoTracks().map(describeTrack),
    audioTracks: stream.getAudioTracks().map(describeTrack),
  };
};

const getReplayRecorderOptions = (mimeType: string, quality: VideoQuality): MediaRecorderOptions => ({
  mimeType,
  videoBitsPerSecond: quality === '1080p' ? 3_200_000 : 2_500_000,
  audioBitsPerSecond: 128_000,
});

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const LIVE_RECORDING_CHUNK_THRESHOLD_BYTES = 8 * 1024 * 1024;
const LIVE_RECORDING_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const LIVE_RECORDING_CHUNK_MAX_RETRIES = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const giftBadges: LiveGiftBadge[] = [
  { badgeType: 'cheer', title: 'Tsemppi-emoji', priceLabel: '50 YOSLA-pistettä', icon: 'happy', color: '#22c55e' },
  { badgeType: 'cookie', title: 'YOSLA-Keksi', priceLabel: '0.49 €', icon: 'cafe', color: '#f59e0b' },
  { badgeType: 'flame', title: 'Liekeissä', priceLabel: '1.99 €', icon: 'flame', color: '#ef4444' },
  { badgeType: 'token', title: 'YOSLA-Pelimerkit', priceLabel: '100 YOSLA-pistettä', icon: 'game-controller', color: '#06b6d4' },
  { badgeType: 'star', title: 'Tähtimerkki', priceLabel: '250 YOSLA-pistettä', icon: 'star', color: '#facc15' },
  { badgeType: 'trophy', title: 'Kulta-Pokaali', priceLabel: '4.99 €', icon: 'trophy', color: '#eab308' },
  { badgeType: 'boost', title: 'Voima-Boost', priceLabel: '14.99 €', icon: 'flash', color: '#c026d3' },
  { badgeType: 'diamond', title: 'Timantti-Lahja', priceLabel: '24.99 €', icon: 'diamond', color: '#67e8f9' },
  { badgeType: 'king', title: 'Kuninkaan Merkki', priceLabel: '29.99 € tai 1500 YOSLA-pistettä', icon: 'ribbon', color: '#f97316' },
  { badgeType: 'master', title: 'YOSLA SOME LIFE Mestarilahja', priceLabel: '39.99 € tai 2000 YOSLA-pistettä', icon: 'shield-checkmark', color: '#cbd5e1', featured: true },
];

const liveChatSeed: LiveChatMessage[] = [
  { id: 'seed_1', author: 'mira', text: 'Mahtava aihe!' },
  { id: 'seed_2', author: 'arto', text: 'Kysymys hostille...' },
  { id: 'seed_3', author: 'sanna', text: 'Tämä näyttää hyvältä.' },
  { id: 'seed_4', author: 'toni', text: 'Voiko tästä tehdä Q&A:n?' },
  { id: 'seed_5', author: 'leena', text: '🔥🔥🔥' },
];

export default function LiveScreen() {
  const { user, token } = useAuth();
  const { apiFetch } = useApiClient();
  const params = useLocalSearchParams<{ hostId?: string | string[]; roomId?: string | string[]; topic?: string | string[] }>();
  const initialHostId = Array.isArray(params.hostId) ? params.hostId[0] : params.hostId;
  const initialRoomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const initialTopic = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  const { width } = useWindowDimensions();
  const [activeHost, setActiveHost] = useState<LiveHost | null>(null);
  const [messages, setMessages] = useState(liveChatSeed.slice(0, 2));
  const [chatDraft, setChatDraft] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [highlightedQuestions, setHighlightedQuestions] = useState<LiveChatMessage[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [broadcastStatus, setBroadcastStatus] = useState<BroadcastStatus>('idle');
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceOption[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState('');
  const [selectedVideoQuality, setSelectedVideoQuality] = useState<VideoQuality>('720p');
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pinnedMessage, setPinnedMessage] = useState<LiveChatMessage | null>(null);
  const [streamQuestion, setStreamQuestion] = useState<LiveChatMessage | null>(null);
  const [blockedAuthors, setBlockedAuthors] = useState<string[]>([]);
  const [isGiftPanelOpen, setIsGiftPanelOpen] = useState(false);
  const [giftToasts, setGiftToasts] = useState<LiveGiftToast[]>([]);
  const [isReplayPublishing, setIsReplayPublishing] = useState(false);
  const [isReplayRecording, setIsReplayRecording] = useState(false);
  const [recordingSaveStatus, setRecordingSaveStatus] = useState<RecordingSaveStatus>('idle');
  const [recordingSaveMessage, setRecordingSaveMessage] = useState('');
  const [savedRecordings, setSavedRecordings] = useState<LiveRecordingItem[]>([]);
  const chatScrollRef = useRef<ScrollView | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const activeHostRef = useRef<LiveHost | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isStartingStreamRef = useRef(false);
  const qaPulse = useRef(new Animated.Value(0)).current;
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const replayChunksRef = useRef<Blob[]>([]);
  const replayMimeTypeRef = useRef('video/webm');
  const replayLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayDataPumpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayStartedAtRef = useRef<number | null>(null);
  const replayDurationSecondsRef = useRef(0);
  const replayStopPromiseRef = useRef<Promise<void> | null>(null);
  const replayStopResolverRef = useRef<(() => void) | null>(null);
  const shouldPublishReplayRef = useRef(true);
  const pendingReplayPostIdRef = useRef<string | null>(null);
  const isMobileLive = width < 760;
  const activeRoomId = activeHost?.id || '';

  useEffect(() => {
    console.log('LIVE RECORDING DEBUG BUILD V2');
  }, []);

  useEffect(() => {
    activeHostRef.current = activeHost;
  }, [activeHost]);

  const loadSavedRecordings = useCallback(async () => {
    try {
      const response = await apiFetch('/media/posts?limit=40');
      if (!response?.ok) return;
      const payload = await response.json();
      const recordings = Array.isArray(payload)
        ? payload.filter((post) => {
            const metadata = post as LiveRecordingItem & { type?: string | null; source?: string | null; user_id?: string };
            return (
              metadata.user_id === user?.user_id &&
              (metadata.type === 'live_recording' ||
                metadata.type === 'live_replay' ||
                metadata.source === 'live_recording' ||
                metadata.source === 'live_replay')
            );
          })
        : [];
      setSavedRecordings(recordings.slice(0, 6));
    } catch (error) {
      console.error('Live-tallenteiden haku epäonnistui:', error);
    }
  }, [apiFetch, user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      void loadSavedRecordings();
    }
  }, [loadSavedRecordings, user?.user_id]);

  useEffect(() => {
    if (initialRoomId) {
      const selectedHost = liveHosts.find((host) => host.id === initialRoomId);
      setActiveHost(selectedHost || {
        id: initialRoomId,
        name: initialRoomId === user?.user_id ? (user?.username || 'Oma live') : 'Live-lähetys',
        topic: initialTopic || '#YOSLA',
        viewers: 0,
      });
      return;
    }
    if (!initialHostId) return;
    const selectedHost = liveHosts.find((host) => host.id === initialHostId);
    if (selectedHost) {
      setActiveHost(selectedHost);
    }
  }, [initialHostId, initialRoomId, initialTopic, user?.user_id, user?.username]);

  useEffect(() => {
    if (!activeRoomId) {
      setMessages(liveChatSeed.slice(0, 2));
      setChatDraft('');
      setQuestionDraft('');
      setHighlightedQuestions([]);
      setPinnedMessage(null);
      setStreamQuestion(null);
      setBlockedAuthors([]);
      return undefined;
    }
    let index = 2;
    const intervalId = setInterval(() => {
      const seedMessage = liveChatSeed[index % liveChatSeed.length];
      setMessages((current) => [
        ...current.slice(-24),
        {
          ...seedMessage,
          id: `${seedMessage.id}_${Date.now()}`,
        },
      ]);
      index += 1;
    }, chatSpeedInterval);
    return () => clearInterval(intervalId);
  }, [activeRoomId]);

  useEffect(() => {
    if (!activeRoomId || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return undefined;
    }
    let cancelled = false;
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const mediaOptions = devices
          .filter((device) => device.kind === 'videoinput' || device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            kind: device.kind,
            label: device.label || (device.kind === 'videoinput' ? `Kamera ${index + 1}` : `Mikrofoni ${index + 1}`),
          }));
        setMediaDevices(mediaOptions);
        setSelectedVideoDeviceId((current) => current || mediaOptions.find((device) => device.kind === 'videoinput')?.deviceId || '');
        setSelectedAudioDeviceId((current) => current || mediaOptions.find((device) => device.kind === 'audioinput')?.deviceId || '');
      } catch (error) {
        console.error('Medialaitteiden haku epäonnistui:', error);
      }
    };
    loadDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', loadDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', loadDevices);
    };
  }, [activeRoomId]);

  useEffect(() => {
    if (!liveStartedAt) {
      setElapsedSeconds(0);
      return undefined;
    }
    const intervalId = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - liveStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [liveStartedAt]);

  useEffect(() => {
    if (!localStream || typeof window === 'undefined') {
      setAudioLevel(0);
      return undefined;
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) {
      setAudioLevel(0);
      return undefined;
    }

    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return undefined;

    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let animationFrame = 0;
    let lastMeterUpdate = 0;

    const updateLevel = () => {
      analyser.getByteFrequencyData(data);
      const now = performance.now();
      if (now - lastMeterUpdate > 120) {
        const average = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
        setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
        lastMeterUpdate = now;
      }
      animationFrame = requestAnimationFrame(updateLevel);
    };
    updateLevel();

    return () => {
      cancelAnimationFrame(animationFrame);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
    };
  }, [localStream]);

  useEffect(() => {
    if (!activeRoomId) return;
    const timeoutId = setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timeoutId);
  }, [activeRoomId, messages]);

  useEffect(() => {
    if (!giftToasts.length) return undefined;
    const timeoutId = setTimeout(() => {
      setGiftToasts((current) => current.slice(0, -1));
    }, 3600);
    return () => clearTimeout(timeoutId);
  }, [giftToasts]);

  useEffect(() => {
    if (!streamQuestion) {
      qaPulse.stopAnimation();
      qaPulse.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(qaPulse, { toValue: 1, duration: 720, useNativeDriver: true }),
        Animated.timing(qaPulse, { toValue: 0, duration: 720, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [qaPulse, streamQuestion]);

  useEffect(() => {
    localStreamRef.current = localStream;
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    return () => {
      peerConnectionRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (replayLimitTimerRef.current) clearTimeout(replayLimitTimerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const flushPendingIceCandidates = useCallback(async (connection: RTCPeerConnection) => {
    const pending = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    for (const candidate of pending) {
      try {
        await connection.addIceCandidate(candidate);
      } catch (error) {
        console.error('ICE-kandidaatin lisääminen epäonnistui:', error);
      }
    }
  }, []);

  const createPeerConnection = useCallback((roomId: string) => {
    peerConnectionRef.current?.close();
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        liveSignalingSocket.emit('live:ice-candidate', {
          roomId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStream(stream);
        setBroadcastStatus('connected');
      }
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') {
        setBroadcastStatus('connected');
      }
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        setBroadcastStatus('idle');
      }
    };
    peerConnectionRef.current = connection;
    return connection;
  }, []);

  useEffect(() => {
    if (!activeRoomId) return undefined;

    const currentRoomId = activeRoomId;
    liveSignalingSocket.emit('live:join', {
      roomId: currentRoomId,
      topic: activeHost?.topic || '#YOSLA',
      username: activeHost?.name || user?.username || 'Live',
      profilePicture: user?.profile_picture || null,
      isStreamer: currentRoomId === user?.user_id,
    });

    const handleReceiveOffer = async ({ offer }: LiveSessionDescriptionPayload) => {
      if (!offer) return;
      try {
        setBroadcastStatus('connecting');
        const connection = createPeerConnection(currentRoomId);
        connection.addTransceiver('video', { direction: 'recvonly' });
        connection.addTransceiver('audio', { direction: 'recvonly' });
        await connection.setRemoteDescription(offer);
        await flushPendingIceCandidates(connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        liveSignalingSocket.emit('live:send-answer', { roomId: currentRoomId, answer });
      } catch (error) {
        console.error('Automaattinen answer epäonnistui:', error);
        setBroadcastStatus('idle');
      }
    };

    const handleReceiveAnswer = async ({ answer }: LiveSessionDescriptionPayload) => {
      if (!answer || !peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(answer);
        await flushPendingIceCandidates(peerConnectionRef.current);
        setBroadcastStatus('connected');
      } catch (error) {
        console.error('Automaattinen answerin hyväksyntä epäonnistui:', error);
        setBroadcastStatus('idle');
      }
    };

    const handleIceCandidate = async ({ candidate }: LiveIceCandidatePayload) => {
      if (!candidate) return;
      const connection = peerConnectionRef.current;
      if (!connection?.remoteDescription) {
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await connection.addIceCandidate(candidate);
      } catch (error) {
        console.error('ICE-kandidaatin vastaanotto epäonnistui:', error);
      }
    };

    const handleReceiveGift = ({ badgeType, username }: LiveGiftPayload) => {
      if (!badgeType || !username) return;
      setGiftToasts((current) => [
        { id: `gift_${Date.now()}_${Math.random()}`, roomId: currentRoomId, badgeType, username },
        ...current.slice(0, 2),
      ]);
    };

    const handleViewerCount = ({ roomId, count }: LiveViewerCountPayload) => {
      if (roomId !== currentRoomId || typeof count !== 'number') return;
      setActiveHost((current) => current && current.id === currentRoomId ? { ...current, viewers: count } : current);
    };

    const handleVideoReady = ({ postId, status, videoUrl, post }: VideoReadyPayload) => {
      if (!postId || postId !== pendingReplayPostIdRef.current) return;
      console.info('[live-recording] VIDEO_READY received', {
        postId,
        status,
        videoUrl,
      });
      if (status === 'failed') {
        failLiveRecording(`Backend processing failed for ${postId}`);
        pendingReplayPostIdRef.current = null;
        return;
      }
      if (status === 'ready') {
        setRecordingSaveStatus('saved');
        setRecordingSaveMessage('Tallenne valmis ja julkaistu Mediavirtaan.');
        if (post) {
          setSavedRecordings((current) => {
            const withoutDuplicate = current.filter((item) => item.post_id !== post.post_id);
            return [post, ...withoutDuplicate].slice(0, 6);
          });
        }
        pendingReplayPostIdRef.current = null;
        void loadSavedRecordings();
      }
    };

    liveSignalingSocket.on<LiveSessionDescriptionPayload>('live:receive-offer', handleReceiveOffer);
    liveSignalingSocket.on<LiveSessionDescriptionPayload>('live:receive-answer', handleReceiveAnswer);
    liveSignalingSocket.on<LiveIceCandidatePayload>('live:ice-candidate', handleIceCandidate);
    liveSignalingSocket.on<LiveGiftPayload>('live:receive-gift', handleReceiveGift);
    liveSignalingSocket.on<LiveViewerCountPayload>('live:viewer-count-update', handleViewerCount);
    liveSignalingSocket.on<VideoReadyPayload>('VIDEO_READY', handleVideoReady);

    return () => {
      liveSignalingSocket.off<LiveSessionDescriptionPayload>('live:receive-offer', handleReceiveOffer);
      liveSignalingSocket.off<LiveSessionDescriptionPayload>('live:receive-answer', handleReceiveAnswer);
      liveSignalingSocket.off<LiveIceCandidatePayload>('live:ice-candidate', handleIceCandidate);
      liveSignalingSocket.off<LiveGiftPayload>('live:receive-gift', handleReceiveGift);
      liveSignalingSocket.off<LiveViewerCountPayload>('live:viewer-count-update', handleViewerCount);
      liveSignalingSocket.off<VideoReadyPayload>('VIDEO_READY', handleVideoReady);
      liveSignalingSocket.emit('live:leave', { roomId: currentRoomId });
    };
  }, [activeRoomId, activeHost?.name, activeHost?.topic, createPeerConnection, flushPendingIceCandidates, loadSavedRecordings, user?.profile_picture, user?.user_id, user?.username]);

  const getOrStartCamera = async () => {
    if (localStream) {
      console.info('[live-recording] using existing media stream', {
        selectedVideoQuality,
        requestedVideoConstraints: getVideoConstraints(selectedVideoDeviceId, selectedVideoQuality),
        ...getTrackDiagnostics(localStream),
      });
      return localStream;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Selain ei tue kameran ja mikrofonin avaamista tässä näkymässä.');
    }
    const requestedVideoConstraints = getVideoConstraints(selectedVideoDeviceId, selectedVideoQuality);
    const requestedAudioConstraints = getAudioConstraints(selectedAudioDeviceId);
    console.info('[live-recording] requesting media stream', {
      selectedVideoQuality,
      requestedVideoConstraints,
      requestedAudioConstraints,
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: requestedVideoConstraints,
      audio: requestedAudioConstraints,
    });
    setLocalStream(stream);
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
    console.info('[live-recording] media stream ready', {
      selectedVideoQuality,
      ...getTrackDiagnostics(stream),
    });
    return stream;
  };

  const getReplayMimeType = () => {
    if (typeof MediaRecorder === 'undefined') return 'video/webm';
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'video/webm';
  };

  const captureRecordingThumbnail = async (): Promise<Blob | null> => {
    const video = localVideoRef.current;
    if (!video || typeof document === 'undefined') return null;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
  };

  const readUploadError = async (response: Response) => {
    const fallback = `Upload failed: HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') return `Upload failed: ${payload.detail}`;
      if (Array.isArray(payload?.detail)) return `Upload failed: ${payload.detail.map((item) => item?.msg || JSON.stringify(item)).join(', ')}`;
      if (typeof payload?.message === 'string') return `Upload failed: ${payload.message}`;
      if (typeof payload?.error === 'string') return `Upload failed: ${payload.error}`;
      return `${fallback} ${JSON.stringify(payload)}`;
    } catch {
      try {
        const raw = await response.text();
        return raw ? `Upload failed: ${raw}` : fallback;
      } catch {
        return fallback;
      }
    }
  };

  const failLiveRecording = (message: string, details?: unknown) => {
    let serializedDetails = '';
    if (details && !(details instanceof Error) && typeof details !== 'string') {
      try {
        serializedDetails = JSON.stringify(details);
      } catch {
        serializedDetails = String(details);
      }
    }
    const detailText = typeof details === 'string'
      ? details
      : details instanceof Error
        ? details.message
        : serializedDetails;
    const fullMessage = detailText && !message.includes(detailText)
      ? `${message}: ${detailText}`
      : message;
    console.error('[live-recording] failed', { message: fullMessage, details });
    setRecordingSaveStatus('failed');
    setRecordingSaveMessage(fullMessage);
    Alert.alert('Live recording error', fullMessage);
  };

  const publishReplayToMediaFeed = async (host: LiveHost | null) => {
    console.log('[live-recording] SAVE START');
    console.info('[live-recording] save flow started', {
      hasHost: !!host,
      hostId: host?.id,
      hasUser: !!user,
      userId: user?.user_id,
      hasToken: !!token,
      chunkCount: replayChunksRef.current.length,
      mimeType: replayMimeTypeRef.current,
      selectedVideoQuality,
      ...getTrackDiagnostics(localStreamRef.current || localStream),
    });

    setIsReplayPublishing(true);
    try {
      if (!host) {
        console.error('[live-recording] early return: no active host');
        failLiveRecording('Save failed before upload: no active live host');
        return;
      }
      if (!user?.user_id) {
        console.error('[live-recording] early return: no user', { user });
        failLiveRecording('Save failed before upload: no user');
        return;
      }
      if (!token) {
        console.error('[live-recording] early return: no token');
        failLiveRecording('Save failed before upload: no token');
        return;
      }

      const recordedChunksSize = replayChunksRef.current.reduce((total, chunk) => total + chunk.size, 0);
      console.info('[live-recording] recordedChunks.length', replayChunksRef.current.length);
      console.info('[live-recording] recordedChunks.totalSize', recordedChunksSize);
      if (!replayChunksRef.current.length) {
        console.error('[live-recording] early return: no chunks');
        failLiveRecording('MediaRecorder error: recordedChunks.length is 0');
        return;
      }

      setRecordingSaveStatus('processing');
      console.info('[live-recording] creating Blob', {
        chunkCount: replayChunksRef.current.length,
        mimeType: replayMimeTypeRef.current || 'video/webm',
      });
      const blob = new Blob(replayChunksRef.current, { type: replayMimeTypeRef.current || 'video/webm' });
      console.info('[live-recording] Blob created', {
        size: blob.size,
        type: blob.type,
        recordedChunksSize,
        sizeMatchesChunks: blob.size === recordedChunksSize,
        selectedVideoQuality,
      });
      console.info('[live-recording] blob.size', blob.size);
      console.info('[live-recording] blob.type', blob.type);
      if (!blob.size) {
        console.error('[live-recording] early return: blob size 0', { type: blob.type });
        failLiveRecording(`Blob error: blob.size is 0, blob.type is ${blob.type || 'unknown'}`);
        return;
      }

      setRecordingSaveStatus('uploading');
      const dateLabel = new Date().toLocaleDateString('fi-FI');
      const duration = Math.min(replayDurationSecondsRef.current || 0, LIVE_REPLAY_MAX_MS / 1000);
      const title = `Tallenne: ${host.topic || 'YOSLA Live'} - ${dateLabel}`;
      const contentType = blob.type || 'video/webm';
      const recordingFilename = `live-recordings/${user.user_id}/${Date.now()}.webm`;
      console.info('[live-recording] creating File', {
        filename: recordingFilename,
        contentType,
        blobSize: blob.size,
        fileConstructorAvailable: typeof File !== 'undefined',
      });
      let recordingFile: Blob;
      try {
        recordingFile = typeof File !== 'undefined'
          ? new File([blob], recordingFilename, { type: contentType })
          : blob;
      } catch (fileError) {
        console.error('[live-recording] early return: file creation failed', fileError);
        failLiveRecording('File creation failed before upload', fileError);
        return;
      }
      console.info('[live-recording] File created', {
        filename: recordingFilename,
        size: recordingFile.size,
        type: recordingFile.type,
      });

      const shouldUseChunkedUpload =
        selectedVideoQuality === '1080p' ||
        recordingFile.size > LIVE_RECORDING_CHUNK_THRESHOLD_BYTES;
      console.info('[live-recording] preparing upload', {
        filename: recordingFilename,
        contentType,
        duration: Math.max(1, Math.round(duration)),
        authorId: user.user_id,
        uploadMode: shouldUseChunkedUpload ? 'chunked' : 'direct',
        uploadModeReason: selectedVideoQuality === '1080p'
          ? '1080p always uses chunked upload'
          : recordingFile.size > LIVE_RECORDING_CHUNK_THRESHOLD_BYTES
            ? `file exceeds ${formatBytes(LIVE_RECORDING_CHUNK_THRESHOLD_BYTES)}`
            : 'small 720p direct upload',
      });
      let thumbnailBlob: Blob | null = null;
      try {
        console.info('[live-recording] thumbnail capture started');
        thumbnailBlob = await captureRecordingThumbnail();
      } catch (thumbnailError) {
        console.warn('Live-tallenteen thumbnailia ei voitu kaapata:', thumbnailError);
      }

      let response: Response;
      if (shouldUseChunkedUpload) {
        const uploadId = `live_${user.user_id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const totalChunks = Math.ceil(recordingFile.size / LIVE_RECORDING_CHUNK_SIZE_BYTES);
        const chunkHeaders = buildApiHeaders(undefined, token);
        console.info('[live-recording] chunked upload started', {
          uploadId,
          totalChunks,
          chunkSize: LIVE_RECORDING_CHUNK_SIZE_BYTES,
          fileSize: recordingFile.size,
          fileSizeLabel: formatBytes(recordingFile.size),
        });
        for (let index = 0; index < totalChunks; index += 1) {
          const start = index * LIVE_RECORDING_CHUNK_SIZE_BYTES;
          const end = Math.min(recordingFile.size, start + LIVE_RECORDING_CHUNK_SIZE_BYTES);
          const chunkBlob = recordingFile.slice(start, end, contentType);
          const chunkForm = new FormData();
          chunkForm.append('upload_id', uploadId);
          chunkForm.append('index', String(index));
          chunkForm.append('total_chunks', String(totalChunks));
          chunkForm.append('chunk', chunkBlob, `${recordingFilename}.part${index}`);
          setRecordingSaveMessage(`Lähetetään 1080p-tallennetta paloissa ${index + 1}/${totalChunks}...`);
          console.info('[live-recording] uploading chunk', {
            uploadId,
            index,
            totalChunks,
            chunkSize: chunkBlob.size,
            chunkSizeLabel: formatBytes(chunkBlob.size),
          });
          let chunkResponse: Response | null = null;
          let lastChunkError: unknown = null;
          for (let attempt = 1; attempt <= LIVE_RECORDING_CHUNK_MAX_RETRIES; attempt += 1) {
            try {
              chunkResponse = await fetch(apiUrl('/live-recordings/chunks'), {
                method: 'POST',
                headers: chunkHeaders,
                body: chunkForm,
              });
              if (chunkResponse.ok) break;
              lastChunkError = await readUploadError(chunkResponse);
              console.warn('[live-recording] chunk upload response failed', {
                uploadId,
                index,
                totalChunks,
                attempt,
                status: chunkResponse.status,
                error: lastChunkError,
              });
            } catch (chunkError) {
              lastChunkError = chunkError;
              console.error('[live-recording] chunk upload failed before response', {
                uploadId,
                index,
                totalChunks,
                attempt,
                chunkSize: chunkBlob.size,
                error: chunkError,
              });
            }
            if (attempt < LIVE_RECORDING_CHUNK_MAX_RETRIES) {
              setRecordingSaveMessage(`Yritetään palaa ${index + 1}/${totalChunks} uudelleen (${attempt + 1}/${LIVE_RECORDING_CHUNK_MAX_RETRIES})...`);
              await wait(600 * attempt);
            }
          }
          if (!chunkResponse?.ok) {
            throw new Error(
              lastChunkError instanceof Error
                ? `Chunk upload failed: ${lastChunkError.name}: ${lastChunkError.message}. chunk=${index + 1}/${totalChunks}, chunk.size=${chunkBlob.size} (${formatBytes(chunkBlob.size)}), file.size=${recordingFile.size} (${formatBytes(recordingFile.size)})`
                : `Chunk upload failed: ${String(lastChunkError || 'unknown error')}. chunk=${index + 1}/${totalChunks}, chunk.size=${chunkBlob.size} (${formatBytes(chunkBlob.size)}), file.size=${recordingFile.size} (${formatBytes(recordingFile.size)})`
            );
          }
        }
        const completeForm = new FormData();
        completeForm.append('upload_id', uploadId);
        completeForm.append('total_chunks', String(totalChunks));
        completeForm.append('filename', recordingFilename);
        completeForm.append('content_type', contentType);
        completeForm.append('text', `${title}\n\nLive Recording`);
        completeForm.append('title', title);
        completeForm.append('duration', String(Math.max(1, Math.round(duration))));
        completeForm.append('visibility', 'public');
        completeForm.append('topic', host.topic || 'YOSLA Live');
        if (thumbnailBlob?.size) {
          completeForm.append('image', thumbnailBlob, `live-recording-${host.id}-${Date.now()}.jpg`);
          console.info('[live-recording] thumbnail appended', {
            size: thumbnailBlob.size,
            type: thumbnailBlob.type,
          });
        } else {
          console.info('[live-recording] thumbnail skipped: empty or unavailable');
        }
        setRecordingSaveMessage('Viimeistellään 1080p-tallennetta...');
        console.info('[live-recording] completing chunked upload', {
          uploadId,
          totalChunks,
          fileSize: recordingFile.size,
        });
        response = await fetch(apiUrl('/live-recordings/chunks/complete'), {
          method: 'POST',
          headers: chunkHeaders,
          body: completeForm,
        });
      } else {
        console.info('[live-recording] creating FormData');
        const formData = new FormData();
        formData.append('text', `${title}\n\nLive Recording`);
        formData.append('title', title);
        formData.append('type', 'live_recording');
        formData.append('is_clip', 'true');
        formData.append('source', 'live_recording');
        formData.append('duration', String(Math.max(1, Math.round(duration))));
        formData.append('visibility', 'public');
        formData.append('video', recordingFile, recordingFilename);
        if (thumbnailBlob?.size) {
          formData.append('image', thumbnailBlob, `live-recording-${host.id}-${Date.now()}.jpg`);
          console.info('[live-recording] thumbnail appended', {
            size: thumbnailBlob.size,
            type: thumbnailBlob.type,
          });
        } else {
          console.info('[live-recording] thumbnail skipped: empty or unavailable');
        }
        console.info('[live-recording] FormData created', {
          fields: ['text', 'title', 'type', 'is_clip', 'source', 'duration', 'visibility', 'video'],
          filename: recordingFilename,
          videoSize: recordingFile.size,
          videoType: recordingFile.type,
        });
        const uploadUrl = apiUrl('/posts');
        const uploadHeaders = buildApiHeaders(undefined, token);
        console.info('[live-recording] before direct fetch /posts', {
          uploadUrl,
          headerKeys: Object.keys(uploadHeaders),
          bodyType: 'FormData',
          videoSize: recordingFile.size,
          videoSizeLabel: formatBytes(recordingFile.size),
          blobSize: blob.size,
          blobSizeLabel: formatBytes(blob.size),
          recordedChunksLength: replayChunksRef.current.length,
          recordedChunksSize,
          recordedChunksSizeLabel: formatBytes(recordedChunksSize),
          selectedVideoQuality,
          mimeType: replayMimeTypeRef.current,
        });
        try {
          response = await fetch(uploadUrl, {
            method: 'POST',
            headers: uploadHeaders,
            body: formData,
          });
        } catch (fetchError) {
          console.error('[live-recording] upload fetch failed before response', {
            uploadUrl,
            error: fetchError,
            message: fetchError instanceof Error ? fetchError.message : String(fetchError),
            name: fetchError instanceof Error ? fetchError.name : 'unknown',
            videoSize: recordingFile.size,
            videoSizeLabel: formatBytes(recordingFile.size),
            blobSize: blob.size,
            blobSizeLabel: formatBytes(blob.size),
            recordedChunksLength: replayChunksRef.current.length,
            recordedChunksSize,
            recordedChunksSizeLabel: formatBytes(recordedChunksSize),
            selectedVideoQuality,
            mimeType: replayMimeTypeRef.current,
          });
          const uploadDebug = [
            `quality=${selectedVideoQuality}`,
            `mime=${replayMimeTypeRef.current || 'unknown'}`,
            `blob.size=${blob.size} (${formatBytes(blob.size)})`,
            `recordedChunks.totalSize=${recordedChunksSize} (${formatBytes(recordedChunksSize)})`,
            `recordedChunks.length=${replayChunksRef.current.length}`,
            `file.size=${recordingFile.size} (${formatBytes(recordingFile.size)})`,
          ].join(', ');
          throw new Error(
            fetchError instanceof Error
              ? `Upload request did not reach the server: ${fetchError.name}: ${fetchError.message}. ${uploadDebug}`
              : `Upload request did not reach the server: ${String(fetchError)}. ${uploadDebug}`
          );
        }
      }
      console.info('[live-recording] after direct fetch /posts', {
        hasResponse: !!response,
        status: response?.status,
        ok: response?.ok,
      });
      if (!response?.ok) {
        const uploadError = await readUploadError(response);
        console.error('[live-recording] upload response error', {
          status: response.status,
          error: uploadError,
        });
        throw new Error(uploadError);
      }
      console.info('[live-recording] upload response ok', {
        status: response.status,
      });
      const savedPost = await response.json();
      const uploadedUrl = savedPost?.videoUrl || savedPost?.video || savedPost?.video_url || savedPost?.media_url;
      const postCreated = Boolean(savedPost?.post_id);
      const isProcessing = savedPost?.status === 'processing' || response.status === 202;
      if (savedPost?.post_id && isProcessing) {
        pendingReplayPostIdRef.current = savedPost.post_id;
      }
      console.info('[live-recording] database insert response', savedPost);
      console.info('[live-recording] upload succeeded', {
        postId: savedPost?.post_id,
        status: savedPost?.status,
        videoUrl: uploadedUrl,
        thumbnailUrl: savedPost?.thumbnailUrl || savedPost?.thumbnail_url || savedPost?.image,
      });
      if (!postCreated) {
        throw new Error('Database insert failed: post_id is missing from response');
      }
      if (!uploadedUrl && !isProcessing) {
        throw new Error('Database insert failed: videoUrl is required');
      }
      replayChunksRef.current = [];
      replayStartedAtRef.current = null;
      replayDurationSecondsRef.current = 0;
      setRecordingSaveStatus(isProcessing ? 'processing' : 'saved');
      setRecordingSaveMessage(isProcessing ? 'Tallenne vastaanotettu. Video valmistuu Mediavirtaan taustalla.' : 'Tallenne julkaistiin Mediavirtaan.');
      void loadSavedRecordings();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live-tallennetta ei saatu julkaistua Mediavirtaan.';
      console.error('[live-recording] save failed', error);
      failLiveRecording(message, error);
    } finally {
      console.info('[live-recording] save flow finished');
      console.log('[live-recording] SAVE END');
      setIsReplayPublishing(false);
    }
  };

  const startReplayRecording = (stream: MediaStream) => {
    if (typeof MediaRecorder === 'undefined') {
      console.warn('MediaRecorder ei ole käytettävissä tässä selaimessa.');
      Alert.alert('Tallennus ei onnistu', 'Selaimesi ei tue live-klippien tallennusta.');
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') return;

    try {
      const activeTracks = stream.getTracks().filter((track) => track.readyState === 'live');
      console.info('[live-recording] start tracks', activeTracks.map((track) => ({
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        settings: typeof track.getSettings === 'function' ? track.getSettings() : null,
        constraints: typeof track.getConstraints === 'function' ? track.getConstraints() : null,
      })));
      if (!activeTracks.length) {
        throw new Error('Tallennus ei käynnisty: kamera/mikrofoni ei tuota aktiivisia raitoja.');
      }
      pendingReplayPostIdRef.current = null;
      replayChunksRef.current = [];
      replayStartedAtRef.current = Date.now();
      replayDurationSecondsRef.current = 0;
      setRecordingSaveStatus('recording');
      replayMimeTypeRef.current = getReplayMimeType();
      const recorderOptions = getReplayRecorderOptions(replayMimeTypeRef.current, selectedVideoQuality);
      console.info('[live-recording] recorder config', {
        selectedVideoQuality,
        mimeType: replayMimeTypeRef.current,
        recorderOptions,
        requestedVideoConstraints: getVideoConstraints(selectedVideoDeviceId, selectedVideoQuality),
        ...getTrackDiagnostics(stream),
      });
      const recorder = new MediaRecorder(stream, recorderOptions);
      recorder.onstart = () => {
        console.info('[live-recording] MediaRecorder start event', {
          selectedVideoQuality,
          state: recorder.state,
          mimeType: recorder.mimeType,
          videoBitsPerSecond: recorder.videoBitsPerSecond,
          audioBitsPerSecond: recorder.audioBitsPerSecond,
          startedAt: replayStartedAtRef.current,
          ...getTrackDiagnostics(stream),
        });
      };
      recorder.ondataavailable = (event) => {
        const nextChunksSize = replayChunksRef.current.reduce((total, chunk) => total + chunk.size, 0) + (event.data?.size || 0);
        console.info('[live-recording] dataavailable', {
          selectedVideoQuality,
          size: event.data?.size || 0,
          type: event.data?.type || '',
          recorderState: recorder.state,
          nextChunkCount: replayChunksRef.current.length + (event.data?.size ? 1 : 0),
          nextChunksSize,
          elapsedSeconds: replayStartedAtRef.current
            ? Math.round((Date.now() - replayStartedAtRef.current) / 1000)
            : 0,
        });
        if (event.data?.size) {
          replayChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        const recorderError = (event as Event & { error?: DOMException }).error;
        failLiveRecording(
          `MediaRecorder error: ${recorderError?.message || event.type || 'unknown recorder error'}`,
          {
            selectedVideoQuality,
            name: recorderError?.name,
            message: recorderError?.message,
            type: event.type,
            ...getTrackDiagnostics(stream),
          }
        );
      };
      recorder.onpause = () => {
        console.warn('[live-recording] MediaRecorder pause event', {
          selectedVideoQuality,
          state: recorder.state,
          elapsedSeconds: replayStartedAtRef.current
            ? Math.round((Date.now() - replayStartedAtRef.current) / 1000)
            : 0,
        });
      };
      recorder.onresume = () => {
        console.info('[live-recording] MediaRecorder resume event', {
          selectedVideoQuality,
          state: recorder.state,
          elapsedSeconds: replayStartedAtRef.current
            ? Math.round((Date.now() - replayStartedAtRef.current) / 1000)
            : 0,
        });
      };
      recorder.onstop = () => {
        const stoppedChunksSize = replayChunksRef.current.reduce((total, chunk) => total + chunk.size, 0);
        console.info('[live-recording] MediaRecorder stop event', {
          selectedVideoQuality,
          recordedChunksLength: replayChunksRef.current.length,
          recordedChunksSize: stoppedChunksSize,
          shouldPublish: shouldPublishReplayRef.current,
          startedAt: replayStartedAtRef.current,
          mimeType: replayMimeTypeRef.current,
          elapsedSeconds: replayStartedAtRef.current
            ? Math.round((Date.now() - replayStartedAtRef.current) / 1000)
            : 0,
          ...getTrackDiagnostics(stream),
        });
        if (replayLimitTimerRef.current) {
          clearTimeout(replayLimitTimerRef.current);
          replayLimitTimerRef.current = null;
        }
        if (replayDataPumpTimerRef.current) {
          clearInterval(replayDataPumpTimerRef.current);
          replayDataPumpTimerRef.current = null;
        }
        mediaRecorderRef.current = null;
        setIsReplayRecording(false);
        replayDurationSecondsRef.current = replayStartedAtRef.current
          ? Math.min(Math.round((Date.now() - replayStartedAtRef.current) / 1000), LIVE_REPLAY_MAX_MS / 1000)
          : 0;
        if (shouldPublishReplayRef.current) {
          void publishReplayToMediaFeed(activeHostRef.current);
        } else {
          replayChunksRef.current = [];
          replayStartedAtRef.current = null;
          replayDurationSecondsRef.current = 0;
          setRecordingSaveStatus('idle');
          shouldPublishReplayRef.current = true;
        }
        replayStopResolverRef.current?.();
        replayStopResolverRef.current = null;
        replayStopPromiseRef.current = null;
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsReplayRecording(true);
      if (replayDataPumpTimerRef.current) clearInterval(replayDataPumpTimerRef.current);
      replayDataPumpTimerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          try {
            mediaRecorderRef.current.requestData();
          } catch (error) {
            console.warn('[live-recording] requestData failed', error);
          }
        }
      }, 5000);
      if (replayLimitTimerRef.current) clearTimeout(replayLimitTimerRef.current);
      replayLimitTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.requestData();
          mediaRecorderRef.current.stop();
        }
      }, LIVE_REPLAY_MAX_MS);
    } catch (error) {
      console.error('Live replay -tallennusta ei voitu aloittaa:', error);
      failLiveRecording(error instanceof Error ? `MediaRecorder start failed: ${error.message}` : 'MediaRecorder start failed', error);
    }
  };

  const stopReplayRecording = () => {
    if (replayLimitTimerRef.current) {
      clearTimeout(replayLimitTimerRef.current);
      replayLimitTimerRef.current = null;
    }
    if (replayDataPumpTimerRef.current) {
      clearInterval(replayDataPumpTimerRef.current);
      replayDataPumpTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve();
    if (!replayStopPromiseRef.current) {
      replayStopPromiseRef.current = new Promise((resolve) => {
        replayStopResolverRef.current = resolve;
      });
    }
    try {
      console.info('[live-recording] stop requested', {
        state: recorder.state,
        chunksBeforeFinalRequest: replayChunksRef.current.length,
        sizeBeforeFinalRequest: replayChunksRef.current.reduce((total, chunk) => total + chunk.size, 0),
      });
      recorder.requestData();
      recorder.stop();
    } catch {
      setIsReplayRecording(false);
      failLiveRecording('MediaRecorder stop failed while requesting final data');
      replayStopResolverRef.current?.();
      replayStopResolverRef.current = null;
      replayStopPromiseRef.current = null;
    }
    return replayStopPromiseRef.current || Promise.resolve();
  };

  const startCamera = async () => {
    if (!activeHost || isStartingStreamRef.current) return;
    if (broadcastStatus === 'connecting' || broadcastStatus === 'connected') return;
    isStartingStreamRef.current = true;
    try {
      const stream = await getOrStartCamera();
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      const connection = createPeerConnection(activeHost.id);
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      setBroadcastStatus('connecting');
      setLiveStartedAt((current) => current || Date.now());
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      liveSignalingSocket.emit('live:send-offer', { roomId: activeHost.id, offer });
    } catch (err) {
      console.error('Kameraa ei voitu avata:', err);
      setBroadcastStatus('idle');
    } finally {
      isStartingStreamRef.current = false;
    }
  };

  const stopBroadcast = async (publishReplay = true) => {
    if (isReplayRecording) {
      shouldPublishReplayRef.current = publishReplay;
      await stopReplayRecording();
    } else {
      replayChunksRef.current = [];
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    remoteStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    pendingIceCandidatesRef.current = [];
    setBroadcastStatus('idle');
    setLiveStartedAt(null);
    setAudioLevel(0);
    isStartingStreamRef.current = false;
  };

  const closeLiveModal = () => {
    void stopBroadcast(false);
    setActiveHost(null);
  };

  const toggleLiveBroadcast = () => {
    if (broadcastStatus === 'idle' || broadcastStatus === 'camera-ready') {
      void startCamera();
      return;
    }
    void stopBroadcast(true);
  };

  const toggleReplayRecording = async () => {
    if (isReplayPublishing) return;
    if (isReplayRecording) {
      shouldPublishReplayRef.current = true;
      await stopReplayRecording();
      return;
    }
    const stream = await getOrStartCamera();
    shouldPublishReplayRef.current = true;
    setRecordingSaveStatus('idle');
    setRecordingSaveMessage('');
    startReplayRecording(stream);
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  };

  const applyMediaDeviceChange = async (
    nextVideoDeviceId: string,
    nextAudioDeviceId: string,
    nextVideoQuality: VideoQuality = selectedVideoQuality
  ) => {
    console.info('[live-recording] applying media device change', {
      previousVideoQuality: selectedVideoQuality,
      nextVideoQuality,
      nextVideoDeviceId,
      nextAudioDeviceId,
      hadLocalStream: !!localStream,
    });
    setSelectedVideoDeviceId(nextVideoDeviceId);
    setSelectedAudioDeviceId(nextAudioDeviceId);
    setSelectedVideoQuality(nextVideoQuality);
    if (!localStream || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    try {
      const requestedVideoConstraints = getVideoConstraints(nextVideoDeviceId, nextVideoQuality);
      const requestedAudioConstraints = getAudioConstraints(nextAudioDeviceId);
      console.info('[live-recording] requesting replacement media stream', {
        selectedVideoQuality: nextVideoQuality,
        requestedVideoConstraints,
        requestedAudioConstraints,
      });
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: requestedVideoConstraints,
        audio: requestedAudioConstraints,
      });
      nextStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      console.info('[live-recording] replacement media stream ready', {
        selectedVideoQuality: nextVideoQuality,
        ...getTrackDiagnostics(nextStream),
      });
      const connection = peerConnectionRef.current;
      if (connection) {
        for (const track of nextStream.getTracks()) {
          const sender = connection.getSenders().find((item) => item.track?.kind === track.kind);
          if (sender) {
            await sender.replaceTrack(track);
          }
        }
      }
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(nextStream);
    } catch (error) {
      console.error('Medialaitteen vaihto epäonnistui:', error);
      failLiveRecording(
        error instanceof Error
          ? `Laatuasetuksen vaihto epäonnistui: ${error.message}`
          : 'Laatuasetuksen vaihto epäonnistui',
        error
      );
    }
  };

  const deleteChatMessage = (messageId: string) => {
    setMessages((current) => current.filter((message) => message.id !== messageId));
    setPinnedMessage((current) => (current?.id === messageId ? null : current));
  };

  const blockChatAuthor = (author: string) => {
    setBlockedAuthors((current) => (current.includes(author) ? current : [...current, author]));
    setMessages((current) => current.filter((message) => message.author !== author));
    setPinnedMessage((current) => (current?.author === author ? null : current));
  };

  const pinMessage = (message: LiveChatMessage) => {
    setPinnedMessage(message);
  };

  const liftQuestionToStream = (question: LiveChatMessage) => {
    setStreamQuestion(question);
  };

  const upvoteQuestion = (questionId: string) => {
    setHighlightedQuestions((current) =>
      current
        .map((question) => question.id === questionId ? { ...question, upvotes: (question.upvotes || 0) + 1 } : question)
        .sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0))
    );
  };

  const copyInviteLink = async () => {
    if (!activeHost || typeof window === 'undefined') return;
    const inviteUrl = `${window.location.origin}/live?roomId=${encodeURIComponent(activeHost.id)}&topic=${encodeURIComponent(activeHost.topic)}`;
    try {
      await navigator.clipboard?.writeText(inviteUrl);
    } catch (error) {
      console.error('Kutsulinkin kopiointi epäonnistui:', error);
    }
  };

  const getGiftBadge = (badgeType?: string) =>
    giftBadges.find((badge) => badge.badgeType === badgeType) || giftBadges[0];

  const sendGiftBadge = (badge: LiveGiftBadge) => {
    if (!activeHost) return;
    const username = user?.username?.trim() || 'sinä';
    liveSignalingSocket.emit('live:send-gift', {
      roomId: activeHost.id,
      badgeType: badge.badgeType,
      username,
    });
    setGiftToasts((current) => [
      { id: `gift_${Date.now()}`, roomId: activeHost.id, badgeType: badge.badgeType, username },
      ...current.slice(0, 2),
    ]);
    setIsGiftPanelOpen(false);
  };

  const sendChatMessage = () => {
    const text = chatDraft.trim();
    if (!text) return;
    const author = user?.username?.trim() || 'sinä';
    if (blockedAuthors.includes(author)) return;
    setMessages((current) => [
      ...current.slice(-24),
      {
        id: `mine_${Date.now()}`,
        author,
        text,
        mine: true,
      },
    ]);
    setChatDraft('');
  };

  const visibleMessages = messages.filter((message) => !blockedAuthors.includes(message.author));
  const sortedQuestions = [...highlightedQuestions].sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
  const videoDevices = mediaDevices.filter((device) => device.kind === 'videoinput');
  const audioDevices = mediaDevices.filter((device) => device.kind === 'audioinput');
  const audioMeterFillColor = isMuted ? '#334155' : audioLevel >= 68 ? '#facc15' : '#22c55e';
  const qaPulseOpacity = qaPulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const isLiveActive = broadcastStatus === 'connecting' || broadcastStatus === 'connected';

  const submitQuestion = () => {
    const text = questionDraft.trim();
    if (!text) return;
    const author = user?.username?.trim() || 'sinä';
    setHighlightedQuestions((current) => [
      {
        id: `question_${Date.now()}`,
        author,
        text,
        mine: true,
      },
      ...current.slice(0, 4),
    ]);
    setQuestionDraft('');
  };

  const liveDashboard = activeHost ? (
    <View style={[styles.liveDashboard, isMobileLive && styles.liveDashboardMobile]}>
      <View style={styles.liveTopBar}>
        <View style={styles.liveTopBrandMark}>
          <Ionicons name="radio" size={22} color="#fff" />
        </View>
        <View style={styles.liveTopContent}>
          <View style={styles.liveTopBadgeRow}>
            <View style={styles.liveModalBadgeInline}>
              <View style={styles.liveTopLiveDot} />
              <Text style={styles.liveModalBadgeInlineText}>LIVE</Text>
            </View>
            <Text style={styles.liveStudioLabel}>YOSLA Studio</Text>
          </View>
          <Text style={styles.liveModalTitle}>{activeHost.name}</Text>
          <View style={styles.liveTopMetaRow}>
            <View style={styles.liveTopMetaPill}>
              <Ionicons name="pricetag-outline" size={12} color="#bfdbfe" />
              <Text style={styles.liveTopMetaText}>{activeHost.topic}</Text>
            </View>
            <View style={styles.liveTopMetaPill}>
              <Ionicons name="eye-outline" size={12} color="#fecaca" />
              <Text style={styles.liveTopMetaText}>{activeHost.viewers} katsojaa</Text>
            </View>
            <View style={styles.liveTopMetaPill}>
              <Ionicons name="time-outline" size={12} color="#bbf7d0" />
              <Text style={styles.liveTopMetaText}>{formatLiveDuration(elapsedSeconds)}</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.liveExitButton} onPress={closeLiveModal}>
          <Ionicons name="exit-outline" size={16} color="#fecaca" />
          <Text style={styles.liveExitText}>Poistu</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.liveMainContent, isMobileLive && styles.liveMainContentMobile]}>
        <View style={[styles.liveMediaColumn, isMobileLive && styles.liveMediaColumnMobile]}>
          <View style={styles.liveVideoShell}>
            <Text style={styles.liveModalBadge}>LIVE</Text>
            {remoteStream ? (
              React.createElement('video', {
                ref: remoteVideoRef,
                autoPlay: true,
                playsInline: true,
                controls: true,
                style: {
                  aspectRatio: '16 / 9',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#020617',
                },
              })
            ) : localStream ? (
              React.createElement('video', {
                ref: localVideoRef,
                autoPlay: true,
                playsInline: true,
                muted: true,
                style: {
                  aspectRatio: '16 / 9',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#020617',
                },
              })
            ) : (
              <>
                <Ionicons name="videocam" size={54} color="#fff" />
                <Text style={styles.videoPlaceholderTitle}>{activeHost.name}</Text>
                <Text style={styles.videoPlaceholderTopic}>{activeHost.topic} · avaa kamera aloittaaksesi</Text>
              </>
            )}
            <View style={styles.localPreview}>
              {localStream && remoteStream ? (
                React.createElement('video', {
                  ref: localVideoRef,
                  autoPlay: true,
                  playsInline: true,
                  muted: true,
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: 12,
                  },
                })
              ) : (
                <Text style={styles.localPreviewText}>{broadcastStatus === 'connected' ? 'Yhteydessä' : 'Preview'}</Text>
              )}
            </View>
            <View style={styles.floatingReactionOne}><Text style={styles.floatingReactionText}>🔥</Text></View>
            <View style={styles.floatingReactionTwo}><Text style={styles.floatingReactionText}>🚀</Text></View>
            {pinnedMessage ? (
              <View style={[styles.pinnedOverlay, streamQuestion && styles.pinnedOverlayRaised]}>
                <Text style={styles.pinnedLabel}>PINNATTU</Text>
                <Text style={styles.pinnedText}>@{pinnedMessage.author}: {pinnedMessage.text}</Text>
              </View>
            ) : null}
            {streamQuestion ? (
              <View style={styles.streamQuestionOverlay}>
                <View style={styles.streamQuestionHeader}>
                  <Animated.View style={[styles.streamQuestionBadge, { opacity: qaPulseOpacity }]}>
                    <Text style={styles.streamQuestionBadgeText}>Q&A</Text>
                  </Animated.View>
                  <Text style={styles.streamQuestionAuthor}>@{streamQuestion.author}</Text>
                  <TouchableOpacity style={styles.streamQuestionClose} onPress={() => setStreamQuestion(null)}>
                    <Ionicons name="close" size={15} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.streamQuestionText}>{streamQuestion.text}</Text>
              </View>
            ) : null}
            <View style={styles.giftToastStack}>
              {giftToasts.map((gift) => {
                const badge = getGiftBadge(gift.badgeType);
                return (
                  <View key={gift.id} style={styles.giftToast}>
                    <View style={[styles.giftToastIcon, { backgroundColor: badge.color }]}>
                      <Ionicons name={badge.icon} size={16} color="#fff" />
                    </View>
                    <Text style={styles.giftToastText}>@{gift.username} lähetti {badge.title}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.broadcastPanel}>
            <View style={styles.broadcastTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.broadcastTitle}>WebRTC-lähetys</Text>
                <Text style={styles.broadcastStatus}>Tila: {broadcastStatusLabels[broadcastStatus]}</Text>
              </View>
            </View>
            <View style={styles.broadcastButtonRow}>
              <TouchableOpacity
                style={[
                  styles.unifiedLiveButton,
                  isLiveActive && styles.unifiedLiveButtonActive,
                  (isStartingStreamRef.current || isReplayPublishing) && styles.unifiedLiveButtonDisabled,
                ]}
                onPress={toggleLiveBroadcast}
                disabled={isStartingStreamRef.current || isReplayPublishing}
              >
                <Ionicons name={isLiveActive ? 'stop-circle' : 'radio'} size={20} color="#fff" />
                  <Text style={styles.unifiedLiveButtonText}>
                  {isReplayPublishing
                    ? 'Julkaistaan tallennetta...'
                    : isLiveActive
                      ? '⏹️ Lopeta live-lähetys'
                      : '🔴 Aloita live-lähetys'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.replayRecordButton,
                  isReplayRecording && styles.replayRecordButtonActive,
                  (!localStream || isReplayPublishing) && styles.unifiedLiveButtonDisabled,
                ]}
                onPress={() => void toggleReplayRecording()}
                disabled={!localStream || isReplayPublishing}
              >
                <Ionicons name={isReplayRecording ? 'stop' : 'save-outline'} size={18} color="#fff" />
                <Text style={styles.replayRecordButtonText}>
                  {isReplayPublishing
                    ? 'Tallennetaan Mediavirtaan...'
                    : isReplayRecording
                      ? 'Lopeta tallennus'
                      : 'Tallenna klippi'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.muteButton, isMuted && styles.muteButtonActive]} onPress={toggleMute}>
                <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={18} color={isMuted ? '#fecaca' : '#fff'} />
                <Text style={styles.muteButtonText}>{isMuted ? 'Avaa mikki' : 'Mykistä'}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.recordingStateBar, recordingSaveStatus === 'failed' && styles.recordingStateBarFailed, recordingSaveStatus === 'saved' && styles.recordingStateBarSaved]}>
              <Ionicons
                name={recordingSaveStatus === 'saved' ? 'checkmark-circle' : recordingSaveStatus === 'failed' ? 'alert-circle' : isReplayRecording ? 'radio-button-on' : 'save-outline'}
                size={16}
                color={recordingSaveStatus === 'failed' ? '#fecaca' : recordingSaveStatus === 'saved' ? '#bbf7d0' : '#bfdbfe'}
              />
              <Text style={styles.recordingStateText}>{recordingSaveStatusLabels[recordingSaveStatus]}</Text>
            </View>
            {recordingSaveMessage ? <Text style={styles.recordingStateDetail}>{recordingSaveMessage}</Text> : null}
            <View style={styles.recordingsPanel}>
              <View style={styles.recordingsPanelHeader}>
                <Text style={styles.recordingsPanelTitle}>Tallenteet</Text>
                <Text style={styles.recordingsPanelMeta}>1-25 min klipit</Text>
              </View>
              {savedRecordings.length === 0 ? (
                <Text style={styles.recordingsEmptyText}>Tallennetut live-klipit näkyvät tässä ja Mediavirrassa.</Text>
              ) : (
                savedRecordings.map((recording) => (
                  <View key={recording.post_id} style={styles.recordingRow}>
                    <Ionicons name="play-circle" size={18} color="#60a5fa" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.recordingRowTitle} numberOfLines={1}>{recording.title || recording.text || 'YOSLA Live'}</Text>
                      <Text style={styles.recordingRowMeta}>
                        {recording.duration ? formatLiveDuration(recording.duration) : 'Tallenne'} · Julkinen
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
            <View style={styles.deviceGrid}>
              <View style={styles.deviceField}>
                <Text style={styles.deviceLabel}>Laatu</Text>
                <View style={styles.qualityToggleRow}>
                  {(['720p', '1080p'] as VideoQuality[]).map((quality) => {
                    const active = selectedVideoQuality === quality;
                    return (
                      <TouchableOpacity
                        key={quality}
                        style={[styles.qualityToggleButton, active && styles.qualityToggleButtonActive]}
                        onPress={() => void applyMediaDeviceChange(selectedVideoDeviceId, selectedAudioDeviceId, quality)}
                      >
                        <Text style={[styles.qualityToggleText, active && styles.qualityToggleTextActive]}>
                          {quality === '1080p' ? 'Full HD 1080p' : 'Vakaa HD 720p'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={styles.deviceField}>
                <Text style={styles.deviceLabel}>Kamera</Text>
                {React.createElement('select', {
                  value: selectedVideoDeviceId,
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
                    void applyMediaDeviceChange(event.target.value, selectedAudioDeviceId),
                  style: nativeSelectStyle,
                },
                React.createElement('option', { key: 'default-camera', value: '' }, 'Oletuskamera'),
                ...videoDevices.map((device) =>
                  React.createElement('option', { key: device.deviceId, value: device.deviceId }, device.label)
                ))}
              </View>
              <View style={styles.deviceField}>
                <Text style={styles.deviceLabel}>Mikrofoni</Text>
                {React.createElement('select', {
                  value: selectedAudioDeviceId,
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
                    void applyMediaDeviceChange(selectedVideoDeviceId, event.target.value),
                  style: nativeSelectStyle,
                },
                React.createElement('option', { key: 'default-mic', value: '' }, 'Oletusmikrofoni'),
                ...audioDevices.map((device) =>
                  React.createElement('option', { key: device.deviceId, value: device.deviceId }, device.label)
                ))}
                <View style={styles.audioMeterRow}>
                  <Ionicons name="pulse" size={16} color={audioMeterFillColor} />
                  <View style={styles.audioMeterTrack}>
                    <View style={[styles.audioMeterFill, { width: `${isMuted ? 0 : audioLevel}%`, backgroundColor: audioMeterFillColor }]} />
                  </View>
                  <Text style={styles.audioMeterText}>{isMuted ? 'Mute' : `${audioLevel}%`}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.liveSocialColumn, isMobileLive && styles.liveSocialColumnMobile]}>
          <View style={styles.liveChatPanel}>
            <Text style={styles.livePanelTitle}>Live-chat</Text>
            <ScrollView ref={chatScrollRef} style={styles.liveChatScroll} contentContainerStyle={styles.liveChatScrollContent} keyboardShouldPersistTaps="handled">
              {visibleMessages.map((message) => (
                <LiveChatLine
                  key={message.id}
                  message={message}
                  onDelete={() => deleteChatMessage(message.id)}
                  onBlock={() => blockChatAuthor(message.author)}
                  onPin={() => pinMessage(message)}
                />
              ))}
            </ScrollView>
            <View style={styles.chatInputBar}>
              <TextInput
                value={chatDraft}
                onChangeText={setChatDraft}
                placeholder="Kirjoita viesti chattiin..."
                placeholderTextColor="#94a3b8"
                returnKeyType="send"
                onSubmitEditing={sendChatMessage}
                blurOnSubmit={false}
                style={styles.chatInput}
              />
              <Pressable
                style={[styles.giftButton, isGiftPanelOpen && styles.giftButtonActive]}
                onPress={() => setIsGiftPanelOpen((current) => !current)}
              >
                <Ionicons name="gift" size={18} color="#fff" />
              </Pressable>
              <Pressable
                style={[styles.chatSendButton, !chatDraft.trim() && styles.chatSendButtonDisabled]}
                onPress={sendChatMessage}
                disabled={!chatDraft.trim()}
              >
                <Ionicons name="paper-plane" size={17} color="#fff" />
                {!isMobileLive ? <Text style={styles.chatSendText}>Lähetä</Text> : null}
              </Pressable>
              {isGiftPanelOpen ? (
                <View style={styles.giftPanel}>
                  <View style={styles.giftPanelHeader}>
                    <Text style={styles.giftPanelTitle}>Lähetä live-lahja</Text>
                    <Text style={styles.giftPanelSubtitle}>YOSLA-pisteillä tai eurolla</Text>
                  </View>
                  {giftBadges.map((badge) => (
                    <TouchableOpacity
                      key={badge.badgeType}
                      style={[styles.giftCard, badge.featured && styles.giftCardFeatured]}
                      onPress={() => sendGiftBadge(badge)}
                    >
                      <View style={[styles.giftCardIcon, { backgroundColor: badge.color }, badge.featured && styles.giftCardIconFeatured]}>
                        <Ionicons name={badge.icon} size={18} color="#fff" />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.giftCardTitle}>{badge.title}</Text>
                        <Text style={styles.giftCardPrice}>{badge.priceLabel}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.liveSidePanel}>
            <Text style={styles.livePanelTitle}>Q&A</Text>
            <Text style={styles.liveChatLine}>Nosta parhaat kysymykset tähän.</Text>
            <View style={styles.questionComposer}>
              <TextInput
                value={questionDraft}
                onChangeText={setQuestionDraft}
                placeholder="Kirjoita kysymys..."
                placeholderTextColor="#93c5fd"
                returnKeyType="send"
                onSubmitEditing={submitQuestion}
                blurOnSubmit={false}
                style={styles.questionInput}
              />
              <Pressable
                style={[styles.questionSendButton, !questionDraft.trim() && styles.chatSendButtonDisabled]}
                onPress={submitQuestion}
                disabled={!questionDraft.trim()}
              >
                <Ionicons name="add-circle" size={18} color="#fff" />
              </Pressable>
            </View>
            <ScrollView style={styles.questionList} contentContainerStyle={styles.questionListContent} keyboardShouldPersistTaps="handled">
              {sortedQuestions.length ? sortedQuestions.map((question) => (
                <HighlightedQuestion
                  key={question.id}
                  question={question}
                  onPin={() => pinMessage(question)}
                  onLift={() => liftQuestionToStream(question)}
                  onUpvote={() => upvoteQuestion(question.id)}
                />
              )) : (
                <View style={styles.questionEmptyState}>
                  <Text style={styles.questionEmptyText}>Parhaat kysymykset ilmestyvät tähän.</Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.guestModeBox}>
              <Ionicons name="person-add" size={18} color="#fff" />
              <Text style={styles.guestModeText}>Vierastila valmiina</Text>
            </View>
            <TouchableOpacity style={styles.copyInviteButton} onPress={copyInviteLink}>
              <Ionicons name="link" size={16} color="#fff" />
              <Text style={styles.copyInviteText}>Kopioi kutsulinkki</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  ) : null;

  if (activeHost && !isMobileLive) {
    return (
      <ScrollView contentContainerStyle={[styles.container, styles.liveActiveContainer]}>
        {liveDashboard}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Livenä nyt</Text>
        <Text style={styles.title}>Tapahtumat, keskustelut ja yhteislähetykset</Text>
        <Text style={styles.body}>Seuraa käynnissä olevia livejä, avaa chat ja liity mukaan keskusteluun.</Text>
      </View>

      <View style={styles.liveGrid}>
        {liveHosts.map((host) => (
          <TouchableOpacity key={host.id} style={styles.liveCard} onPress={() => setActiveHost(host)}>
            <View style={styles.liveAvatarRing}>
              <Text style={styles.liveAvatarInitial}>{host.name.slice(0, 1)}</Text>
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            </View>
            <View style={styles.liveInfo}>
              <Text style={styles.liveName}>{host.name}</Text>
              <Text style={styles.liveTopic}>{host.topic}</Text>
              <Text style={styles.liveMeta}>{host.viewers} katsojaa</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748b" />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.upcomingCard}>
        <Ionicons name="calendar-outline" size={22} color="#0F62FE" />
        <View style={{ flex: 1 }}>
          <Text style={styles.upcomingTitle}>Tulevat livet</Text>
          <Text style={styles.upcomingBody}>Ajastus ja muistutukset voidaan kytkeä tähän seuraavassa vaiheessa.</Text>
        </View>
      </View>

      <Modal visible={!!activeHost} animationType="slide" onRequestClose={closeLiveModal}>
        <View style={styles.liveModal}>{liveDashboard}</View>
      </Modal>
    </ScrollView>
  );
}

function HighlightedQuestion({
  question,
  onPin,
  onLift,
  onUpvote,
}: {
  question: LiveChatMessage;
  onPin: () => void;
  onLift: () => void;
  onUpvote: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={[styles.questionCard, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.questionBadgeRow}>
        <Text style={styles.questionBadge}>Kysymys</Text>
        <Text style={styles.questionAuthor}>@{question.author}</Text>
        <TouchableOpacity style={styles.questionAction} onPress={onUpvote}>
          <Ionicons name="arrow-up" size={13} color="#bfdbfe" />
          <Text style={styles.questionActionText}>{question.upvotes || 0}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.questionAction} onPress={onPin}>
          <Ionicons name="pin" size={13} color="#bfdbfe" />
        </TouchableOpacity>
      </View>
      <Text style={styles.questionText}>{question.text}</Text>
      <TouchableOpacity style={styles.liftQuestionButton} onPress={onLift}>
        <Ionicons name="arrow-up-circle" size={14} color="#fff" />
        <Text style={styles.liftQuestionText}>Nosta striimiin</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function LiveChatLine({
  message,
  onDelete,
  onBlock,
  onPin,
}: {
  message: LiveChatMessage;
  onDelete: () => void;
  onBlock: () => void;
  onPin: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Pressable onHoverIn={() => setIsHovered(true)} onHoverOut={() => setIsHovered(false)}>
      <Animated.View
        style={[
          styles.liveChatBubble,
          message.mine && styles.liveChatBubbleMine,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <Text style={[styles.liveChatLine, message.mine && styles.liveChatLineMine]}>
          @{message.author}: {message.text}
        </Text>
        {isHovered ? (
          <View style={styles.chatModerationRow}>
            <TouchableOpacity style={styles.chatModerationButton} onPress={onPin}>
              <Ionicons name="pin" size={13} color="#cbd5e1" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatModerationButton} onPress={onDelete}>
              <Ionicons name="trash" size={13} color="#fecaca" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatModerationButton} onPress={onBlock}>
              <Ionicons name="ban" size={13} color="#fecaca" />
            </TouchableOpacity>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb', gap: 14 },
  liveActiveContainer: { minHeight: '100%', padding: 24 },
  hero: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 18, padding: 18 },
  kicker: { color: '#dc2626', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 5 },
  title: { color: '#111827', fontSize: 25, fontWeight: '900', marginBottom: 8 },
  body: { color: '#64748b', fontSize: 14, lineHeight: 20 },
  liveGrid: { gap: 12 },
  liveCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14 },
  liveAvatarRing: { width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: '#ef4444', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  liveAvatarInitial: { color: '#fff', fontSize: 20, fontWeight: '900' },
  liveBadge: { position: 'absolute', bottom: -5, borderRadius: 999, backgroundColor: '#ef4444', paddingHorizontal: 6, paddingVertical: 2 },
  liveBadgeText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  liveInfo: { flex: 1 },
  liveName: { color: '#111827', fontSize: 16, fontWeight: '900' },
  liveTopic: { color: '#64748b', fontSize: 13, marginTop: 2 },
  liveMeta: { color: '#dc2626', fontSize: 12, fontWeight: '800', marginTop: 3 },
  upcomingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', padding: 14 },
  upcomingTitle: { color: '#111827', fontSize: 15, fontWeight: '900' },
  upcomingBody: { color: '#64748b', fontSize: 13, marginTop: 2 },
  liveModal: { flex: 1, backgroundColor: '#050816', padding: 16 },
  liveDashboard: { width: '100%', gap: 20 },
  liveDashboardMobile: { flex: 1 },
  liveTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.28)',
    backgroundColor: '#07111f',
    padding: 16,
    shadowColor: '#0f62fe',
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  liveTopBrandMark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f62fe',
    borderWidth: 1,
    borderColor: 'rgba(147,197,253,0.42)',
    shadowColor: '#38bdf8',
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  liveTopContent: { flex: 1, minWidth: 0 },
  liveTopBadgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 7 },
  liveStudioLabel: {
    overflow: 'hidden',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.28)',
    backgroundColor: 'rgba(37,99,235,0.16)',
    color: '#bfdbfe',
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: '900',
  },
  liveTopMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  liveTopMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    backgroundColor: 'rgba(15,23,42,0.86)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveTopMetaText: { color: '#e2e8f0', fontSize: 11, fontWeight: '900' },
  liveMainContent: { display: 'flex', flexDirection: 'row', gap: 24, width: '100%', alignItems: 'stretch' },
  liveMainContentMobile: { flexDirection: 'column', gap: 14 },
  liveMediaColumn: { flexGrow: 0, flexShrink: 1, flexBasis: '62%', gap: 14, minWidth: 0 },
  liveMediaColumnMobile: { flexBasis: 'auto', width: '100%' },
  liveSocialColumn: { flexGrow: 1, flexShrink: 1, flexBasis: '38%', gap: 14, minWidth: 320, alignSelf: 'stretch' },
  liveSocialColumnMobile: { flexBasis: 'auto', width: '100%', minWidth: 0 },
  liveVideoShell: { width: '100%', aspectRatio: 16 / 9, borderRadius: 22, backgroundColor: '#111827', borderWidth: 1, borderColor: '#334155', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: 16 } },
  liveModalBadge: { position: 'absolute', top: 16, left: 16, color: '#fff', backgroundColor: '#ef4444', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '900' },
  liveModalBadgeInline: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, overflow: 'hidden', backgroundColor: 'rgba(220,38,38,0.2)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.42)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  liveTopLiveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#ef4444' },
  liveModalBadgeInlineText: { color: '#fecaca', fontSize: 11, fontWeight: '900' },
  liveModalTitle: { color: '#fff', fontSize: 28, fontWeight: '900' },
  liveModalTopic: { color: '#cbd5e1', fontSize: 14, marginTop: 4 },
  videoPlaceholderTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 12 },
  videoPlaceholderTopic: { color: '#cbd5e1', fontSize: 14, marginTop: 4 },
  localPreview: { position: 'absolute', right: 14, top: 14, width: 128, height: 86, borderRadius: 12, borderWidth: 1, borderColor: '#475569', backgroundColor: 'rgba(15,23,42,0.72)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  localPreviewText: { color: '#cbd5e1', fontSize: 12, fontWeight: '900' },
  floatingReactionOne: { position: 'absolute', right: 26, bottom: 70 },
  floatingReactionTwo: { position: 'absolute', right: 72, bottom: 130 },
  floatingReactionText: { fontSize: 34 },
  pinnedOverlay: { position: 'absolute', left: 18, right: 18, bottom: 18, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(2, 6, 23, 0.78)', paddingHorizontal: 14, paddingVertical: 10 },
  pinnedOverlayRaised: { bottom: 128 },
  pinnedLabel: { color: '#93c5fd', fontSize: 10, fontWeight: '900', marginBottom: 4 },
  pinnedText: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 19 },
  streamQuestionOverlay: {
    position: 'absolute',
    left: '14%',
    right: '14%',
    bottom: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.38)',
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: '#0F62FE',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  streamQuestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 7,
  },
  streamQuestionBadge: {
    borderRadius: 999,
    backgroundColor: '#2563eb',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  streamQuestionBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  streamQuestionAuthor: {
    flex: 1,
    color: '#bfdbfe',
    fontSize: 12,
    fontWeight: '900',
  },
  streamQuestionClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  streamQuestionText: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
  giftToastStack: { position: 'absolute', top: 64, left: 18, gap: 8, maxWidth: '70%' },
  giftToast: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(2, 6, 23, 0.78)', paddingHorizontal: 10, paddingVertical: 7 },
  giftToastIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  giftToastText: { flexShrink: 1, color: '#fff', fontSize: 12, fontWeight: '900' },
  broadcastPanel: { borderRadius: 16, backgroundColor: 'rgba(15, 23, 42, 0.94)', borderWidth: 1, borderColor: '#334155', padding: 14, gap: 10 },
  broadcastTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  broadcastTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  broadcastStatus: { color: '#93c5fd', fontSize: 12, fontWeight: '800', marginTop: 2 },
  broadcastButtonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unifiedLiveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: '#0F62FE', paddingHorizontal: 16, paddingVertical: 12, minHeight: 46, shadowColor: '#0F62FE', shadowOpacity: 0.24, shadowRadius: 14 },
  unifiedLiveButtonActive: { backgroundColor: '#7f1d1d', borderWidth: 1, borderColor: '#ef4444', shadowColor: '#dc2626', shadowOpacity: 0.36 },
  unifiedLiveButtonDisabled: { opacity: 0.62 },
  unifiedLiveButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  replayRecordButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, borderWidth: 1, borderColor: '#475569', backgroundColor: '#1e293b', paddingHorizontal: 13, paddingVertical: 12, minHeight: 46 },
  replayRecordButtonActive: { borderColor: '#facc15', backgroundColor: 'rgba(133, 77, 14, 0.72)', shadowColor: '#facc15', shadowOpacity: 0.22, shadowRadius: 12 },
  replayRecordButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  recordingStateBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#1d4ed8', backgroundColor: 'rgba(37, 99, 235, 0.14)', paddingHorizontal: 12, paddingVertical: 10 },
  recordingStateBarSaved: { borderColor: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.16)' },
  recordingStateBarFailed: { borderColor: '#dc2626', backgroundColor: 'rgba(220, 38, 38, 0.16)' },
  recordingStateText: { color: '#e2e8f0', fontSize: 12, fontWeight: '900' },
  recordingStateDetail: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  recordingsPanel: { borderRadius: 14, borderWidth: 1, borderColor: '#334155', backgroundColor: 'rgba(15, 23, 42, 0.72)', padding: 12, gap: 10 },
  recordingsPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  recordingsPanelTitle: { color: '#fff', fontSize: 14, fontWeight: '900' },
  recordingsPanelMeta: { color: '#93c5fd', fontSize: 11, fontWeight: '900' },
  recordingsEmptyText: { color: '#94a3b8', fontSize: 12, lineHeight: 17 },
  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: 'rgba(30, 41, 59, 0.72)', padding: 10 },
  recordingRowTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '900' },
  recordingRowMeta: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginTop: 2 },
  startBroadcastButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, backgroundColor: '#dc2626', paddingHorizontal: 12, paddingVertical: 11 },
  startBroadcastText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  muteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: '#475569', backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 11 },
  muteButtonActive: { borderColor: '#ef4444', backgroundColor: 'rgba(127, 29, 29, 0.55)' },
  muteButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  deviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  deviceField: { flex: 1, minWidth: 210, gap: 6 },
  deviceLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '900' },
  qualityToggleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  qualityToggleButton: {
    flex: 1,
    minWidth: 120,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  qualityToggleButtonActive: {
    borderColor: '#60a5fa',
    backgroundColor: 'rgba(37, 99, 235, 0.26)',
  },
  qualityToggleText: { color: '#cbd5e1', fontSize: 12, fontWeight: '900' },
  qualityToggleTextActive: { color: '#fff' },
  audioMeterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioMeterTrack: { flex: 1, height: 10, borderRadius: 999, backgroundColor: '#1e293b', overflow: 'hidden', borderWidth: 1, borderColor: '#334155' },
  audioMeterFill: { height: '100%', borderRadius: 999 },
  audioMeterText: { width: 44, color: '#cbd5e1', fontSize: 11, fontWeight: '900', textAlign: 'right' },
  liveOverlayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  liveOverlayGridMobile: { position: 'absolute', left: 12, right: 12, bottom: 74 },
  liveChatPanel: { flex: 1, minHeight: 0, borderRadius: 16, backgroundColor: 'rgba(15, 23, 42, 0.92)', borderWidth: 1, borderColor: '#334155', padding: 14, gap: 8 },
  liveChatPanelMobile: { minWidth: 0, height: 250, backgroundColor: 'rgba(15, 23, 42, 0.72)' },
  liveSidePanel: { flex: 1, minHeight: 0, borderRadius: 16, backgroundColor: 'rgba(15, 23, 42, 0.92)', borderWidth: 1, borderColor: '#334155', padding: 14, gap: 8 },
  liveSidePanelMobile: { display: 'none' },
  livePanelTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
  liveChatScroll: { flex: 1 },
  liveChatScrollContent: { gap: 6, paddingBottom: 2 },
  liveChatBubble: { alignSelf: 'flex-start', maxWidth: '95%', borderRadius: 12, backgroundColor: 'rgba(51, 65, 85, 0.72)', paddingHorizontal: 10, paddingVertical: 7 },
  liveChatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#2563eb' },
  liveChatLine: { color: '#cbd5e1', fontSize: 13, lineHeight: 18 },
  liveChatLineMine: { color: '#fff', fontWeight: '700' },
  chatModerationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 6 },
  chatModerationButton: { width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(15, 23, 42, 0.64)', alignItems: 'center', justifyContent: 'center' },
  chatInputBar: { position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: '#475569', backgroundColor: 'rgba(2, 6, 23, 0.88)', padding: 6 },
  chatInput: { flex: 1, minHeight: 40, color: '#fff', fontSize: 14, paddingHorizontal: 10, paddingVertical: 8 },
  giftButton: { width: 40, minHeight: 40, borderRadius: 11, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center' },
  giftButtonActive: { backgroundColor: '#7c3aed' },
  giftPanel: { position: 'absolute', left: 0, right: 0, bottom: 58, zIndex: 20, borderRadius: 16, borderWidth: 1, borderColor: '#475569', backgroundColor: '#0f172a', padding: 10, gap: 8, flexDirection: 'row', flexWrap: 'wrap', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  giftPanelHeader: { width: '100%', marginBottom: 2 },
  giftPanelTitle: { color: '#fff', fontSize: 14, fontWeight: '900' },
  giftPanelSubtitle: { color: '#94a3b8', fontSize: 11, fontWeight: '800', marginTop: 2 },
  giftCard: { width: '48.5%', minHeight: 58, borderRadius: 12, borderWidth: 1, borderColor: '#334155', backgroundColor: 'rgba(15, 23, 42, 0.96)', padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  giftCardFeatured: { width: '100%', minHeight: 68, borderColor: '#cbd5e1', backgroundColor: 'rgba(30, 41, 59, 0.98)' },
  giftCardIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  giftCardIconFeatured: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: '#f8fafc' },
  giftCardTitle: { color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 15 },
  giftCardPrice: { color: '#cbd5e1', fontSize: 10, fontWeight: '800', marginTop: 2, lineHeight: 13 },
  chatSendButton: { minHeight: 40, borderRadius: 11, backgroundColor: '#0F62FE', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  chatSendButtonDisabled: { opacity: 0.45 },
  chatSendText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  questionComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: '#1d4ed8', backgroundColor: 'rgba(30, 64, 175, 0.28)', padding: 6 },
  questionInput: { flex: 1, minHeight: 38, color: '#fff', fontSize: 13, paddingHorizontal: 9, paddingVertical: 7 },
  questionSendButton: { width: 38, minHeight: 38, borderRadius: 11, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
  questionList: { flex: 1, minHeight: 0 },
  questionListContent: { gap: 8 },
  questionCard: { borderRadius: 13, borderWidth: 1, borderColor: '#60a5fa', backgroundColor: 'rgba(37, 99, 235, 0.18)', padding: 10 },
  questionBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' },
  questionBadge: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#dbeafe', color: '#1d4ed8', fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3, textTransform: 'uppercase' },
  questionAuthor: { color: '#bfdbfe', fontSize: 11, fontWeight: '800' },
  questionAction: { minHeight: 24, borderRadius: 8, backgroundColor: 'rgba(15, 23, 42, 0.48)', paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 3 },
  questionActionText: { color: '#bfdbfe', fontSize: 11, fontWeight: '900' },
  questionText: { color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  liftQuestionButton: { marginTop: 9, alignSelf: 'flex-start', minHeight: 30, borderRadius: 10, backgroundColor: '#2563eb', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  liftQuestionText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  questionEmptyState: { borderRadius: 12, borderWidth: 1, borderColor: '#334155', backgroundColor: 'rgba(15, 23, 42, 0.58)', padding: 10 },
  questionEmptyText: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  guestModeBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#2563eb', padding: 10, marginTop: 4 },
  guestModeText: { color: '#fff', fontWeight: '900' },
  copyInviteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: '#60a5fa', backgroundColor: 'rgba(37, 99, 235, 0.28)', padding: 10 },
  copyInviteText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  liveExitButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(127,29,29,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.38)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  liveExitText: { color: '#fecaca', fontWeight: '900', fontSize: 14 },
});
