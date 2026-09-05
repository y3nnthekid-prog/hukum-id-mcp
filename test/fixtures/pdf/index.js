function escapePdfText(value) {
  return String(value).replace(/([\\()])/g, "\\$1");
}

function buildPdf(pages) {
  const objects = [];
  const pageRefs = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let index = 0; index < pages.length; index++) {
    const pageId = 4 + index * 2;
    const streamId = pageId + 1;
    const commands = pages[index]
      .map(({ x, y, text, rawPdfString }) => {
        const literal = rawPdfString ?? escapePdfText(text);
        return `BT /F1 12 Tf 1 0 0 1 ${x} ${y} Tm (${literal}) Tj ET`;
      })
      .join("\n");
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId - 1] = `<< /Length ${Buffer.byteLength(commands, "latin1")} >>\nstream\n${commands}\nendstream`;
  }

  let output = "%PDF-1.7\n%HukumID\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

export const PDF_FIXTURES = {
  scanTanpaTeks: buildPdf([[]]),
  duaKolom: buildPdf([
    [
      { x: 55, y: 730, text: "KIRI BARIS SATU" },
      { x: 330, y: 730, text: "KANAN BARIS SATU" },
      { x: 55, y: 700, text: "KIRI BARIS DUA" },
      { x: 330, y: 700, text: "KANAN BARIS DUA" },
    ],
  ]),
  halamanKosongDiTengah: buildPdf([
    [{ x: 55, y: 730, text: "HALAMAN PERTAMA" }],
    [],
    [{ x: 55, y: 730, text: "HALAMAN KETIGA" }],
  ]),
  arabNonUnicode: buildPdf([
    [{ x: 55, y: 730, rawPdfString: "DALIL ARAB: \\001\\002\\003\\004\\005\\006" }],
  ]),
  tanggalMustahil: buildPdf([
    [{ x: 55, y: 730, text: "Ditetapkan pada 31 Februari 2026" }],
  ]),
  peraturanPasalSatu: buildPdf([
    [{ x: 55, y: 730, text: "Pasal 1 Ketentuan umum mengenai Perbankan Syariah." }],
  ]),
};
