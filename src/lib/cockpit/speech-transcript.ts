// The Web Speech results collection is a current snapshot, not a stream of deltas.
// Reconstruct by stable result index; onresult may repeat final results or replace interim items.
export interface SpeechTranscriptResult {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}
export interface SpeechTranscriptEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechTranscriptResult;
  };
}
export interface SpeechTranscriptSnapshot {
  readonly finalText: string;
  readonly interimText: string;
  readonly text: string;
}
export function reconstructSpeechTranscript(
  before: string,
  event: SpeechTranscriptEvent,
): SpeechTranscriptSnapshot {
  const finalParts: string[] = [];
  const interimParts: string[] = [];
  // Read the entire indexed snapshot, including indices < resultIndex.
  // Chrome can repeat unchanged final results in subsequent onresult events.
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const content = result?.[0]?.transcript?.trim();
    if (!content) continue;
    (result.isFinal ? finalParts : interimParts).push(content);
  }
  const finalText = finalParts.join(" ");
  const interimText = interimParts.join(" ");
  return {
    finalText,
    interimText,
    text: [before.trimEnd(), finalText, interimText].filter(Boolean).join(" "),
  };
}
