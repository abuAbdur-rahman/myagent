import { useCallback, useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { channelMessage, getAppVersion, installUpdate, type Update } from "../../lib/updater";

export interface AppUpdate {
  version: string;
  update: Update | null;
  checking: boolean;
  progress: number | null;
  status: string | null;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
}

export function useAppUpdate(): AppUpdate {
  const [version, setVersion] = useState("…");
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAppVersion().then((value) => {
      if (live) setVersion(value);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      update?.close().catch(() => undefined);
    },
    [update],
  );

  const checkNow = useCallback(async () => {
    setChecking(true);
    setStatus(null);
    try {
      const found = await check();
      setUpdate(found);
      if (!found) setStatus(`You're on the latest version (${version}).`);
    } catch (error) {
      setUpdate(null);
      setStatus(channelMessage(error));
    } finally {
      setChecking(false);
    }
  }, [version]);

  const install = useCallback(async () => {
    if (!update) return;
    setProgress(0);
    try {
      await installUpdate(update, (pct) => setProgress(pct));
    } catch (error) {
      setProgress(null);
      setStatus(channelMessage(error));
    }
  }, [update]);

  return { version, update, checking, progress, status, checkNow, install };
}
