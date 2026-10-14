import { randomBytes } from 'node:crypto';

export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}
