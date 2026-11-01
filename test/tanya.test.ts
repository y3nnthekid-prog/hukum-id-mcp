import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { createSigner, generateSigningKey, verifySignature } from '../src/core/sign.js';
import { contentHash } from '../src/core/passages.js';
import { signedPart, type PotonganBertanda } from '../src/core/sumber.js';
import { requestHash } from '../src/core/step-ticket.js';
import { tentukanTopik, susunKueri, pasalKunci } from '../src/core/kamus-awam.js';
import { runTanya, rujukanEksplisit, sebutanAturan, dicabut, kalimat, potongPanjang, rapikan, cariKutipan } from '../src/core/tanya.js';
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
  const result = await runTanya(input('Barang belanja online saya datang rusak, penjual menolak refund'), deps([lama, hak], fake.model));
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
    // Browser terputus: web mengambil hasil yang sama lewat tiket baca yang terikat turnId.
    const baca = ticket(secret, { ...body, jti: 'r'.repeat(43) });
    const ulang = await app.request('/v2/chat/hasil/t1', { headers: { 'x-pasla-chat-ticket': baca } });
    assert.equal(ulang.status, 200);
    const simpan = (await ulang.json() as any).data;
    assert.equal(simpan.type, 'result');
    assert.deepEqual(simpan.data.poin, result.data.poin);
    assert.equal((await app.request('/v2/chat/hasil/t2', { headers: { 'x-pasla-chat-ticket': baca } })).status, 401);
    const lain = ticket(secret, { ...body, inputHash: 'f'.repeat(64) });
    assert.equal((await app.request('/v2/chat/hasil/t1', { headers: { 'x-pasla-chat-ticket': lain } })).status, 404);
  } finally { ledger.close(); }
});

