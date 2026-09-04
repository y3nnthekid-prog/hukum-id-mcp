import type { LegalDocument } from "../lib/types";

export function ResultCard({ document, index }: { document: LegalDocument; index: number }) {
  return (
    <article className="result-card">
      <div className="result-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
      <div className="result-body">
        <div className="result-meta">
          <span>{document.documentType.replaceAll("_", " ")}</span>
          <span>{document.authority}</span>
          {document.year ? <span>{document.year}</span> : null}
        </div>
        <h3>
          <a href={document.canonicalUrl} target="_blank" rel="noreferrer">
            {document.title}
          </a>
        </h3>
        <div className="result-footer">
          <span className={`status-label ${document.status ? "has-status" : "unknown-status"}`}>
            {document.status || "Status perlu diperiksa"}
          </span>
          <span className="source-link">Buka sumber resmi <span aria-hidden="true">↗</span></span>
        </div>
      </div>
    </article>
  );
}
