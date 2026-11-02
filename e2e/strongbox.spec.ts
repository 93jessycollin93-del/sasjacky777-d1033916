import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "../playwright-fixture";

/**
 * Strongbox (`public/strongbox.html`) is a vault, so the claims it makes are
 * the product. These drive it in a real browser — real WebCrypto, real
 * IndexedDB — and check each claim, including every way it was found failing
 * quietly when it arrived: a damaged backup wiping the vault it was meant to
 * restore, a self-test that compared one byte in 997 and said "every byte", a
 * "zero network calls" row that was a string, not a measurement.
 */

const PASSWORD = "correct horse battery";
const OTHER_PASSWORD = "a different passphrase";

type Backup = { items: Array<{ id: string }> } & Record<string, unknown>;

test.beforeEach(({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

async function open(page: Page, url = "/strongbox.html") {
  await page.goto(url);
  // Written once boot has read storage. Until then the lock screen shows its
  // static "Unlock" placeholder whether or not a vault exists.
  await expect(page.locator("#lockFoot")).not.toBeEmpty();
}

async function create(page: Page, password = PASSWORD) {
  await expect(page.locator("#lockTitle")).toHaveText("Create your vault");
  await page.fill("#pw", password);
  await page.fill("#pw2", password);
  await page.click("#bGo");
  await expect(page.locator("#lock")).toBeHidden({ timeout: 30_000 });
}

async function unlock(page: Page, password = PASSWORD) {
  await page.fill("#pw", password);
  await page.click("#bGo");
}

async function addNote(page: Page, title: string, body: string) {
  await page.click("#bNote");
  await page.fill("#nName", title);
  await page.fill("#nBody", body);
  await page.click("#nSave");
  await expect(page.locator("#list")).toContainText(title);
}

async function tab(page: Page, name: "vault" | "term" | "checks" | "about") {
  await page.click(`nav button[data-tab="${name}"]`);
}

async function exportBackup(page: Page): Promise<Backup> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#bExport")]);
  return JSON.parse(readFileSync(await download.path(), "utf8"));
}

/** Hands the page a backup file, the way picking one from Files does. */
async function pickBackup(page: Page, backup: unknown) {
  await page.setInputFiles("#importPick", {
    name: "backup.sbx",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
}

async function restore(page: Page, backup: unknown, password: string) {
  await pickBackup(page, backup);
  await page.fill("#rPw", password);
  await page.click("#rGo");
}

/** Whether `needle` appears anywhere in what the vault stored, as text or as bytes. */
function onDisk(page: Page, needle: string) {
  return page.evaluate(
    (text) =>
      new Promise<boolean>((resolve, reject) => {
        const target = new TextEncoder().encode(text);
        const has = (bytes: Uint8Array) => {
          outer: for (let i = 0; i + target.length <= bytes.length; i++) {
            for (let j = 0; j < target.length; j++) if (bytes[i + j] !== target[j]) continue outer;
            return true;
          }
          return false;
        };
        const walk = (value: unknown): boolean =>
          value instanceof Uint8Array
            ? has(value)
            : typeof value === "string"
              ? value.includes(text)
              : !!value && typeof value === "object" && Object.values(value).some(walk);
        const request = indexedDB.open("strongbox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const t = request.result.transaction(["meta", "items"], "readonly");
          const rows: unknown[] = [];
          for (const name of ["meta", "items"]) {
            const all = t.objectStore(name).getAll();
            all.onsuccess = () => rows.push(...all.result);
          }
          t.oncomplete = () => {
            request.result.close();
            resolve(rows.some(walk));
          };
        };
      }),
    needle,
  );
}

test.describe("Strongbox", () => {
  test("opens a note only with its password", async ({ page }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    await page.click("#bLock");

    await unlock(page, "not the password");
    await expect(page.locator("#lockMsg")).toHaveText("Wrong password.");
    await expect(page.locator("#lock")).toBeVisible();

    await unlock(page);
    await expect(page.locator("#lock")).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: /Diary/ }).click();
    await expect(page.locator("#vBody")).toHaveValue("the combination is 4-8-15");
  });

  test("keeps names and contents off the disk in the clear", async ({ page }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    await page.setInputFiles("#filePick", {
      name: "passport-scan.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("MRZ<<SECRET<<NUMBER"),
    });
    await expect(page.locator("#list")).toContainText("passport-scan.txt");

    for (const secret of ["Diary", "4-8-15", "passport-scan", "MRZ<<SECRET", PASSWORD]) {
      expect(await onDisk(page, secret), secret).toBe(false);
    }
  });

  test("refuses a tampered item instead of showing altered contents", async ({ page }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("strongbox");
          request.onsuccess = () => {
            const t = request.result.transaction("items", "readwrite");
            const store = t.objectStore("items");
            const all = store.getAll();
            all.onsuccess = () => {
              const [row] = all.result;
              row.bCt[0] ^= 1;
              store.put(row);
            };
            t.oncomplete = () => {
              request.result.close();
              resolve();
            };
            t.onerror = () => reject(t.error);
          };
        }),
    );
    await page.getByRole("button", { name: /Diary/ }).click();
    await expect(page.locator("#sheet")).toContainText("Could not decrypt");
  });

  test("passes its own self-test, byte for byte", async ({ page }) => {
    await open(page);
    await create(page);
    await tab(page, "checks");
    await page.click("#bSelfTest");
    await expect(page.locator("#stOut")).toContainText("SELF-TEST", { timeout: 30_000 });
    await expect(page.locator("#stOut")).toContainText("SELF-TEST PASSED");
    await tab(page, "vault");
    await expect(page.locator("#list .item")).toHaveCount(0);
  });

  test("fails the self-test on a single corrupted byte", async ({ page }) => {
    await open(page);
    await create(page);
    await page.evaluate(() => {
      const proto = SubtleCrypto.prototype as unknown as { decrypt: (...args: unknown[]) => Promise<ArrayBuffer> };
      const decrypt = proto.decrypt;
      proto.decrypt = async function (...args: unknown[]) {
        const out = await decrypt.apply(this, args);
        if (out.byteLength === 4 * 1048576) new Uint8Array(out)[1] ^= 0xff;
        return out;
      };
    });
    await tab(page, "checks");
    await page.click("#bSelfTest");
    await expect(page.locator("#stOut")).toContainText("SELF-TEST", { timeout: 30_000 });
    await expect(page.locator("#stOut")).toContainText("SELF-TEST FAILED");
  });

  test("restores a backup into a browser that has never seen it", async ({ page, browser }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    const backup = await exportBackup(page);
    expect(JSON.stringify(backup)).not.toContain("4-8-15");

    const elsewhere = await browser.newContext();
    const fresh = await elsewhere.newPage();
    fresh.on("dialog", (dialog) => dialog.accept());
    await open(fresh, new URL("/strongbox.html", page.url()).href);
    await expect(fresh.locator("#lockTitle")).toHaveText("Create your vault");
    await expect(fresh.locator("#bRestore")).toBeVisible();
    await restore(fresh, backup, PASSWORD);
    await expect(fresh.locator("#lock")).toBeHidden({ timeout: 30_000 });
    await fresh.getByRole("button", { name: /Diary/ }).click();
    await expect(fresh.locator("#vBody")).toHaveValue("the combination is 4-8-15");
    await elsewhere.close();
  });

  test("offers to restore a backup before a vault exists, and only then", async ({ page }) => {
    await open(page);
    await expect(page.locator("#bRestore")).toBeVisible();
    await create(page);
    await page.click("#bLock");
    await expect(page.locator("#lockTitle")).toHaveText("Unlock");
    await expect(page.locator("#bRestore")).toBeHidden();
  });

  test("leaves the vault alone when a backup is damaged", async ({ page }) => {
    await open(page);
    await create(page);
    await addNote(page, "Mine", "keep me");
    await pickBackup(page, { format: "strongbox-vault", v: 1 });
    await expect(page.locator("#toast")).toContainText("Nothing was changed");

    await open(page);
    await expect(page.locator("#lockTitle")).toHaveText("Unlock");
    await unlock(page);
    await expect(page.locator("#list")).toContainText("Mine", { timeout: 30_000 });
  });

  test("leaves the vault alone when the backup's password is wrong", async ({ page, browser }) => {
    const elsewhere = await browser.newContext();
    const theirs = await elsewhere.newPage();
    theirs.on("dialog", (dialog) => dialog.accept());
    await open(page);
    await open(theirs, new URL("/strongbox.html", page.url()).href);
    await create(theirs, OTHER_PASSWORD);
    await addNote(theirs, "Theirs", "not yours");
    const backup = await exportBackup(theirs);
    await elsewhere.close();

    await create(page);
    await addNote(page, "Mine", "keep me");
    await restore(page, backup, PASSWORD);
    await expect(page.locator("#rMsg")).toContainText("Wrong password for this backup");
    await page.click("#rCancel");
    await expect(page.locator("#list")).toContainText("Mine");

    await open(page);
    await unlock(page);
    await expect(page.locator("#list")).toContainText("Mine", { timeout: 30_000 });
  });

  test("will not run markup smuggled into a backup", async ({ page }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    const backup = await exportBackup(page);
    backup.items[0].id = `x"><img src=x onerror="window.__pwned=1">`;

    await pickBackup(page, backup);
    await expect(page.locator("#toast")).toContainText("Nothing was changed");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(page.locator("#list")).toContainText("Diary");
  });

  test("says which file failed instead of claiming they all saved", async ({ page }) => {
    await open(page);
    await create(page);
    await page.evaluate(() => {
      const proto = SubtleCrypto.prototype as unknown as { encrypt: (...args: unknown[]) => Promise<ArrayBuffer> };
      const encrypt = proto.encrypt;
      proto.encrypt = function (...args: unknown[]) {
        if ((args[2] as ArrayBufferView).byteLength === 1313) {
          return Promise.reject(new DOMException("simulated failure", "OperationError"));
        }
        return encrypt.apply(this, args);
      };
    });
    await page.setInputFiles("#filePick", [
      { name: "good.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
      { name: "bad.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(1313, 7) },
    ]);
    await expect(page.locator("#toast")).toContainText("saved");
    await expect(page.locator("#toast")).toContainText("bad.bin");
    await expect(page.locator("#list .item")).toHaveCount(1);
  });

  test("reports a note it could not save, and keeps the text", async ({ page }) => {
    await open(page);
    await create(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
        if (this.name === "items") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await page.click("#bNote");
    await page.fill("#nName", "Draft");
    await page.fill("#nBody", "words I would hate to lose");
    await page.click("#nSave");
    await expect(page.locator("#toast")).toContainText(/not saved/i);
    await expect(page.locator("#nBody")).toHaveValue("words I would hate to lose");
  });

  test("counts the requests it makes rather than asserting there are none", async ({ page }) => {
    await open(page);
    await create(page);
    await tab(page, "checks");
    const row = page.locator(".arow", { hasText: /Requests|Network calls/ });
    await expect(row).toContainText("PASS");

    await page.evaluate(() => fetch("/strongbox.html?probe").then((response) => response.text()));
    await page.click("#bRecheck");
    await expect(row).not.toContainText("PASS");
    await expect(row).toContainText("probe");
  });

  test("clears decrypted text off the screen when it locks", async ({ page }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    await tab(page, "term");
    await page.fill("#termIn", "cat Diary");
    await page.press("#termIn", "Enter");
    await expect(page.locator("#termOut")).toContainText("4-8-15");

    await page.fill("#termIn", "lock");
    await page.press("#termIn", "Enter");
    await expect(page.locator("#lock")).toBeVisible();
    await expect(page.locator("#termOut")).not.toContainText("4-8-15");
  });

  test("locks on return when the phone slept past the idle limit", async ({ page }) => {
    await page.clock.install();
    await open(page);
    await create(page);
    // A sleeping phone stops page timers, so the five-minute timeout never
    // fires. Only the wall clock moves — which is exactly what this does.
    await page.clock.setSystemTime(Date.now() + 10 * 60_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator("#lock")).toBeVisible();
  });

  test("keeps saving after the browser closes its storage connection", async ({ page }) => {
    await open(page);
    await create(page);
    // What Safari does to the IndexedDB connection of a page left in the background.
    await page.evaluate("db.close()");
    await addNote(page, "After", "written on a fresh connection");

    await open(page);
    await unlock(page);
    await expect(page.locator("#list")).toContainText("After", { timeout: 30_000 });
  });

  test("opens, and unlocks, with the network off once it has been visited", async ({ page, context }) => {
    await open(page);
    await create(page);
    await addNote(page, "Diary", "the combination is 4-8-15");
    await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, {
      timeout: 15_000,
    });

    await context.setOffline(true);
    await open(page);
    await unlock(page);
    await expect(page.locator("#list")).toContainText("Diary", { timeout: 30_000 });
  });
});
