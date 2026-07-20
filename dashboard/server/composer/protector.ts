import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Encrypts capability-bearing provider session ids before they reach durable storage. */
export interface ProviderIdProtector {
  seal(providerId: string): string;
  open(sealed: string): string;
}
/**
 * AES-256-GCM protector with a domain-separated key derived from the already-resolved dashboard
 * session-signing secret. The stored form is authenticated as well as encrypted.
 */
export function createProviderIdProtector(secret: Buffer): ProviderIdProtector {
  const key = createHash('sha256')
    .update('kb-dashboard/composer-provider-id/v1\0', 'utf8')
    .update(secret)
    .digest();
  return {
    seal(providerId) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([cipher.update(providerId, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
    },
    open(sealed) {
      const [version, nonceRaw, tagRaw, ciphertextRaw, extra] = sealed.split('.');
      if (version !== 'v1' || !nonceRaw || !tagRaw || ciphertextRaw === undefined || extra !== undefined) {
        throw new Error('invalid protected provider id');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceRaw, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
