import { invokeEdgeFunction } from "./functionsClient";

// Loosely mirrors What3Words' own published regex for detecting a
// 3-word address in free text: three words separated by full stops, each
// word made of letters (no digits/punctuation/whitespace within a word),
// optionally prefixed by 1-3 slashes (their official "///" convention).
// This intentionally over-matches slightly (real w3w restricts to actual
// dictionary words) — invalid combinations still get caught cleanly by
// the API returning a "no such address" error.
const W3W_PATTERN = /^\/{0,3}\p{L}+\.\p{L}+\.\p{L}+$/u;

export function isWhat3WordsAddress(text: string): boolean {
  return W3W_PATTERN.test(text.trim());
}

export function formatWhat3Words(words: string): string {
  return `///${words.replace(/^\/+/, "")}`;
}

export type What3WordsResult = {
  words: string;
  lat: number;
  lng: number;
  nearestPlace: string | null;
  country: string | null;
};

async function invokeConvert(body: Record<string, unknown>): Promise<What3WordsResult> {
  const { data, error } = await invokeEdgeFunction("what3words-convert", { body }, 12_000);
  if (error) {
    let detail = error.message;
    try {
      const respBody = await error.context?.json();
      if (respBody?.error) detail = respBody.error;
    } catch {
      // context wasn't JSON — keep the generic message
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data as What3WordsResult;
}

// Resolves a typed what3words address ("filled.count.soap" or
// "///filled.count.soap") to coordinates. Throws with a
// user-presentable message if the address doesn't exist.
export async function convertToCoordinates(words: string): Promise<What3WordsResult> {
  return invokeConvert({ mode: "to-coordinates", words: words.replace(/^\/+/, "") });
}

// Resolves a coordinate to its what3words address — used after a pin
// drop so the rider gets a short, shareable, exact location tag instead
// of (or alongside) whatever reverse-geocoding managed to find. This is
// best-effort by design: callers should treat a thrown error as "no
// what3words tag available this time" and proceed without blocking on
// it, since reverse-geocoding already has its own fallback.
export async function convertToWords(lat: number, lng: number): Promise<What3WordsResult> {
  return invokeConvert({ mode: "to-words", lat, lng });
}