test('situations open verified key articles before search results', () => {
  assert.deepEqual(pasalKunci('sewa-utang', 'Teman meminjam uang dan tidak mau membayar').map((r: any) => r.pasal), ['Pasal 1754', 'Pasal 1763', 'Pasal 1238', 'Pasal 1243']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Saya di-PHK, berapa pesangon saya?'), [{ jenis: 'peraturan', rujukan: 'PP 35/2021', pasal: 'Pasal 40' }, { jenis: 'peraturan', rujukan: 'UU 6/2023', pasal: 'Pasal 151' }]);
  assert.deepEqual(pasalKunci('syariah', 'Saya terlambat bayar cicilan murabahah'), [{ jenis: 'fatwa', nomor: '04/DSN-MUI/IV/2000' }, { jenis: 'fatwa', nomor: '17/DSN-MUI/IX/2000' }, { jenis: 'khes', pasal: 'Pasal 36' }, { jenis: 'khes', pasal: 'Pasal 38' }]);
});

test('a status that merely mentions an earlier revoked law is not treated as revoked', () => {
  const s = (status: string, dicabutDengan: string[] = []) => ({ sumber: { status, dicabutDengan } } as any);
  assert.equal(dicabut(s('JDIH BPK 1 Nov 2026: Berlaku; dibentuk atas UU 11/2020 yang kini dicabut UU 6/2023.')), false);
  assert.equal(dicabut(s('Tidak Berlaku')), true);
  assert.equal(dicabut(s('JDIH BPK: Dicabut oleh UU 8/1999')), true);
  assert.equal(dicabut(s('Berlaku', ['UU 1/2026'])), true);
  // UU ITE: hanya pasal yang disebut dalam pencabutan sebagian yang dianggap dicabut.
  const ite = (pasal: string) => ({ ...s('Naskah asli; sebagian pasal dicabut KUHP.', ['Sebagian oleh UU 1/2023 (KUHP, berlaku 2 Jan 2026): Pasal 27(1), 27(3), 28(2), 30, 31(1)-(2), 45A(2)']), locator: { pasal } });
  assert.equal(dicabut(ite('Pasal 9')), false);
  assert.equal(dicabut(ite('Pasal 3')), false);
  assert.equal(dicabut(ite('Pasal 45')), false);
  assert.equal(dicabut(ite('Pasal 27')), true);
  assert.equal(dicabut(ite('Pasal 45A')), true);
});

test('garbled Arabic presentation forms from fatwa PDFs are never quoted', async () => {
  const rusak = passage('p-arab', 'UU 8/1999', 'Hadis: ﻣﻄﻞ ﺍﻟｻ ﻣﻨﻮ ﻯﻦ penundaan oleh orang mampu adalah kezaliman yang dilarang.', {}, 'Pasal 5');
  const fake = fakeModel({ intinya: 'Kalau barang tidak sesuai, konsumen dapat meminta ganti rugi.', poin: [{ passageId: 'p-arab', kutipan: rusak.text.slice(0, 40), teks: 'Kutipan hadis.' }], langkah: [], tanyaBalik: [] });
  const result = await runTanya(input('Barang saya rusak, penjual menolak refund'), deps([rusak], fake.model));
  assert.equal(result.poin.length, 0);
});

test('sentence splitting survives abbreviations, money and web addresses', () => {
  assert.deepEqual(kalimat('Menurut UU No. 13 Tahun 2003 pekerja berhak pesangon. Lalu hubungi Disnaker.'), ['Menurut UU No. 13 Tahun 2003 pekerja berhak pesangon.', 'Lalu hubungi Disnaker.']);
  assert.deepEqual(kalimat('Gajinya Rp5.000.000 per bulan. Cek di ojk.go.id ya.'), ['Gajinya Rp5.000.000 per bulan.', 'Cek di ojk.go.id ya.']);
  assert.equal(rapikan('Masa kerja 1–3 tahun — dapat 2 bulan upah.'), 'Masa kerja 1-3 tahun, dapat 2 bulan upah.');
  assert.deepEqual(sebutanAturan('Menurut UU No. 13 Tahun 2003, Permenaker No. 6 Tahun 2016 dan POJK Nomor 10/POJK.05/2022.').regs, ['uu 13/2003', 'permenaker 6/2016', 'pojk 10/2022']);
  assert.match(potongPanjang('Satu kalimat panjang sekali tanpa titik yang terus berlanjut melewati batas yang ditentukan', 40), /…$/);
});

test('an unopened regulation hidden behind "No." is still removed', async () => {
  const fake = fakeModel({ intinya: 'Kalau barang tidak sesuai, konsumen dapat meminta ganti rugi. Menurut UU No. 13 Tahun 2003 penjual wajib membayar dua kali lipat.', poin: [], langkah: [], tanyaBalik: [] });
  const result = await runTanya(input('Barang saya rusak, penjual menolak refund'), deps([hak], fake.model));
  assert.doesNotMatch(result.intinya, /13 Tahun 2003|dua kali/);
});

test('revocation is read from the start of any status segment, partial revocation is not total', () => {
  const s = (status: string) => ({ sumber: { status, dicabutDengan: [] } } as any);
  assert.equal(dicabut(s('JDIH BPK 1 Nov 2026 pukul 10:00 WIB: Dicabut oleh UU 1/2026')), true);
  assert.equal(dicabut(s('Dicabut sebagian oleh KUHP')), false);
});

test('precheck refuses before searching and public status hides budget numbers', async () => {
  const ledger = createTanyaLedger(':memory:', { dayMicro: 1000, monthMicro: 5000, concurrent: 1 });
  assert.equal(ledger.precheck(100), null);
  ledger.admit('k'.repeat(43), 100);
  assert.equal(ledger.precheck(100), 'TANYA_BUSY');
  const app = new Hono();
  const svc = services([hak]);
  registerChat(app as any, { tanya: { key: 'k', ledger, monitorToken: 'rahasia-pemantau' }, stepTickets: { secret: 's'.repeat(43), audience: 'https://api.pasla.tech' }, telusur: svc.telusur, sumber: svc.sumber, signer });
  const publik = await (await app.request('/v2/chat/status')).json() as any;
  assert.equal('dayRemainingMicro' in publik.tanya, false);
  const pemantau = await (await app.request('/v2/chat/status', { headers: { 'x-pasla-pemantau': 'rahasia-pemantau' } })).json() as any;
  assert.equal(typeof pemantau.tanya.dayRemainingMicro, 'number');
  ledger.close();
});

test('everyday wording reaches the right topic, weak words never pick sharia', () => {
  const kasus: Array<[string, string | null]> = [
    ['Gajiku sudah dua bulan belum dibayar, aku karyawan toko', 'pekerjaan'],
    ['Saya dirumahkan tanpa kejelasan', 'pekerjaan'],
    ['Kosan saya depositnya tidak dikembalikan', 'sewa-utang'],
    ['Temen minjem duit 2 juta ga mau balikin', 'sewa-utang'],
    ['Kredit motor telat bayar, didenda besar', 'sewa-utang'],
    ['Nasabah bank, kartu kredit kena denda', 'sewa-utang'],
    ['Salam, saya mau tanya soal warisan', null],
    ['Bagaimana akad nikah yang sah?', null],
    ['Cicilan murabahah saya menunggak', 'syariah'],
  ];
  for (const [teks, harap] of kasus) assert.equal(tentukanTopik(teks), harap, teks);
});

test('new verified key articles open for common situations', () => {
  assert.deepEqual(pasalKunci('pekerjaan', 'THR saya belum dibayar').map((r: any) => r.rujukan + ' ' + r.pasal), ['PP 36/2021 Pasal 9', 'PP 36/2021 Pasal 62']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Saya mau resign, dapat apa?').map((r: any) => r.pasal), ['Pasal 50']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Gajiku sudah dua bulan belum dibayar').map((r: any) => r.rujukan + ' ' + r.pasal), ['PP 36/2021 Pasal 55', 'PP 36/2021 Pasal 61']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Bos telat gajian terus tiap bulan').map((r: any) => r.pasal), ['Pasal 55', 'Pasal 61']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Bos telat bayar gaji terus, ada dendanya nggak?').map((r: any) => r.pasal), ['Pasal 55', 'Pasal 61']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Sudah lewat tanggal gajian 10 hari').map((r: any) => r.pasal), ['Pasal 55', 'Pasal 61']);
  assert.deepEqual(pasalKunci('pekerjaan', 'Kapan kenaikan gaji wajib diberikan?'), []);
  assert.deepEqual(pasalKunci('sewa-utang', 'Pinjol neror dan menyebar data saya, penagih kasar').map((r: any) => r.rujukan + ' ' + r.pasal), ['POJK 10/POJK.05/2022 Pasal 102']);
  assert.deepEqual(pasalKunci('konsumen', 'Barang belum dikirim padahal sudah bayar').map((r: any) => r.pasal), ['Pasal 16']);
  assert.deepEqual(pasalKunci('konsumen', 'Barang datang rusak, penjual menolak mengembalikan uang').map((r: any) => r.pasal), ['Pasal 19', 'Pasal 4']);
});

