// Local-first persistence for the Repair Bay: firmware version log and
// session captures. Device-local (localStorage) so it works fully offline and
// never ships hardware inventory anywhere it doesn't need to go.

export type FirmwareEntry = {
  id: string;
  componentId: string;
  currentVersion: string;
  latestSeen: string;
  checkedAt: string;
  note: string;
  status: "current" | "update-available" | "flashed" | "unknown";
};

export type SessionCapture = {
  id: string;
  createdAt: string;
  title: string;
  body: string;
};

const FW_KEY = "jackie.repair.firmware.v1";
const CAP_KEY = "jackie.repair.captures.v1";

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, rows: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* storage full or blocked — keep the UI alive */
  }
}

export const loadFirmware = () => read<FirmwareEntry>(FW_KEY);
export const saveFirmware = (rows: FirmwareEntry[]) => write(FW_KEY, rows);

export const loadCaptures = () => read<SessionCapture>(CAP_KEY);
export const saveCaptures = (rows: SessionCapture[]) => write(CAP_KEY, rows);

export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function exportJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
