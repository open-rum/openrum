import type { EnvelopeV1 } from "@openrum/protocol";
import type { CapturedEvent } from "../client.ts";

export const MAX_BATCH_EVENTS = 100;
export const MAX_RAW_BYTES = 1_048_576;
export const MAX_COMPRESSED_BYTES = 262_144;
export const MAX_KEEPALIVE_BYTES = 60 * 1_024;

export interface SDKIdentity {
  name: string;
  version: string;
}

export interface EncodedEnvelope {
  body: Uint8Array;
  rawBytes: number;
  compressed: boolean;
}

export interface CompressionRuntime {
  createGzipStream?: () => TransformStream<Uint8Array, Uint8Array>;
}

export function buildEnvelope(
  events: CapturedEvent[],
  sdk: SDKIdentity,
  sentAt = new Date().toISOString(),
): EnvelopeV1 {
  const first = events[0];
  if (!first) throw new Error("cannot build an empty envelope");
  return {
    schema_version: "1.0",
    sent_at: sentAt,
    sdk,
    context: first.context,
    events: events.map((item) => item.event),
  };
}

export async function encodeEnvelope(
  envelope: EnvelopeV1,
  runtime: CompressionRuntime = browserCompressionRuntime(),
): Promise<EncodedEnvelope> {
  const raw = new TextEncoder().encode(JSON.stringify(envelope));
  if (!runtime.createGzipStream || raw.byteLength < 1_024) {
    return { body: raw, rawBytes: raw.byteLength, compressed: false };
  }
  try {
    const input = new Blob([raw]).stream();
    const compressed = await new Response(
      input.pipeThrough(runtime.createGzipStream()),
    ).arrayBuffer();
    if (compressed.byteLength >= raw.byteLength) {
      return { body: raw, rawBytes: raw.byteLength, compressed: false };
    }
    return { body: new Uint8Array(compressed), rawBytes: raw.byteLength, compressed: true };
  } catch {
    return { body: raw, rawBytes: raw.byteLength, compressed: false };
  }
}

export function encodedEnvelopeFits(encoded: EncodedEnvelope, keepalive: boolean): boolean {
  if (encoded.rawBytes > MAX_RAW_BYTES) return false;
  if (encoded.compressed && encoded.body.byteLength > MAX_COMPRESSED_BYTES) return false;
  return !keepalive || encoded.body.byteLength <= MAX_KEEPALIVE_BYTES;
}

function browserCompressionRuntime(): CompressionRuntime {
  if (typeof CompressionStream === "undefined") return {};
  return {
    createGzipStream: () =>
      new CompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>,
  };
}
