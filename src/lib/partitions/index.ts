/** The partition layer's front door. Import from here, not from the files. */
export * from "./types";
export * from "./registry";
export * from "./budget";
export { PartitionService, BACKUP_PREFIX, type BackupInfo, type HealResult } from "./service";
export { checksum, createPartitionStore, MemoryPartitionStore, IndexedDbPartitionStore } from "./store";

import { PartitionService } from "./service";
import { createPartitionStore } from "./store";

/** The instance the app writes through. */
export const partitions = new PartitionService(createPartitionStore());
