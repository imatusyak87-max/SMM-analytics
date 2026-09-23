import { createHmac, timingSafeEqual } from 'crypto';

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verifies Meta's signed_request format (used by the deauthorize and
 * data-deletion webhooks): "<base64url signature>.<base64url JSON payload>",
 * signature = HMAC-SHA256(payload, app secret). Returns null instead of
 * throwing for anything malformed — a webhook handler must always be able
 * to respond, never crash on a request it doesn't recognise.
 */
export function verifySignedRequest(signedRequest: string, appSecret: string): { userId: string } | null {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [encodedSignature, encodedPayload] = parts;

  let expectedSignature: Buffer;
  let actualSignature: Buffer;
  try {
    expectedSignature = createHmac('sha256', appSecret).update(encodedPayload).digest();
    actualSignature = base64urlDecode(encodedSignature);
  } catch {
    return null;
  }
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
    return typeof payload.user_id === 'string' || typeof payload.user_id === 'number'
      ? { userId: String(payload.user_id) }
      : null;
  } catch {
    return null;
  }
}
