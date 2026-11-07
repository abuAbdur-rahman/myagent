import { useSyncExternalStore } from "react";

let speakingId: string | null = null;
let speakToken = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string | null {
  return speakingId;
}

function finish(token: number, id: string): void {
  if (token !== speakToken || speakingId !== id) return;
  speakingId = null;
  emit();
}

export function canReadAloud(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopSpeaking(): void {
  speakToken += 1;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  speakingId = null;
  emit();
}

export function speechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speakMessage(id: string, markdown: string): void {
  if (!canReadAloud()) return;
  const text = speechText(markdown);
  if (!text) return;
  window.speechSynthesis.cancel();
  const token = ++speakToken;
  const utterance = new SpeechSynthesisUtterance(text);
  const voiceUri = localStorage.getItem("readAloudVoice");
  if (voiceUri) {
    const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === voiceUri);
    if (voice) utterance.voice = voice;
  }
  const rate = Number(localStorage.getItem("readAloudRate"));
  if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) utterance.rate = rate;
  utterance.onend = () => finish(token, id);
  utterance.onerror = () => finish(token, id);
  speakingId = id;
  emit();
  window.speechSynthesis.speak(utterance);
}

export function useSpeakingId(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function voices(): SpeechSynthesisVoice[] {
  if (!canReadAloud()) return [];
  return window.speechSynthesis.getVoices();
}
