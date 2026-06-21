import { expect, test } from '@playwright/test';

const user = {
  user_id: 'live_1080p_user',
  email: 'live-1080p@example.com',
  username: 'live1080p',
  profile_picture: '',
  followers_count: 4,
  following_count: 2,
  posts_count: 6,
  role: 'user',
};

const readMultipartField = (body: Buffer | null, name: string) => {
  if (!body) return null;
  const raw = body.toString('latin1');
  const match = raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)`));
  return match?.[1] ?? null;
};

test('desktop live recording uses chunked upload for 1080p clips', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop-only 1080p recording smoke coverage.');

  const chunkRequests: { auth: string | null; size: number; uploadId: string | null }[] = [];
  const completeRequests: { auth: string | null; uploadId: string | null; totalChunks: string | null }[] = [];
  const postUploads: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', (message) => {
    const text = message.text();
    const expectedMockNoise =
      text.includes("WebSocket connection to 'ws://127.0.0.1:8000/ws/live' failed") ||
      text.includes('Live signaling socket error:');
    if (message.type() === 'error' && !expectedMockNoise) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (payload: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

    if (path === '/auth/me' || path === '/users/me') return json(user);
    if (path === '/notifications/unread-count') return json({ unread_count: 0 });
    if (path === '/messages') return json({ unread_count: 0, threads: [] });
    if (path === '/media/posts') return json([]);

    if (path === '/posts' && request.method() === 'POST') {
      postUploads.push(request.url());
      return json({ detail: '1080p test should not use direct /posts upload' }, 500);
    }

    if (path === '/live-recordings/chunks' && request.method() === 'POST') {
      const body = request.postDataBuffer();
      chunkRequests.push({
        auth: request.headers().authorization ?? null,
        size: body?.length ?? 0,
        uploadId: readMultipartField(body, 'upload_id'),
      });
      return json({ ok: true });
    }

    if (path === '/live-recordings/chunks/complete' && request.method() === 'POST') {
      const body = request.postDataBuffer();
      completeRequests.push({
        auth: request.headers().authorization ?? null,
        uploadId: readMultipartField(body, 'upload_id'),
        totalChunks: readMultipartField(body, 'total_chunks'),
      });
      return json({
        post_id: 'post_live_1080p_processing',
        type: 'live_recording',
        status: 'processing',
        title: 'Tallenne: #1080pTest',
        duration: 1,
        visibility: 'public',
      }, 202);
    }

    return json({});
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'live-1080p-token');

    const videoTrack = {
      kind: 'video',
      enabled: true,
      muted: false,
      readyState: 'live',
      stop: () => undefined,
      getSettings: () => ({ width: 1920, height: 1080, frameRate: 30, deviceId: 'fake-1080p-camera' }),
      getConstraints: () => ({ width: { ideal: 1920 }, height: { ideal: 1080 } }),
    };
    const audioTrack = {
      kind: 'audio',
      enabled: true,
      muted: false,
      readyState: 'live',
      stop: () => undefined,
      getSettings: () => ({ deviceId: 'fake-mic' }),
      getConstraints: () => ({}),
    };
    class MockMediaStream {
      tracks: unknown[];

      constructor(tracks: unknown[] = []) {
        this.tracks = tracks;
      }

      getTracks() {
        return this.tracks;
      }

      getVideoTracks() {
        return this.tracks.filter((track) => (track as { kind?: string }).kind === 'video');
      }

      getAudioTracks() {
        return this.tracks.filter((track) => (track as { kind?: string }).kind === 'audio');
      }
    }
    Object.defineProperty(window, 'MediaStream', {
      configurable: true,
      value: MockMediaStream,
    });
    const stream = new MockMediaStream([videoTrack, audioTrack]);

    class MockAudioContext {
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 32,
          getByteFrequencyData: (data: Uint8Array) => data.fill(24),
          disconnect: () => undefined,
        };
      }

      createMediaStreamSource() {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }

      close() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get() {
        return (this as HTMLMediaElement & { __yoslaSrcObject?: unknown }).__yoslaSrcObject ?? null;
      },
      set(value: unknown) {
        (this as HTMLMediaElement & { __yoslaSrcObject?: unknown }).__yoslaSrcObject = value;
      },
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          (window as typeof window & { __yoslaRequestedMediaConstraints?: MediaStreamConstraints }).__yoslaRequestedMediaConstraints = constraints;
          return stream;
        },
        enumerateDevices: async () => [
          { kind: 'videoinput', deviceId: 'fake-1080p-camera', label: 'Fake 1080p Camera' },
          { kind: 'audioinput', deviceId: 'fake-mic', label: 'Fake Microphone' },
        ],
      },
    });

    class MockRTCPeerConnection {
      localDescription: RTCSessionDescriptionInit | null = null;
      onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      connectionState: RTCPeerConnectionState = 'connected';

      addTrack() {
        return {};
      }

      async createOffer() {
        return { type: 'offer', sdp: 'mock-offer' } as RTCSessionDescriptionInit;
      }

      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description;
      }

      async setRemoteDescription() {
        return undefined;
      }

      async addIceCandidate() {
        return undefined;
      }

      close() {
        this.connectionState = 'closed';
      }
    }

    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: MockRTCPeerConnection,
    });

    class MockMediaRecorder extends EventTarget {
      static isTypeSupported = () => true;
      state: RecordingState = 'inactive';
      mimeType: string;
      videoBitsPerSecond: number;
      audioBitsPerSecond: number;
      onstart: ((event: Event) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;
      ondataavailable: ((event: BlobEvent) => void) | null = null;

      constructor(_stream: unknown, options?: MediaRecorderOptions) {
        super();
        this.mimeType = options?.mimeType || 'video/webm';
        this.videoBitsPerSecond = options?.videoBitsPerSecond || 0;
        this.audioBitsPerSecond = options?.audioBitsPerSecond || 0;
      }

      start() {
        this.state = 'recording';
        this.onstart?.(new Event('start'));
        this.emitChunk(420 * 1024);
      }

      requestData() {
        if (this.state === 'recording') {
          this.emitChunk(420 * 1024);
        }
      }

      stop() {
        if (this.state === 'inactive') return;
        this.emitChunk(420 * 1024);
        this.state = 'inactive';
        this.onstop?.(new Event('stop'));
      }

      private emitChunk(size: number) {
        const blob = new Blob([new Uint8Array(size)], { type: this.mimeType });
        const event = new Event('dataavailable') as BlobEvent;
        Object.defineProperty(event, 'data', { value: blob });
        this.ondataavailable?.(event);
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: MockMediaRecorder,
    });
  });

  await page.goto('/live?roomId=live_1080p_user&topic=%231080pTest', { waitUntil: 'networkidle' });

  await expect(page.locator('body')).toContainText('YOSLA Studio', { timeout: 15000 });
  await page.getByText('Full HD 1080p').click();

  await page.getByText('🔴 Aloita live-lähetys').click();
  await expect.poll(async () =>
    page.evaluate(() => (window as typeof window & { __yoslaRequestedMediaConstraints?: MediaStreamConstraints }).__yoslaRequestedMediaConstraints?.video)
  ).toBeTruthy();
  await expect(page.getByText('Tallenna klippi')).toBeEnabled({ timeout: 5000 });

  await page.getByText('Tallenna klippi').click();
  await expect(page.getByText('Lopeta tallennus')).toBeVisible({ timeout: 5000 });
  await page.getByText('Lopeta tallennus').click();

  await expect(page.getByText('Tallenne vastaanotettu. Video valmistuu Mediavirtaan taustalla.')).toBeVisible({ timeout: 10000 });

  expect(postUploads).toEqual([]);
  expect(chunkRequests.length).toBeGreaterThan(0);
  expect(completeRequests).toHaveLength(1);
  expect(chunkRequests.every((request) => request.auth === 'Bearer live-1080p-token')).toBe(true);
  expect(completeRequests[0].auth).toBe('Bearer live-1080p-token');
  expect(chunkRequests.every((request) => request.size > 0 && request.size <= 540 * 1024)).toBe(true);
  expect(completeRequests[0].uploadId).toBe(chunkRequests[0].uploadId);
  expect(completeRequests[0].totalChunks).toBe(String(chunkRequests.length));
  expect(consoleErrors).toEqual([]);
});
