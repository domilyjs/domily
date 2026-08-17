import { clonePageEnvelope, envelopeSignatureBytes, payloadBytes } from './envelope.ts';
import {
  PageDeliveryError,
  type PageEnvelope,
  type PageEnvelopeSignatureVerifier,
} from './types.ts';

/** Computes the only accepted envelope payload-hash representation: sha256 + lowercase hex. */
export async function hashPageEnvelopePayload(payload: PageEnvelope['payload']): Promise<string> {
  const bytes = payloadBytes(payload);
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new PageDeliveryError('delivery.crypto.unavailable', 'Web Crypto SubtleCrypto is required to verify a remote envelope.');
  }
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return `sha256-${toHex(new Uint8Array(digest))}`;
}

/** Checks raw integrity before a local parser receives the payload. */
export async function verifyPageEnvelopeIntegrity(
  envelope: PageEnvelope,
  options: {
    readonly allowUnsigned: boolean;
    readonly verifySignature?: PageEnvelopeSignatureVerifier;
  },
): Promise<void> {
  const actualHash = await hashPageEnvelopePayload(envelope.payload);
  if (actualHash !== envelope.payloadHash) {
    throw new PageDeliveryError('delivery.envelope.hash.mismatch', 'Envelope payloadHash does not match the raw payload.');
  }
  if (!envelope.signature) {
    if (options.allowUnsigned) return;
    throw new PageDeliveryError('delivery.envelope.signature.required', 'Remote envelopes require a host-verified signature.');
  }
  if (!options.verifySignature) {
    throw new PageDeliveryError('delivery.envelope.signature.verifier.missing', 'No host signature verifier is available for this envelope.');
  }
  let verified: boolean;
  try {
    verified = await options.verifySignature({
      bytes: envelopeSignatureBytes(envelope),
      envelope: clonePageEnvelope(envelope),
    });
  } catch (error) {
    throw new PageDeliveryError('delivery.envelope.signature.verify.failed', 'Envelope signature verification failed.', error);
  }
  if (!verified) {
    throw new PageDeliveryError('delivery.envelope.signature.invalid', 'Envelope signature was rejected by the host verifier.');
  }
}

export async function hashDeliveryFingerprint(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new PageDeliveryError('delivery.crypto.unavailable', 'Web Crypto SubtleCrypto is required to compute a delivery fingerprint.');
  }
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return `sha256-${toHex(new Uint8Array(digest))}`;
}

function toHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}
