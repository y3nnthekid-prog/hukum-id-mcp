import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { createSigner, generateSigningKey, verifySignature } from '../src/core/sign.js';
import { contentHash } from '../src/core/passages.js';
import { signedPart, type PotonganBertanda } from '../src/core/sumber.js';
import { requestHash } from '../src/core/step-ticket.js';
import { tentukanTopik, susunKueri } from '../src/core/kamus-awam.js';
import { runTanya, rujukanEksplisit, sebutanAturan } from '../src/core/tanya.js';
import { createTanyaLedger, hariWib } from '../src/core/tanya-ledger.js';
import { verifyAnyChatTicket, verifyChatTicket } from '../src/core/chat-ticket.js';
import { registerChat, TANYA_RESERVE_MICRO } from '../src/api/chat.js';
import type { JsonModel } from '../src/ai/json-model.js';

const signer = createSigner(generateSigningKey());
function passage(id: string, rujukan: string, text: string, extra: Partial<PotonganBertanda['sumber']> = {}, pasal = 'Pasal 4'): PotonganBertanda {
  const raw = { id, documentId: 'd-' + id, jenis: 'peraturan', judul: 'Undang-Undang Perlindungan Konsumen', rujukan: `${rujukan} ${pasal}`, locator: { pasal, bagian: 'batang-tubuh', halamanAwal: 3, halamanAkhir: 3 }, text, identitas: [rujukan, pasal], lapisan: ['norma'], sumber: { nama: 'JDIH', url: 'https://example.test/uu', otoritas: 'JDIH', status: 'Berlaku', diubahDengan: [], dicabutDengan: [], ...extra }, retrievedAt: new Date().toISOString(), verificationStatus: 'verified_snapshot', mesin: 'test' } as unknown as PotonganBertanda;
  const withHash = { ...raw, contentHash: contentHash(text) } as PotonganBertanda;
  return { ...withHash, tanda: signer.sign(signedPart(withHash)) };
}
const hak = passage('p-hak', 'UU 8/1999', 'Hak konsumen adalah hak atas kompensasi, ganti rugi dan/atau penggantian, apabila barang dan/atau jasa yang diterima tidak sesuai dengan perjanjian atau tidak sebagaimana mestinya.');
const lama = passage('p-lama', 'UU 1/1990', 'Penjual wajib mengganti barang yang rusak dalam waktu tujuh hari sejak barang diterima oleh pembeli.', { status: 'Tidak Berlaku', dicabutDengan: ['UU 8/1999'] }, 'Pasal 9');

function services(found: PotonganBertanda[]) {
  const queries: string[] = [];
  const telusur = (async (input: { query: string }) => { queries.push(input.query); return { kandidat: found.map((p) => ({ rujukan: { jenis: 'peraturan', rujukan: p.identitas[0], pasal: p.locator.pasal } })) }; }) as any;
  const sumber = { buka: async (ref: any) => ({ rujukan: ref, status: 'dibuka', peringatan: [], potongan: found.filter((p) => p.identitas[0] === ref.rujukan) }) } as any;
  return { telusur, sumber, queries };
}
function fakeModel(reply: unknown) {
  let calls = 0;
  const model: JsonModel = { provider: 'openai', model: 'fake', async generate({ schema }) { calls++; return schema.parse(reply) as any; } };
  return { model, calls: () => calls };
}
const input = (text: string) => ({ conversationId: 'c1', turnId: 't1', version: 1, messages: [{ id: 'u1', role: 'user' as const, text }] });
const deps = (found: PotonganBertanda[], model: JsonModel) => ({ ...services(found), model, signer, keys: [signer.publicKeyPem], signal: new AbortController().signal, progress: async () => undefined });

