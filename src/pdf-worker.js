import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageText } from "./pdf-text.js";

let doc;
try {
  doc = await getDocument({ ...workerData.documentOptions, data: workerData.data }).promise;
  if (doc.numPages > workerData.maxPages) throw new Error("PDF_PAGE_LIMIT");
  const halaman = [];
  let characters = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const stream = page.streamTextContent().getReader();
    const items = [];
    let pageChars = 0;
    while (true) {
      const part = await stream.read();
      if (part.done) break;
      for (const item of part.value.items) {
        pageChars += typeof item.str === "string" ? item.str.length : 0;
        if (pageChars > workerData.maxPageChars || characters + pageChars > workerData.maxChars || items.length >= workerData.maxPageItems) {
          await stream.cancel().catch(() => undefined);
          throw new Error("PDF_TEXT_LIMIT");
        }
        items.push(item);
      }
    }
    const teks = pageText(items, page.getViewport({ scale: 1 }).width);
    characters += teks.length;
    if (teks.length > workerData.maxPageChars || characters > workerData.maxChars) throw new Error("PDF_TEXT_LIMIT");
    halaman.push({ halaman: i, teks });
    page.cleanup();
  }
  parentPort.postMessage({ halaman, total_halaman: doc.numPages });
} catch (cause) {
  parentPort.postMessage({ error: cause instanceof Error && /^PDF_/.test(cause.message) ? cause.message : "PDF_EXTRACTION_FAILED" });
} finally { await doc?.destroy(); }
