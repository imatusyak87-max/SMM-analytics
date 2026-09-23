import { encryptToken, decryptToken } from './instagram-token-crypto';

// 32 bytes, hex-encoded — the same shape as a real CREDENTIAL_ENCRYPTION_KEY.
const KEY = 'a'.repeat(64);

describe('instagram-token-crypto', () => {
  it('decrypts back to the original plaintext', () => {
    const ciphertext = encryptToken('IGQVJ...a-real-looking-token', KEY);

    expect(decryptToken(ciphertext, KEY)).toBe('IGQVJ...a-real-looking-token');
  });

  it('never stores the plaintext inside the ciphertext string', () => {
    const ciphertext = encryptToken('super-secret-token-value', KEY);

    expect(ciphertext).not.toContain('super-secret-token-value');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const first = encryptToken('same-token', KEY);
    const second = encryptToken('same-token', KEY);

    expect(first).not.toBe(second);
    expect(decryptToken(first, KEY)).toBe('same-token');
    expect(decryptToken(second, KEY)).toBe('same-token');
  });

  it('rejects a ciphertext that was tampered with', () => {
    const ciphertext = encryptToken('a-token', KEY);
    const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === 'AA' ? 'BB' : 'AA');

    expect(() => decryptToken(tampered, KEY)).toThrow();
  });
});
