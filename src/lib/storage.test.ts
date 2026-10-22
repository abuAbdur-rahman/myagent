import { describe, expect, it } from "vitest";

import { storageParts, storageShares, storageTotal, type StorageUsage } from "./storage";

const USAGE: StorageUsage = {
  db_bytes: 1_000_000,
  documents_bytes: 400_000,
  spill_bytes: 100_000,
  files: 7,
};

describe("storageParts", () => {
  it("labels the three places bytes live", () => {
    expect(storageParts(USAGE).map((part) => part.label)).toEqual([
      "Database",
      "Documents",
      "Spill",
    ]);
  });
});

describe("storageTotal", () => {
  it("adds every part", () => {
    expect(storageTotal(USAGE)).toBe(1_500_000);
  });

  it("is zero for an empty app", () => {
    expect(storageTotal({ db_bytes: 0, documents_bytes: 0, spill_bytes: 0, files: 0 })).toBe(0);
  });
});

describe("storageShares", () => {
  it("gives each part its share of the whole", () => {
    const shares = storageShares(storageParts(USAGE));
    expect(shares.map((share) => Math.round(share.pct))).toEqual([67, 27, 7]);
  });

  it("adds up to a hundred", () => {
    const total = storageShares(storageParts(USAGE)).reduce((sum, share) => sum + share.pct, 0);
    expect(total).toBeCloseTo(100);
  });

  it("does not divide by zero when nothing is stored", () => {
    const shares = storageShares(
      storageParts({ db_bytes: 0, documents_bytes: 0, spill_bytes: 0, files: 0 }),
    );
    expect(shares.map((share) => share.pct)).toEqual([0, 0, 0]);
  });
});
