"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Sparkles, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { structureTranscript, applyStructuredJob } from "./voice-actions";
import type { StructuredJob } from "@/lib/ai-job-from-voice";

type Phase = "idle" | "listening" | "processing" | "review" | "applying" | "done" | "error";

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: { isFinal: boolean; [index: number]: { transcript: string } }[] & { length: number } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function VoiceNotes({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [structured, setStructured] = useState<StructuredJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  function startListening() {
    setError(null);
    setTranscript("");
    setInterim("");
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setError("Speech recognition not supported in this browser. Try Chrome or Safari.");
      setPhase("error");
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-GB";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + " ";
        else interimText += result[0].transcript;
      }
      if (finalText) setTranscript((prev) => prev + finalText);
      setInterim(interimText);
    };
    recognition.onerror = (event) => {
      const isHttps = window.location.protocol === "https:" || window.location.hostname === "localhost";
      if (event.error === "not-allowed") {
        setError(
          isHttps
            ? "Microphone blocked. Click the lock icon in the address bar → Site settings → set Microphone to Allow, then reload."
            : "Microphone requires HTTPS. You're on HTTP — try the production URL or localhost.",
        );
      } else if (event.error === "no-speech") {
        setError("No speech detected. Try speaking louder or closer to the mic.");
      } else if (event.error === "audio-capture") {
        setError("No microphone found on this device.");
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setPhase("error");
    };
    recognition.onend = () => {
      setInterim("");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setPhase("listening");
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setInterim("");
    setPhase("idle");
  }

  function handleStructure() {
    if (!transcript.trim()) {
      setError("Nothing to process — speak some notes first.");
      return;
    }
    setError(null);
    setPhase("processing");
    startTransition(async () => {
      const result = await structureTranscript(jobId, transcript.trim());
      if ("error" in result) {
        setError(result.error);
        setPhase("error");
        return;
      }
      setStructured(result.data);
      setPhase("review");
    });
  }

  function handleApply(appendToNotes: boolean) {
    if (!structured) return;
    setError(null);
    setPhase("applying");
    startTransition(async () => {
      const result = await applyStructuredJob(jobId, structured, appendToNotes);
      if ("error" in result) {
        setError(result.error);
        setPhase("error");
        return;
      }
      setPhase("done");
      setTimeout(() => {
        reset();
        router.refresh();
      }, 1200);
    });
  }

  function reset() {
    setTranscript("");
    setInterim("");
    setStructured(null);
    setError(null);
    setPhase("idle");
  }

  function removeItem(idx: number) {
    if (!structured) return;
    setStructured({ ...structured, items: structured.items.filter((_, i) => i !== idx) });
  }

  if (supported === false) {
    return (
      <section className="rounded-lg border p-4 bg-muted/20">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <Mic className="h-4 w-4" /> Voice notes
        </h2>
        <p className="text-sm text-muted-foreground">
          Voice input not supported in this browser. Try Chrome, Edge, or Safari (iOS 14.5+).
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <Mic className="h-4 w-4" /> Voice notes
        <span className="ml-auto text-xs text-muted-foreground normal-case tracking-normal">
          Dictate, AI structures into items
        </span>
      </h2>

      {/* Recording controls */}
      {phase === "idle" && !structured && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Press the mic and speak naturally. Describe what you did — parts, labour, observations. Stop when done, then click <strong>Structure with AI</strong>.
          </p>
          <Button onClick={startListening} className="self-start">
            <Mic className="mr-2 h-4 w-4" /> Start recording
          </Button>
        </div>
      )}

      {phase === "listening" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
            </span>
            Recording…
          </div>
          <Button variant="outline" onClick={stopListening} className="self-start">
            <MicOff className="mr-2 h-4 w-4" /> Stop
          </Button>
        </div>
      )}

      {/* Transcript display */}
      {(transcript || interim) && phase !== "done" && (
        <div className="mt-3 rounded-md border bg-muted/20 p-3 text-sm">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Transcript</div>
          <div className="whitespace-pre-wrap">
            {transcript}
            <span className="text-muted-foreground italic">{interim}</span>
          </div>
        </div>
      )}

      {/* Structure button */}
      {phase === "idle" && transcript && !structured && (
        <div className="mt-3 flex gap-2">
          <Button onClick={handleStructure} disabled={pending}>
            <Sparkles className="mr-2 h-4 w-4" /> Structure with AI
          </Button>
          <Button variant="outline" onClick={reset}>
            Discard
          </Button>
          <Button variant="outline" onClick={startListening}>
            <Mic className="mr-2 h-4 w-4" /> Add more
          </Button>
        </div>
      )}

      {phase === "processing" && (
        <p className="mt-3 text-sm text-muted-foreground">AI is structuring your notes…</p>
      )}

      {/* Review */}
      {phase === "review" && structured && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Summary</div>
            <textarea
              value={structured.summary}
              onChange={(e) => setStructured({ ...structured, summary: e.target.value })}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Items to add ({structured.items.length})
            </div>
            <div className="rounded-md border divide-y">
              {structured.items.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No items extracted.</p>
              ) : structured.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground w-14 shrink-0">
                    {item.type}
                  </span>
                  <span className="flex-1 text-sm">{item.description}</span>
                  <span className="text-xs font-mono text-muted-foreground">x{item.quantity}</span>
                  <button
                    onClick={() => removeItem(i)}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label="Remove item"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Prices will be added after — defaults to £0.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleApply(true)} disabled={pending}>
              <Check className="mr-2 h-4 w-4" />
              Apply to job + append summary
            </Button>
            <Button variant="outline" onClick={() => handleApply(false)} disabled={pending}>
              Apply items only
            </Button>
            <Button variant="outline" onClick={reset} disabled={pending}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {phase === "applying" && (
        <p className="mt-3 text-sm text-muted-foreground">Applying to job card…</p>
      )}
      {phase === "done" && (
        <p className="mt-3 text-sm text-green-700 dark:text-green-400">Applied successfully.</p>
      )}

      {error && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-red-600">{error}</p>
          {phase === "error" && (
            <Button variant="outline" onClick={reset} className="self-start">
              Try again
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
