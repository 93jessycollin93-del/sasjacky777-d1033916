/**
 * CollinSurvivalCraft's LAN relay: a WebSocket server that forwards every
 * message a player sends to the other players in the same world.
 *
 * It holds no game state and decides nothing — the hosting player's game is
 * the authority, exactly as it is over Supabase Realtime in the SAS-JACKY
 * edition — so the relay is a fan-out and nothing more. That is why it can be
 * this small, and why it has no dependencies: the desktop app starts one in
 * its main process, and anyone can run one on any machine with Node:
 *
 *     node relay.mjs            # port 25580
 *     node relay.mjs --port 3000
 *
 * Players reach a world at ws://<address>:<port>/r/<WORLD CODE>.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { pathToFileURL } from "node:url";

export const DEFAULT_PORT = 25580;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
// The game splits chunk data into 48 KB parts; anything near a megabyte is not a player.
const MAX_MESSAGE = 1 << 20;
// A guest whose connection cannot keep up is dropped rather than buffered without end.
const MAX_BUFFERED = 8 << 20;

/** The Sec-WebSocket-Accept answer to a client's key (RFC 6455 §4.2.2). */
export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

/** One unmasked frame, as a server sends it. */
export function encodeFrame(payload, opcode = 1) {
  const body = typeof payload === "string" ? Buffer.from(payload) : payload;
  const n = body.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, body]);
}

/**
 * Takes every complete frame off the front of `buf`. What is left is the
 * start of a frame still arriving. A frame declaring more than MAX_MESSAGE is
 * an error, not a wait: the connection is closed before it can fill memory.
 */
export function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      const big = buf.readBigUInt64BE(p);
      if (big > BigInt(MAX_MESSAGE)) return { frames, rest: Buffer.alloc(0), error: "message too large" };
      len = Number(big);
      p += 8;
    }
    if (len > MAX_MESSAGE) return { frames, rest: Buffer.alloc(0), error: "message too large" };
    const masked = (b1 & 0x80) !== 0;
    if (masked && buf.length - p < 4) break;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

/** This machine's IPv4 addresses on its networks — what a friend types to join. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if ((a.family === "IPv4" || a.family === 4) && !a.internal) out.push(a.address);
  }
  return out;
}

/** World codes as the game makes them (normalizeRoomCode in src/craft/net/transport.ts). */
const ROOM = /^\/r\/([A-Z0-9]{1,12})$/;

/**
 * Starts a relay. Resolves once it is listening, with the port it got (pass
 * port 0 for any free one) and a close() that disconnects everyone.
 */
export function startRelay({ port = DEFAULT_PORT, host = "0.0.0.0", log = () => {} } = {}) {
  /** room → the sockets in it */
  const rooms = new Map();
  const sockets = new Set();

  const server = createServer((req, res) => {
    // Opening the address in a browser should say what this is, not hang.
    let players = 0;
    for (const set of rooms.values()) players += set.size;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(`CollinSurvivalCraft LAN relay — ${players} player${players === 1 ? "" : "s"} in ${rooms.size} world${rooms.size === 1 ? "" : "s"}.\nJoin from the game: Multiplayer → LAN.\n`);
  });

  server.on("upgrade", (req, socket) => {
    const path = new URL(req.url ?? "/", "http://relay").pathname;
    const room = ROOM.exec(path)?.[1];
    const key = req.headers["sec-websocket-key"];
    if (!room || typeof key !== "string" || String(req.headers.upgrade).toLowerCase() !== "websocket") {
      socket.end("HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\nExpected a WebSocket at /r/<WORLD CODE>.\n");
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    sockets.add(socket);
    let members = rooms.get(room);
    if (!members) rooms.set(room, (members = new Set()));
    members.add(socket);
    log(`joined ${room} (${members.size} in the world)`);

    let pending = Buffer.alloc(0);
    let parts = [];
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      sockets.delete(socket);
      members.delete(socket);
      if (members.size === 0) rooms.delete(room);
      log(`left ${room}`);
    };
    const close = (code) => {
      const body = Buffer.alloc(2);
      body.writeUInt16BE(code, 0);
      socket.end(encodeFrame(body, 8));
      leave();
    };

    socket.on("data", (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const { frames, rest, error } = decodeFrames(pending);
      pending = rest;
      for (const f of frames) {
        if (f.opcode === 8) return close(1000);
        if (f.opcode === 9) { socket.write(encodeFrame(f.payload, 10)); continue; }
        if (f.opcode === 10) continue;
        parts.push(f.payload);
        if (!f.fin) continue;
        const message = parts.length === 1 ? parts[0] : Buffer.concat(parts);
        parts = [];
        const frame = encodeFrame(message, 1);
        for (const other of members) {
          if (other === socket || other.destroyed) continue;
          if (other.writableLength > MAX_BUFFERED) { other.destroy(); continue; }
          other.write(frame);
        }
      }
      if (error) close(1009);
    });
    socket.on("close", leave);
    socket.on("error", leave);
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(err.code === "EADDRINUSE"
        ? new Error(`Port ${port} is already in use — another copy of the game or relay is running. Close it, or pick another port.`)
        : err);
    });
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        addresses: lanAddresses(),
        close: () => new Promise((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

// Run directly: `node relay.mjs [--port N]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : DEFAULT_PORT;
  startRelay({ port, log: (m) => console.log(`[relay] ${m}`) }).then(
    (r) => {
      console.log(`CollinSurvivalCraft LAN relay listening on port ${r.port}.`);
      console.log(r.addresses.length
        ? `Friends join from Multiplayer → LAN with: ${r.addresses.map((a) => `${a}:${r.port}`).join("  or  ")}`
        : "This machine reports no network address; friends on other machines cannot reach it.");
    },
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
