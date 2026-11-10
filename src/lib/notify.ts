import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let asked = false;

export async function notifyTurnDone(title: string, body: string): Promise<void> {
  if (typeof document === "undefined") return;
  if (typeof isPermissionGranted !== "function") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  let granted = await isPermissionGranted();
  if (!granted && !asked) {
    asked = true;
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  sendNotification({
    title,
    body: body.replace(/\s+/g, " ").trim().slice(0, 140) || "Your reply is ready.",
  });
}