test('a quote that joins distant clauses with an ellipsis becomes the original continuous span', () => {
  const text = 'Pasal 55\n(1) Pengusaha wajib membayar Upah pada waktu yang\ntelah diperjanjikan antara Pengusaha dengan\nPekerja/Buruh.\n(2) Dalam hal hari libur , pelaksanaan pembayara n Upah\ndiatur dalam Perjanjian Kerja.\n(4) Jangka waktu pembayaran Upah oleh Pengusaha tidak\nboleh lebih dari 1 (satu) bulan.\n';
  const at = cariKutipan(text, '(1) Pengusaha wajib membayar Upah pada waktu yang telah diperjanjikan antara Pengusaha dengan Pekerja/Buruh.\n...\n(4) Jangka waktu pembayaran Upah oleh Pengusaha tidak boleh lebih dari 1 (satu) bulan.');
  assert.ok(at);
  const quote = text.slice(at.start, at.end);
  assert.ok(quote.startsWith('(1) Pengusaha wajib') && quote.endsWith('1 (satu) bulan.') && quote.includes('(2) Dalam hal'));
  // Urutan terbalik, kata yang diubah, atau bagian yang tidak ada tetap ditolak.
  assert.equal(cariKutipan(text, '(4) Jangka waktu pembayaran Upah oleh Pengusaha … (1) Pengusaha wajib membayar Upah'), null);
  assert.equal(cariKutipan(text, '(1) Pengusaha wajib membayar Upah pada waktu yang telah diperjanjian … tidak boleh lebih dari 1 (satu) bulan'), null);
  assert.equal(cariKutipan(text, 'Pengusaha wajib membayar Upah … tidak boleh lebih dari 2 (dua) bulan'), null);
});

test('UU 13/2003 articles changed by UU 6/2023 open from the amending law, deleted ones are not used', async () => {
  const { versiTerbaru, naskahUsang, catatanMk168 } = await import('../src/core/perubahan.js');
  assert.deepEqual(versiTerbaru({ jenis: 'peraturan', rujukan: 'UU 13/2003', pasal: 'Pasal 156' }), { jenis: 'peraturan', rujukan: 'UU 6/2023', pasal: 'Pasal 156' });
  assert.deepEqual(versiTerbaru({ jenis: 'peraturan', rujukan: 'UU 13/2003', pasal: 'Pasal 88a' }), { jenis: 'peraturan', rujukan: 'UU 6/2023', pasal: 'Pasal 88A' });
  assert.equal(versiTerbaru({ jenis: 'peraturan', rujukan: 'UU 13/2003', pasal: 'Pasal 164' }), null);
  assert.deepEqual(versiTerbaru({ jenis: 'peraturan', rujukan: 'UU 13/2003', pasal: 'Pasal 134' }), { jenis: 'peraturan', rujukan: 'UU 13/2003', pasal: 'Pasal 134' });
  assert.deepEqual(versiTerbaru({ jenis: 'peraturan', rujukan: 'PP 35/2021', pasal: 'Pasal 40' }), { jenis: 'peraturan', rujukan: 'PP 35/2021', pasal: 'Pasal 40' });
  assert.equal(naskahUsang({ identitas: ['UU 13/2003', 'Pasal 59'], locator: { pasal: 'Pasal 59' } }), true);
  assert.equal(naskahUsang({ identitas: ['UU 13/2003', 'Pasal 6'], locator: { pasal: 'Pasal 6' } }), false);
  assert.match(catatanMk168({ identitas: ['UU 6/2023', 'Pasal 156'], locator: { pasal: 'Pasal 156', mengubah: 'UU 13/2003' } })!, /ayat \(2\) pasal ini/);
  assert.equal(catatanMk168({ identitas: ['UU 6/2023', 'Pasal 59'], locator: { pasal: 'Pasal 59', mengubah: 'UU 13/2003' } }), undefined);
});
