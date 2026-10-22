export interface StorageUsage {
  db_bytes: number;
  documents_bytes: number;
  spill_bytes: number;
  files: number;
}

export interface StoragePart {
  key: "db" | "documents" | "spill";
  label: string;
  bytes: number;
}

export interface StorageShare {
  part: StoragePart;
  pct: number;
}

export function storageParts(usage: StorageUsage): StoragePart[] {
  return [
    { key: "db", label: "Database", bytes: usage.db_bytes },
    { key: "documents", label: "Documents", bytes: usage.documents_bytes },
    { key: "spill", label: "Spill", bytes: usage.spill_bytes },
  ];
}

export function storageTotal(usage: StorageUsage): number {
  return usage.db_bytes + usage.documents_bytes + usage.spill_bytes;
}

export function storageShares(parts: StoragePart[]): StorageShare[] {
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  if (total <= 0) return parts.map((part) => ({ part, pct: 0 }));
  return parts.map((part) => ({ part, pct: (part.bytes / total) * 100 }));
}
