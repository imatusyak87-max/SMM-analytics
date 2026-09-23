import { createHmac } from 'crypto';
import { verifySignedRequest } from './instagram-signed-request';

const APP_SECRET = 'test-app-secret';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload: object, secret = APP_SECRET): string {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest();
  return `${base64url(signature)}.${encodedPayload}`;
}

describe('verifySignedRequest', () => {
  it('returns the user id from a correctly signed request', () => {
    const signedRequest = sign({ user_id: '17841400000000000', algorithm: 'HMAC-SHA256' });

    expect(verifySignedRequest(signedRequest, APP_SECRET)).toEqual({ userId: '17841400000000000' });
  });

  it('rejects a request signed with the wrong secret', () => {
    const signedRequest = sign({ user_id: '123' }, 'a-different-secret');

    expect(verifySignedRequest(signedRequest, APP_SECRET)).toBeNull();
  });

  it('rejects a malformed request', () => {
    expect(verifySignedRequest('not-a-signed-request', APP_SECRET)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(verifySignedRequest('', APP_SECRET)).toBeNull();
  });
});
