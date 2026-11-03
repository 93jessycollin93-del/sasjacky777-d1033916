// @vitest-environment node
// Node's own WebSocket and sockets: the relay is a Node program, and the
// transport is exercised against it for real rather than against a fake.
import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { decodeFrames, encodeFrame, MAX_MISSES, originAllowed, startRelay } from "../../csc/desktop/relay.mjs";
import { LanTransport, normalizeLanAddress, type NetMessage } from "@/craft/net/transport";

type Relay = { port: number; addresses: string[]; close: () => Promise<void> };

const open: { close(): void }[] = [];
let relay: Relay | null = null;

afterEach(async () => {
  for (const t of open.splice(0)) t.close();
  await relay?.close();
  relay = null;
});

function link(port: number, room: string, role: "host" | "guest" = "guest"): LanTransport {
  const t = new LanTransport(`127.0.0.1:${port}`, room, role);
  open.push(t);
  return t;
}

function inbox(t: LanTransport): NetMessage[] {
  const got: NetMessage[] = [];
  t.onMessage((m) => got.push(m));
  return got;
}

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Asks the relay for a socket and reports only the status it answered with. */
function upgradeStatus(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1", port, path,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.on("upgrade", (_res, socket) => { socket.destroy(); resolve(101); });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end();
  });
}

describe("who the LAN relay lets in", () => {
  it("refuses a web page on the internet, and admits the game's own pages", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    expect(await upgradeStatus(relay.port, "/r/K7QM3X?role=host", { Origin: "https://evil.example.com" })).toBe(403);
    expect(await upgradeStatus(relay.port, "/r/K7QM3X?role=host", { Origin: "csc://app" })).toBe(101);
    expect(originAllowed("http://192.168.1.4:8080")).toBe(true);
    expect(originAllowed("http://8.8.8.8")).toBe(false);
  });

  it("lets a guest join only a world a host has opened", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    expect(await upgradeStatus(relay.port, "/r/NOTOPEN")).toBe(404);
    const host = link(relay.port, "OPEN22", "host");
    await host.ready;
    expect(await upgradeStatus(relay.port, "/r/OPEN22")).toBe(101);
  });

  it("stops an address that keeps guessing codes, before it can walk them", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const host = link(relay.port, "REAL22", "host");
    await host.ready;
    for (let i = 0; i < MAX_MISSES; i++) expect(await upgradeStatus(relay.port, `/r/GUESS${i}`)).toBe(404);
    // Even the right code is refused once the address is out of guesses.
    expect(await upgradeStatus(relay.port, "/r/REAL22")).toBe(429);
  });
});

describe("LAN play", () => {
  it("carries a message to everyone else in the same world, and to no one in another", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const host = link(relay.port, "K7QM3X", "host");
    const stranger = link(relay.port, "ZZZZ22", "host");
    await Promise.all([host.ready, stranger.ready]);
    const guest = link(relay.port, "K7QM3X");
    await guest.ready;
    const [hostGot, guestGot, strangerGot] = [inbox(host), inbox(guest), inbox(stranger)];

    host.send({ t: "b", from: "host", ops: [["st", 1, 2, 3]] });
    await until(() => guestGot.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(guestGot[0]).toEqual({ t: "b", from: "host", ops: [["st", 1, 2, 3]] });
    expect(hostGot).toEqual([]);
    expect(strangerGot).toEqual([]);
  });

  it("delivers a chunk-sized message intact, past the 64 KB frame boundary", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const a = link(relay.port, "ROOM1", "host");
    await a.ready;
    const b = link(relay.port, "ROOM1");
    await b.ready;
    const got = inbox(b);
    const data = "x".repeat(70_000);
    a.send({ t: "cp", from: "a", data });
    await until(() => got.length === 1);
    expect(got[0].data).toBe(data);
  });

  it("names the address when nothing is listening there, instead of hanging", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const port = relay.port;
    await relay.close();
    relay = null;
    const t = link(port, "ROOM1");
    await expect(t.ready).rejects.toThrow(`127.0.0.1:${port}`);
  });

  it("says when the link drops and when it is back, and sends what waited meanwhile", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const port = relay.port;
    const a = link(port, "ROOM1", "host");
    await a.ready;
    const status: boolean[] = [];
    a.onStatus((live) => status.push(live));

    await relay.close();
    await until(() => status.length === 1);
    expect(status).toEqual([false]);
    a.send({ t: "chat", from: "a", text: "sent while the relay was down" });

    relay = await startRelay({ port, host: "127.0.0.1" });
    // Another peer is already in the reopened world when a's link comes back.
    const b = link(port, "ROOM1", "host");
    await b.ready;
    const got = inbox(b);
    await until(() => status.length === 2, 8000);
    expect(status).toEqual([false, true]);
    await until(() => got.length === 1);
    expect(got[0].text).toBe("sent while the relay was down");
  }, 15000);

  it("answers a browser that opens the address with what it is", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const text = await (await fetch(`http://127.0.0.1:${relay.port}/`)).text();
    expect(text).toMatch(/CollinSurvivalCraft LAN relay/);
  });

  it("refuses a frame that claims to be larger than any game message, rather than waiting to buffer it", () => {
    const head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(1) << BigInt(40), 2);
    expect(decodeFrames(head).error).toMatch(/too large/);
    // And a normal frame round-trips through the codec.
    const { frames, rest } = decodeFrames(encodeFrame("hello"));
    expect(frames.map((f: { payload: Buffer }) => f.payload.toString())).toEqual(["hello"]);
    expect(rest.length).toBe(0);
  });

  it("reads the addresses people actually type", () => {
    expect(normalizeLanAddress("192.168.1.20")).toBe("192.168.1.20:25580");
    expect(normalizeLanAddress(" 192.168.1.20:3000 ")).toBe("192.168.1.20:3000");
    expect(normalizeLanAddress("ws://my-pc.local:25580/r/ABC")).toBe("my-pc.local:25580");
    expect(normalizeLanAddress("[fe80::1]:4000")).toBe("[fe80::1]:4000");
    expect(normalizeLanAddress("192.168.1.20:99999")).toBeNull();
    expect(normalizeLanAddress("not an address")).toBeNull();
    expect(normalizeLanAddress("")).toBeNull();
  });
});
