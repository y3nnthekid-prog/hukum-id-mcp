import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyPdfProfile(root = fileURLToPath(new URL('../', import.meta.url)), sibling = path.resolve(root, '../pasla')) {
  const profileBytes = await readFile(path.join(root, 'pdf-profile.json'));
  const profile = JSON.parse(profileBytes);
  const [pkg, installed, source] = await Promise.all([
    readFile(path.join(root, 'package.json')).then(JSON.parse),
    readFile(path.join(root, 'node_modules/pdfjs-dist/package.json')).then(JSON.parse),
    readFile(path.join(root, 'src/pdf-text.js')),
  ]);
  if (profile.textOptions.isEvalSupported !== false || pkg.dependencies['pdfjs-dist'] !== profile.pdfjs || installed.version !== profile.pdfjs || createHash('sha256').update(source).digest('hex') !== profile.lineJoinSha256) throw new Error('Profil PDF berbeda dari parser, konfigurasi, atau kode penyusun baris.');
  if (existsSync(sibling)) {
    const [otherSource, otherProfile] = await Promise.all([readFile(path.join(sibling, 'src/lib/pdf-text.js')), readFile(path.join(sibling, 'pdf-profile.json'))]);
    if (!source.equals(otherSource) || !profileBytes.equals(otherProfile)) throw new Error('Profil PDF mesin dan web berbeda.');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPdfProfile();
