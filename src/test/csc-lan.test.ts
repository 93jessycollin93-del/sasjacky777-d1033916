// @vitest-environment node
// Node's own WebSocket and sockets: the relay is a Node program, and the
// transport is exercised against it for real rather than against a fake.
import { afterEach, describe, expect, it } from "vitest";
import { decodeFrames, encodeFrame, startRelay } from "../../csc/desktop/relay.mjs";
import { LanTransport, normalizeLanAddress, type NetMessage } from "@/craft/net/transport";

type Relay = { port: number; addresses: string[]; close: () => Promise<void> };

const open: { close(): void }[] = [];
let relay: Relay | null = null;

afterEach(async () => {
  for (const t of open.splice(0)) t.close();
  await relay?.close();
  relay = null;
});

function link(port: number, room: string): LanTransport {
  const t = new LanTransport(`127.0.0.1:${port}`, room);
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

describe("LAN play", () => {
  it("carries a message to everyone else in the same world, and to no one in another", async () => {
    relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const host = link(relay.port, "K7QM3X");
    const guest = link(relay.port, "K7QM3X");
    const stranger = link(relay.port, "ZZZZ22");
    await Promise.all([host.ready, guest.ready, stranger.ready]);
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
    const a = link(relay.port, "ROOM1");
    const b = link(relay.port, "ROOM1");
    await Promise.all([a.ready, b.ready]);
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
    const a = link(port, "ROOM1");
    await a.ready;
    const status: boolean[] = [];
    a.onStatus((live) => status.push(live));

    await relay.close();
    await until(() => status.length === 1);
    expect(status).toEqual([false]);
    a.send({ t: "chat", from: "a", text: "sent while the relay was down" });

    relay = await startRelay({ port, host: "127.0.0.1" });
    const b = link(port, "ROOM1");
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
