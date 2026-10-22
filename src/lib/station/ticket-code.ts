import { randomInt } from 'node:crypto';

// Ambiguous characters (0/O, 1/I) are deliberately excluded so staff can type
// the short code without confusing them.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export function generateTicketCode(length = 8): string {
  if (!Number.isInteger(length) || length < 4 || length > 16) {
    throw new Error('Ticket code length must be between 4 and 16');
  }
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}

export function isTicketCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}
