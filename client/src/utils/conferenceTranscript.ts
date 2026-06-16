/** Minimal shapes shared by the live (atom) session and a saved (server) session. */
interface TranscriptSegment {
  text: string;
  timestamp?: string;
}

interface TranscriptSuggestion {
  text: string;
}

export interface TranscriptInput {
  title: string;
  createdAt?: string;
  systemSegments: TranscriptSegment[];
  micSegments: TranscriptSegment[];
  suggestions: TranscriptSuggestion[];
}

/** Localized section headings, supplied by the caller (which has `useLocalize`). */
export interface TranscriptLabels {
  system: string;
  mic: string;
  suggestions: string;
}

function renderSegments(segments: TranscriptSegment[]): string {
  return segments
    .filter((segment) => segment.text.trim())
    .map((segment) => (segment.timestamp ? `[${segment.timestamp}] ${segment.text}` : segment.text))
    .join('\n');
}

/** Builds a Markdown transcript of a conference session. */
export function buildTranscript(input: TranscriptInput, labels: TranscriptLabels): string {
  const parts: string[] = [`# ${input.title || 'Conference'}`];
  if (input.createdAt) {
    parts.push(`_${new Date(input.createdAt).toLocaleString()}_`);
  }

  const system = renderSegments(input.systemSegments);
  parts.push(`## ${labels.system}\n\n${system || '—'}`);

  const mic = renderSegments(input.micSegments);
  parts.push(`## ${labels.mic}\n\n${mic || '—'}`);

  const suggestions = input.suggestions
    .filter((suggestion) => suggestion.text.trim())
    .map((suggestion) => `- ${suggestion.text}`)
    .join('\n');
  parts.push(`## ${labels.suggestions}\n\n${suggestions || '—'}`);

  return parts.join('\n\n');
}

/** Filesystem-safe filename derived from a session title. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'conference';
}

/** Builds the transcript and triggers a browser download as a `.md` file. */
export function downloadTranscript(input: TranscriptInput, labels: TranscriptLabels): void {
  const markdown = buildTranscript(input, labels);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slugify(input.title)}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
