import { BACKEND_BASE } from '../utils/api/http';

type LiveSignalEvent =
  | 'live:join'
  | 'live:leave'
  | 'live:send-offer'
  | 'live:receive-offer'
  | 'live:send-answer'
  | 'live:receive-answer'
  | 'live:ice-candidate'
  | 'live:send-gift'
  | 'live:receive-gift'
  | 'live:viewer-count-update'
  | 'live:list-active'
  | 'live:active-streams'
  | 'VIDEO_READY';

type LiveSignalPayload = Record<string, unknown>;
type LiveSignalHandler<T extends LiveSignalPayload = LiveSignalPayload> = (payload: T) => void;

const resolveLiveSocketUrl = () => {
  const base = BACKEND_BASE.replace(/\/+$/, '');
  const wsBase = base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}/ws/live`;
};

class LiveSignalingSocket {
  private socket: WebSocket | null = null;
  private handlers = new Map<LiveSignalEvent, Set<LiveSignalHandler>>();
  private queue: { event: LiveSignalEvent; payload: LiveSignalPayload }[] = [];

  connect() {
    if (typeof WebSocket === 'undefined') return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.socket = new WebSocket(resolveLiveSocketUrl());
    this.socket.onopen = () => {
      const queued = [...this.queue];
      this.queue = [];
      queued.forEach(({ event, payload }) => this.emit(event, payload));
    };
    this.socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as { event?: LiveSignalEvent; payload?: LiveSignalPayload };
        if (!parsed.event) return;
        this.handlers.get(parsed.event)?.forEach((handler) => handler(parsed.payload || {}));
      } catch (error) {
        console.error('Live signaling message parse failed:', error);
      }
    };
    this.socket.onclose = () => {
      this.socket = null;
    };
    this.socket.onerror = (error) => {
      console.error('Live signaling socket error:', error);
    };
  }

  emit(event: LiveSignalEvent, payload: LiveSignalPayload) {
    this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push({ event, payload });
      return;
    }
    this.socket.send(JSON.stringify({ event, payload }));
  }

  on<T extends LiveSignalPayload>(event: LiveSignalEvent, handler: LiveSignalHandler<T>) {
    const handlers = this.handlers.get(event) || new Set<LiveSignalHandler>();
    handlers.add(handler as LiveSignalHandler);
    this.handlers.set(event, handlers);
    this.connect();
  }

  off<T extends LiveSignalPayload>(event: LiveSignalEvent, handler: LiveSignalHandler<T>) {
    this.handlers.get(event)?.delete(handler as LiveSignalHandler);
  }
}

export const liveSignalingSocket = new LiveSignalingSocket();
