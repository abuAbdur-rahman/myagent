import { useEffect, useRef, useState, type RefObject } from "react";
import { audioTranscribe, formatInvokeError } from "../../lib/api";
import { toast } from "../../lib/toast";
import {
  captureProblem,
  primeWorklet,
  trimSilence,
  VoiceRecorder,
  type CaptureProblem,
} from "../../lib/voice";

const PROBLEM_MESSAGES: Record<CaptureProblem, string> = {
  empty: "No audio was captured — check the microphone.",
  short: "Recording too short — hold the mic while you speak.",
  silent: "The microphone recorded silence — check the input device.",
};

const BACKEND_MESSAGES: Record<string, string> = {
  "no audio captured": PROBLEM_MESSAGES.empty,
  "recording too short": PROBLEM_MESSAGES.short,
  "no speech detected": "No speech detected — try again a little louder.",
  "voice is off": "Voice is off — enable it in Settings > Voice.",
  "voice model is missing": "Voice model missing — download it in Settings > Voice.",
  "microphone did not start": "The microphone did not start — check the input device.",
};

function describeError(error: unknown): string {
  const text = formatInvokeError(error);
  for (const [code, message] of Object.entries(BACKEND_MESSAGES)) {
    if (text.includes(code)) return message;
  }
  return text;
}

async function beginCapture(held: RefObject<boolean>): Promise<VoiceRecorder | null> {
  const recorder = new VoiceRecorder();
  await recorder.start();
  if (!held.current) {
    await recorder.cancel();
    return null;
  }
  return recorder;
}

async function transcribeCapture(recorder: VoiceRecorder): Promise<string | null> {
  const capture = await recorder.finish();
  const problem = captureProblem(capture.pcm, capture.sampleRate);
  if (problem) {
    toast(PROBLEM_MESSAGES[problem]);
    return null;
  }
  const pcm = trimSilence(capture.pcm, capture.sampleRate);
  const { text } = await audioTranscribe(Array.from(pcm), capture.sampleRate);
  const trimmed = text.trim();
  if (!trimmed) {
    toast("No speech detected");
    return null;
  }
  return trimmed;
}

function canStart(busy: boolean, transcribing: boolean, held: boolean): boolean {
  return !busy && !transcribing && !held;
}

function blocked(starting: boolean, busy: boolean, transcribing: boolean, held: boolean): boolean {
  return starting || !canStart(busy, transcribing, held);
}

export function useVoiceInput(append: (text: string) => void, busy: boolean) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const heldRef = useRef(false);
  const startingRef = useRef(false);

  useEffect(() => {
    try {
      void primeWorklet().catch(() => undefined);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    return () => {
      heldRef.current = false;
      void recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  const start = async () => {
    if (blocked(startingRef.current, busy, transcribing, heldRef.current)) return;
    startingRef.current = true;
    heldRef.current = true;
    setStarting(true);
    try {
      const recorder = await beginCapture(heldRef);
      if (!recorder) return;
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      heldRef.current = false;
      toast(describeError(error));
    } finally {
      setStarting(false);
      startingRef.current = false;
    }
  };

  const stop = async () => {
    heldRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) {
      if (startingRef.current) toast(PROBLEM_MESSAGES.short);
      return;
    }
    const active: VoiceRecorder = recorder;
    setTranscribing(true);
    try {
      const text = await transcribeCapture(active);
      if (!text) return;
      append(text);
    } catch (error) {
      toast(describeError(error));
    } finally {
      setTranscribing(false);
    }
  };

  const cancel = () => {
    heldRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    void recorder?.cancel();
  };

  return { recording, starting, transcribing, start, stop, cancel };
}
