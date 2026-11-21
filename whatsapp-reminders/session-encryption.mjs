import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const action = process.argv[2];
const sessionFile = path.resolve('whatsapp-reminders/session.enc');
const authDir = path.resolve('whatsapp-reminders/auth_info_baileys');
const secret = process.env.WA_SESSION_ENCRYPTION_KEY;
if (!secret) throw new Error('Set the WA_SESSION_ENCRYPTION_KEY GitHub Actions secret.');
const key = crypto.createHash('sha256').update(secret, 'utf8').digest();

if (action === 'decrypt') {
  if (!fs.existsSync(sessionFile)) { console.log('No saved WhatsApp session yet.'); process.exit(0); }
  const packed = fs.readFileSync(sessionFile);
  if (packed.length < 31 || packed.subarray(0,3).toString() !== 'WAE') throw new Error('Saved encrypted session format is invalid.');
  const iv = packed.subarray(3,15), tag = packed.subarray(15,31), ciphertext = packed.subarray(31);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const tar = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.mkdirSync(path.dirname(authDir), { recursive: true });
  execFileSync('tar', ['-xzf', '-', '-C', path.dirname(authDir)], { input: tar });
  console.log('WhatsApp session decrypted for this run.');
} else if (action === 'encrypt') {
  if (!fs.existsSync(authDir)) { console.log('No WhatsApp auth folder; skipping session archive.'); process.exit(0); }
  const tar = execFileSync('tar', ['-czf', '-', '-C', path.dirname(authDir), path.basename(authDir)]);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(tar), cipher.final()]);
  const packed = Buffer.concat([Buffer.from('WAE'), iv, cipher.getAuthTag(), ciphertext]);
  fs.writeFileSync(sessionFile, packed);
  console.log('WhatsApp session encrypted for repository storage.');
} else {
  throw new Error('Usage: session-encryption.mjs decrypt|encrypt');
}
