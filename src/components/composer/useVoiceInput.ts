import { useEffect, useRef, useState, type RefObject } from "react";
import { audioTranscribe, formatInvokeError } from "../../lib/api";
import { toast } from "../../lib/toast";
import { pcmRms, VoiceRecorder } from "../../lib/voice";

async function beginCapture(held: RefObject<boolean>): Promise<VoiceRecorder | null> {
  const recorder = new VoiceRecorder();
  await recorder.start();
  if (!held.current) {
    await recorder.cancel();
    return null;
  }
  return recorder;
}

async function transcribeCapture(recorder: VoiceRecorder): Promise<string> {
  const capture = await recorder.finish();
  if (pcmRms(capture.pcm) < 0.008) return "";
  const { text } = await audioTranscribe(Array.from(capture.pcm), capture.sampleRate);
  return text;
}

function canStart(busy: boolean, transcribing: boolean, held: boolean): boolean {
  return !busy && !transcribing && !held;
}

function blocked(starting: boolean, busy: boolean, transcribing: boolean, held: boolean): boolean {
  return starting || !canStart(busy, transcribing, held);
}

export function useVoiceInput(append: (text: string) => void, busy: boolean) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const heldRef = useRef(false);
  const startingRef = useRef(false);

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
    try {
      const recorder = await beginCapture(heldRef);
      if (!recorder) return;
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      heldRef.current = false;
      toast(formatInvokeError(error));
    } finally {
      startingRef.current = false;
    }
  };

  const stop = async () => {
    heldRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    const active: VoiceRecorder = recorder;
    setTranscribing(true);
    try {
      const text = await transcribeCapture(active);
      if (!text) {
        toast("No speech detected");
        return;
      }
      append(text);
    } catch (error) {
      toast(formatInvokeError(error));
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

  return { recording, transcribing, start, stop, cancel };
}
