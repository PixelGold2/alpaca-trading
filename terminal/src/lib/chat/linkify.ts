const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

export interface TextSegment {
  text: string;
  isLink: boolean;
}

/** Splits message text around URLs so the caller can render links as anchors without a markdown/HTML dependency. */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), isLink: false });
    segments.push({ text: match[0], isLink: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), isLink: false });
  return segments;
}
