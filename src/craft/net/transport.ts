/**
 * How messages get between players.
 *
 * Online play rides Supabase Realtime broadcast channels — no tables, no
 * migration, nothing stored; a room exists while someone is in it. Two browser
 * tabs on one device can also play together over BroadcastChannel ("this
 * device" in the multiplayer screen), which needs no network at all and is how
 * the multiplayer code is tested. The solo copy, which has no Supabase, plays
 * over the local network instead: a WebSocket to a relay the host's desktop
 * app runs (csc/desktop/relay.mjs).
 *
 * Messages are batched by the session to about eight a second per player —
 * well inside Realtime's per-project rate limits — and anything large (chunk
 * data) is split into parts under the broadcast payload limit.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { edition, GAME_NAME } from "../edition";

export interface NetMessage {
  t: string;
  /** Sender's client id. */
  from: string;
  /** Recipient; absent means everyone. */
  to?: string;
  [key: string]: unknown;
}

export type LinkKind = "online" | "device" | "lan";

export interface Transport {
  readonly kind: LinkKind;
  send(msg: NetMessage): void;
  onMessage(cb: (msg: NetMessage) => void): void;
  /** Told when the link drops or comes back after it was first up. */
  onStatus?(cb: (live: boolean) => void): void;
  close(): void;
}

/** Room codes avoid letters that read alike (0/O, 1/I/L). */
export function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export class DeviceTransport implements Transport {
  readonly kind = "device" as const;
  private channel: BroadcastChannel;
  private handlers: ((msg: NetMessage) => void)[] = [];
  constructor(room: string) {
    if (typeof BroadcastChannel === "undefined") throw new Error("This browser cannot link tabs (no BroadcastChannel). Use online play instead.");
    this.channel = new BroadcastChannel(`blockcraft:${room}`);
    this.channel.onmessage = (e: MessageEvent<NetMessage>) => {
      for (const h of this.handlers) h(e.data);
    };
  }
  send(msg: NetMessage): void {
    this.channel.postMessage(msg);
  }
  onMessage(cb: (msg: NetMessage) => void): void {
    this.handlers.push(cb);
  }
  close(): void {
    this.channel.close();
  }
}

export class OnlineTransport implements Transport {
  readonly kind = "online" as const;
  private channel: RealtimeChannel;
  private handlers: ((msg: NetMessage) => void)[] = [];
  private queue: NetMessage[] = [];
  private live = false;
  private wasLive = false;
  private closing = false;
  private statusHandlers: ((live: boolean) => void)[] = [];
  readonly ready: Promise<void>;

  private client: NonNullable<ReturnType<typeof edition>["online"]>;

  constructor(room: string) {
    const client = edition().online;
    if (!client) throw new Error(`This copy of ${GAME_NAME} has no online server. Play over the local network (LAN) instead, or use the SAS-JACKY edition for online rooms.`);
    this.client = client;
    this.channel = client.channel(`blockcraft:${room}`, { config: { broadcast: { self: false, ack: false } } });
    this.channel.on("broadcast", { event: "m" }, ({ payload }) => {
      for (const h of this.handlers) h(payload as NetMessage);
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Could not reach the online server in 12 seconds. Check your connection, or play with tabs on this device.")), 12000);
      this.channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          this.live = true;
          // The client rejoins by itself after a network drop; say so, and send what waited.
          if (this.wasLive) for (const h of this.statusHandlers) h(true);
          this.wasLive = true;
          for (const m of this.queue.splice(0)) this.send(m);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          if (this.live && !this.closing) for (const h of this.statusHandlers) h(false);
          this.live = false;
          reject(new Error(status === "TIMED_OUT"
            ? "The online server did not answer in time. Try again in a moment."
            : `The online server refused the room (${err?.message ?? status}). Realtime may be switched off for this project.`));
        }
      });
    });
    // A rejected ready promise nobody awaited should not surface as an unhandled rejection.
    this.ready.catch(() => {});
  }

  send(msg: NetMessage): void {
    if (!this.live) {
      // Held while reconnecting; a long outage keeps only the newest, since positions go stale anyway.
      this.queue.push(msg);
      if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 400);
      return;
    }
    void this.channel.send({ type: "broadcast", event: "m", payload: msg });
  }
  onMessage(cb: (msg: NetMessage) => void): void {
    this.handlers.push(cb);
  }
  onStatus(cb: (live: boolean) => void): void {
    this.statusHandlers.push(cb);
  }
  close(): void {
    this.closing = true;
    this.live = false;
    void this.client.removeChannel(this.channel);
  }
}