test('topic and vocabulary-only queries come from lay wording', () => {
  assert.equal(tentukanTopik('Barang belanja online saya datang rusak, penjual menolak refund'), 'konsumen');
  assert.equal(tentukanTopik('Saya di-PHK tanpa pesangon'), 'pekerjaan');
  assert.equal(tentukanTopik('Gaji saya belum dibayar dua bulan'), 'pekerjaan');
  assert.equal(tentukanTopik('Teman pinjam uang tidak mau bayar'), 'sewa-utang');
  assert.equal(tentukanTopik('Pembiayaan murabahah saya menunggak, apakah boleh didenda?'), 'syariah');
  assert.equal(tentukanTopik('Bagaimana cara membuat paspor?'), null);
  const queries = susunKueri('konsumen', 'barang saya rusak dan saya minta refund');
  assert.ok(queries.includes('barang cacat rusak ganti rugi'));
  assert.ok(queries.every((q) => !q.includes('saya')), 'raw user text never becomes a query');
});

test('explicit references and mentions are normalized', () => {
  assert.deepEqual(rujukanEksplisit('Apa isi UU Nomor 8 Tahun 1999 Pasal 4?'), [{ jenis: 'peraturan', rujukan: 'UU 8/1999', pasal: 'Pasal 4' }]);
  assert.deepEqual(rujukanEksplisit('Pasal 1365 KUH Perdata dan fatwa 04/DSN-MUI/IV/2000'), [{ jenis: 'peraturan', rujukan: 'KUH Perdata', pasal: 'Pasal 1365' }, { jenis: 'fatwa', nomor: '4/DSN-MUI/IV/2000' }]);
  assert.deepEqual(sebutanAturan('Menurut Undang-Undang Nomor 8 Tahun 1999 Pasal 4 huruf h').regs, ['uu 8/1999']);
});

test('out-of-topic questions are answered without calling the model', async () => {
  const fake = fakeModel({});
  const result = await runTanya(input('Bagaimana cara membuat paspor?'), deps([hak], fake.model));
  assert.equal(fake.calls(), 0);
  assert.equal(result.method.model, 'tanpa-ai');
  assert.equal(result.poin.length, 0);
  const { tanda, ...body } = result;
  assert.equal(verifySignature(body, tanda, [signer.publicKeyPem]), true);
});

test('only exact quotes from opened sources survive; invented rules and unconditional personal claims are removed', async () => {
  const fake = fakeModel({
    intinya: 'Kalau barangnya tidak sesuai perjanjian, menurut UU 8/1999 konsumen dapat meminta ganti rugi. Kamu berhak dapat uang kembali penuh. Menurut UU 99/2024 Pasal 7 penjual wajib membayar dua kali lipat.',
    poin: [
      { passageId: 'p-hak', kutipan: 'hak atas kompensasi, ganti rugi dan/atau penggantian, apabila barang dan/atau jasa yang diterima tidak sesuai', teks: 'Konsumen berhak atas ganti rugi bila barang tidak sesuai perjanjian.' },
      { passageId: 'p-hak', kutipan: 'penjual wajib mengembalikan uang dalam tiga hari', teks: 'Kutipan karangan.' },
      { passageId: 'p-lama', kutipan: 'Penjual wajib mengganti barang yang rusak dalam waktu tujuh hari', teks: 'Penjual wajib mengganti barang rusak.' },
    ],
    langkah: ['Simpan bukti pembayaran dan percakapan dengan penjual.', 'Coba nyalakan lagi barangnya untuk membuktikan rusak.', 'Ajukan komplain lewat fitur marketplace, dana otomatis cair.'],
    tanyaBalik: ['Kapan barangnya kamu terima?'],
  });
  const result = await runTanya(input('Barang belanja online saya datang rusak, penjual menolak refund'), deps([hak, lama], fake.model));
  assert.equal(fake.calls(), 1);
  assert.equal(result.topik, 'konsumen');
  assert.deepEqual(result.poin.map((p) => p.kutipan.passageId), ['p-hak']);
  assert.ok(hak.text.includes(result.poin[0]!.kutipan.quote));
  assert.match(result.intinya, /UU 8\/1999/);
  assert.doesNotMatch(result.intinya, /99\/2024|Kamu berhak/);
  assert.deepEqual(result.langkah, ['Simpan bukti pembayaran dan percakapan dengan penjual.']);
  assert.ok(result.batas.some((b) => b.includes('sudah dicabut')));
  assert.deepEqual(result.sources.map((p) => p.id), ['p-hak']);
  assert.deepEqual(result.bantuan, ['bpsk', 'lbh']);
});

