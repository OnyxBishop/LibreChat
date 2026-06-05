import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechToTextMutation } from '~/data-provider';

export type RecorderSource = 'display' | 'mic';

interface UseConferenceRecorderParams {
  /** `display` captures system/tab audio (getDisplayMedia); `mic` captures the microphone. */
  source: RecorderSource;
  /** STT model to use (the Phase-A external Whisper model); empty = server default. */
  model: string;
  /** Optional STT mini-prompt to bias recognition (Whisper `prompt`). */
  sttPrompt: string;
  /** Called with each transcribed segment of speech. */
  onSegment: (text: string) => void;
  /** Called after each finalized (non-empty) segment — used to trigger auto-send. */
  onSilence?: () => void;
}

export type RecorderError = 'permission_denied' | 'no_system_audio' | 'unsupported' | null;

interface UseConferenceRecorderReturn {
  isRecording: boolean;
  error: RecorderError;
  start: () => Promise<void>;
  stop: () => void;
}

/** Silence longer than this (ms) after speech finalizes the current segment. */
const SILENCE_MS = 1500;
/** Below this analyser floor counts as silence. */
const SILENCE_DECIBELS = -45;
/** Ignore segments shorter than this (ms) — avoids posting clicks/noise. */
const MIN_SEGMENT_MS = 700;
/** Force-finalize a segment that runs this long without a pause (ms). */
const MAX_SEGMENT_MS = 20000;

function getBestSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav',
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'audio/webm';
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) {
    return 'm4a';
  }
  if (mimeType.includes('ogg')) {
    return 'ogg';
  }
  if (mimeType.includes('wav')) {
    return 'wav';
  }
  return 'webm';
}

/**
 * Captures one audio source and emits transcribed segments. Unlike the chat mic hook
 * (which stops on the first silence), this keeps listening and segments speech on each
 * pause: it stops the MediaRecorder to flush a self-contained blob, POSTs it to the
 * Phase-A model-aware STT route, then immediately starts the next segment.
 */
export default function useConferenceRecorder({
  source,
  model,
  sttPrompt,
  onSegment,
  onSilence,
}: UseConferenceRecorderParams): UseConferenceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<RecorderError>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  const activeRef = useRef(false);
  const finalizingRef = useRef(false);
  const hasSpeechRef = useRef(false);
  const lastSoundRef = useRef(0);
  const segmentStartRef = useRef(0);

  /** Latest callbacks/params, kept in a ref so the long-lived loop never reads stale values. */
  const cbRef = useRef({ onSegment, onSilence, model, sttPrompt });
  cbRef.current = { onSegment, onSilence, model, sttPrompt };

  const { mutate: processAudio } = useSpeechToTextMutation({
    onSuccess: (data) => {
      const text = (data?.text ?? '').trim();
      if (text) {
        cbRef.current.onSegment(text);
        cbRef.current.onSilence?.();
      }
    },
  });

  const postSegment = useCallback(
    (blob: Blob) => {
      if (blob.size === 0) {
        return;
      }
      const formData = new FormData();
      formData.append('audio', blob, `audio.${getFileExtension(mimeRef.current)}`);
      if (cbRef.current.model) {
        formData.append('model', cbRef.current.model);
      }
      if (cbRef.current.sttPrompt) {
        formData.append('prompt', cbRef.current.sttPrompt);
      }
      processAudio(formData);
    },
    [processAudio],
  );

  const startSegment = useCallback(() => {
    if (!streamRef.current || !activeRef.current) {
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: mimeRef.current });
    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });
    recorder.addEventListener('stop', () => {
      const hadSpeech = hasSpeechRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      chunksRef.current = [];
      if (hadSpeech) {
        postSegment(blob);
      }
      finalizingRef.current = false;
      if (activeRef.current) {
        startSegment();
      }
    });
    recorderRef.current = recorder;
    hasSpeechRef.current = false;
    const now = Date.now();
    segmentStartRef.current = now;
    lastSoundRef.current = now;
    recorder.start();
  }, [postSegment]);

  const finalizeSegment = useCallback(() => {
    if (finalizingRef.current) {
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      finalizingRef.current = true;
      recorder.stop();
    }
  }, []);

  const monitorSilence = useCallback(
    (stream: MediaStream) => {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.minDecibels = SILENCE_DECIBELS;
      sourceNode.connect(analyser);

      const domainData = new Uint8Array(analyser.frequencyBinCount);

      const detect = () => {
        analyser.getByteFrequencyData(domainData);
        const soundDetected = domainData.some((value) => value > 0);
        const now = Date.now();
        if (soundDetected) {
          lastSoundRef.current = now;
          hasSpeechRef.current = true;
        }
        const silenceFor = now - lastSoundRef.current;
        const segmentAge = now - segmentStartRef.current;
        const pausedAfterSpeech =
          hasSpeechRef.current && silenceFor > SILENCE_MS && segmentAge > MIN_SEGMENT_MS;
        const tooLong = segmentAge > MAX_SEGMENT_MS;
        if (pausedAfterSpeech || tooLong) {
          finalizeSegment();
        }
        rafRef.current = window.requestAnimationFrame(detect);
      };

      rafRef.current = window.requestAnimationFrame(detect);
    },
    [finalizeSegment],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    hasSpeechRef.current = false;
    finalizingRef.current = false;
    setIsRecording(false);
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) {
      return;
    }
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setError('unsupported');
      return;
    }
    try {
      let stream: MediaStream;
      if (source === 'display') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const audioTracks = display.getAudioTracks();
        if (audioTracks.length === 0) {
          display.getTracks().forEach((track) => track.stop());
          setError('no_system_audio');
          return;
        }
        display.getVideoTracks().forEach((track) => track.stop());
        stream = new MediaStream(audioTracks);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }

      streamRef.current = stream;
      mimeRef.current = getBestSupportedMimeType();
      activeRef.current = true;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => stop());
      monitorSilence(stream);
      startSegment();
      setIsRecording(true);
    } catch {
      setError('permission_denied');
    }
  }, [source, monitorSilence, startSegment, stop]);

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isRecording, error, start, stop };
}