/** The port a LAN relay listens on unless told otherwise (one above the genre's traditional 25565). */
export const LAN_PORT = 25580;

/**
 * What someone typed as the host's address, as host:port — or null when it
 * cannot be one. Accepts a bare IP or name, with or without a port or ws://.
 */
export function normalizeLanAddress(text: string): string | null {
  const t = text.trim().replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
  if (!t) return null;
  const v6 = /^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/.exec(t);
  if (v6) return `[${v6[1]}]:${v6[2] ?? LAN_PORT}`;
  const m = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(t);
  if (!m) return null;
  const port = Number(m[2] ?? LAN_PORT);
  if (port < 1 || port > 65535) return null;
  return `${m[1]}:${port}`;
}

/** The relay's socket for one room. */
export function lanUrl(address: string, room: string): string {
  return `ws://${address}/r/${room}`;
}

/**
 * LAN play: a WebSocket to the relay on the host's machine. The relay only
 * fans messages out to the room — the host's game is still the authority —
 * so this is the same shape as the online link: queue while down, say when
 * the link drops and when it is back, and reconnect by itself.
 */
export class LanTransport implements Transport {
  readonly kind = "lan" as const;
  private socket: WebSocket | null = null;
  private handlers: ((msg: NetMessage) => void)[] = [];
  private statusHandlers: ((live: boolean) => void)[] = [];
  private queue: NetMessage[] = [];
  private live = false;
  private wasLive = false;
  private closing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  readonly ready: Promise<void>;

  constructor(readonly address: string, readonly room: string) {
    if (typeof WebSocket === "undefined") throw new Error("This browser cannot open network sockets, so it cannot play over the local network.");
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${address} did not answer in 8 seconds. Check the address, that the host has opened their world to LAN, and that a firewall on the host is not blocking port ${address.split(":").pop()}.`));
        this.close();
      }, 8000);
      this.connect(() => { clearTimeout(timer); resolve(); }, (why) => { clearTimeout(timer); reject(new Error(why)); });
    });
    this.ready.catch(() => {});
  }

  private connect(opened?: () => void, failed?: (why: string) => void): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(lanUrl(this.address, this.room));
    } catch (err) {
      failed?.(`"${this.address}" is not an address this game can dial: ${(err as Error).message}`);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.live = true;
      this.attempts = 0;
      if (this.wasLive) for (const h of this.statusHandlers) h(true);
      this.wasLive = true;
      for (const m of this.queue.splice(0)) this.send(m);
      opened?.();
    };
    socket.onmessage = (e: MessageEvent) => {
      let msg: NetMessage;
      try {
        msg = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return; // Not ours: the relay forwards only what players send, but a stray client could send anything.
      }
      if (msg && typeof msg.t === "string" && typeof msg.from === "string") for (const h of this.handlers) h(msg);
    };
    // Browsers fire error then close for a refused connection; some runtimes fire only error.
    // Either way this socket is finished once, and what happens next is decided here.
    let done = false;
    const down = () => {
      if (done) return;
      done = true;
      const was = this.live;
      this.live = false;
      if (this.closing) return;
      if (!this.wasLive) {
        failed?.(`Could not connect to ${this.address}. Check the address, that the host has opened their world to LAN, and that both computers are on the same network.`);
        return;
      }
      if (was) for (const h of this.statusHandlers) h(false);
      // Back off to every 5 s; the session's own host timeout decides when to give up.
      this.retry = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.attempts++));
    };
    socket.onclose = down;
    socket.onerror = down;
  }

  send(msg: NetMessage): void {
    if (!this.live || !this.socket) {
      this.queue.push(msg);
      if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 400);
      return;
    }
    this.socket.send(JSON.stringify(msg));
  }
  onMessage(cb: (msg: NetMessage) => void): void {
    this.handlers.push(cb);
  }
  onStatus(cb: (live: boolean) => void): void {
    this.statusHandlers.push(cb);
  }
  close(): void {
    this.closing = true;
    this.live = false;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }
}

/** Largest single broadcast we send; chunk data above this is split. */
export const MAX_PART = 48 * 1024;

/**
 * A fresh identity for one connection. Separate from clientId() because two
 * tabs of the same browser share localStorage: with one id, each would drop
 * the other's messages as its own echo.
 */
export function connectionId(): string {
  return `n${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** This browser's stable player id — what a host files a guest's inventory and position under. */
export function clientId(): string {
  const key = "blockcraft.client.v1";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `c${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `c${Math.random().toString(36).slice(2, 12)}`;
  }
}