test('ledger enforces day, month, concurrency, replay and settles to actual cost', () => {
  let now = Date.UTC(2026, 10, 1, 16, 59, 0) / 1000; // 23.59 WIB
  const ledger = createTanyaLedger(':memory:', { dayMicro: 200, monthMicro: 220, concurrent: 1 }, () => now);
  ledger.admit('a'.repeat(43), 150);
  assert.throws(() => ledger.admit('b'.repeat(43), 10), /TANYA_BUSY/);
  ledger.settle('a'.repeat(43), 40);
  assert.throws(() => ledger.admit('a'.repeat(43), 10), /TANYA_REPLAY/);
  assert.throws(() => ledger.admit('c'.repeat(43), 170), /TANYA_BUDGET_DAY/);
  assert.equal(ledger.status().dayRemainingMicro, 160);
  now += 120; // 00.01 WIB: new day, same month
  assert.equal(hariWib(now), '2026-11-02');
  ledger.admit('d'.repeat(43), 150);
  ledger.settle('d'.repeat(43), 150);
  assert.throws(() => ledger.admit('e'.repeat(43), 40), /TANYA_BUDGET_MONTH/);
  ledger.close();
});

function ticket(secret: string, body: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  return encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url');
}

test('v4 public ticket runs one GPT-5.1 call and signs a settled usage receipt', async (t) => {
  const secret = 's'.repeat(43), aud = 'https://api.pasla.tech', data = input('Barang belanja online saya datang rusak, penjual menolak refund');
  const time = Math.floor(Date.now() / 1000);
  const body = { v: 4, iss: 'https://pasla.tech', aud, sub: 'owner', conversationId: 'c1', turnId: 't1', inputHash: requestHash(data), profile: 'pasla-tanya-v1', jti: 'j'.repeat(43), iat: time, exp: time + 300 };
  assert.throws(() => verifyChatTicket(ticket(secret, body), secret, aud, data), /CHAT_TICKET/);
  assert.equal(verifyAnyChatTicket(ticket(secret, body), secret, aud, data).v, 4);
  const content = { intinya: 'Kalau barangnya tidak sesuai perjanjian, konsumen dapat meminta ganti rugi.', poin: [{ passageId: 'p-hak', kutipan: 'hak atas kompensasi, ganti rugi dan/atau penggantian, apabila barang', teks: 'Konsumen berhak atas ganti rugi bila barang tidak sesuai.' }], langkah: ['Simpan bukti pembayaran.'], tanyaBalik: [] };
  let dispatched = 0;
  t.mock.method(globalThis, 'fetch', async () => { dispatched++; return Response.json({ model: 'gpt-5.1-2025-11-13', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 3000, completion_tokens: 500 } }); });
  const ledger = createTanyaLedger(':memory:', { dayMicro: 3_000_000, monthMicro: 30_000_000, concurrent: 3 });
  const app = new Hono();
  const svc = services([hak]);
  registerChat(app as any, { tanya: { key: 'synthetic-key-only', ledger }, stepTickets: { secret, audience: aud }, telusur: svc.telusur, sumber: svc.sumber, signer });
  try {
    const status = await (await app.request('/v2/chat/status')).json() as any;
    assert.equal(status.tanya.available, true);
    const response = await app.request('/v2/chat/turn', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pasla-chat-ticket': ticket(secret, body) }, body: JSON.stringify(data) });
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    const result = events.find((e) => e.type === 'result');
    assert.ok(result, JSON.stringify(events.at(-1)));
    assert.equal(dispatched, 1);
    assert.equal(result.data.v, 2);
    assert.equal(result.data.poin.length, 1);
    const { tanda, ...receipt } = result.usageReceipt;
    assert.equal(verifySignature(receipt, tanda, [signer.publicKeyPem]), true);
    assert.equal(receipt.costMicro, 3000 * 1.25 + 500 * 10);
    assert.equal(ledger.status().dayRemainingMicro, 3_000_000 - receipt.costMicro);
    assert.ok(TANYA_RESERVE_MICRO > receipt.costMicro);
  } finally { ledger.close(); }
});
