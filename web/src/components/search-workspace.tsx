"use client";

import { FormEvent, useEffect, useState } from "react";

import { ApiClientError, searchLegalSources } from "../lib/api";
import type { SearchResponse, SearchSource } from "../lib/types";
import { ResultCard } from "./result-card";

const SOURCE_OPTIONS: Array<{ value: SearchSource; label: string }> = [
  { value: "regulation", label: "Peraturan" },
  { value: "ma-product", label: "Produk hukum MA" },
  { value: "fatwa", label: "Fatwa DSN" },
  { value: "ma-decision", label: "Putusan MA" },
  { value: "mk-decision", label: "Putusan MK" },
  { value: "literature", label: "Literatur" },
];

const SUGGESTIONS = ["akad murabahah", "pelindungan data pribadi", "sengketa ekonomi syariah"];

export function SearchWorkspace() {
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<SearchSource[]>(["regulation", "ma-product", "fatwa"]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) setQuery(initial.slice(0, 300));
  }, []);

  async function runSearch(nextQuery = query) {
    const normalized = nextQuery.trim();
    if (normalized.length < 2) return;
    setState("loading");
    setError(null);
    window.history.replaceState(null, "", `?q=${encodeURIComponent(normalized)}`);
    try {
      const result = await searchLegalSources({ query: normalized, sources, pageSize: 20 });
      setResponse(result);
      setState("success");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught : new ApiClientError("Pencarian tidak dapat diselesaikan.", "NETWORK_ERROR"));
      setState("error");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function toggleSource(source: SearchSource) {
    setSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source]
    );
  }

  const documents = response?.data.documents ?? [];

  return (
    <section className="search-panel" id="search" aria-labelledby="search-title">
      <div className="search-heading">
        <p className="section-index">01 / PENCARIAN</p>
        <div className="index-state"><span aria-hidden="true" /> Indeks + verifikasi live</div>
      </div>
      <h2 id="search-title">Mulai dari pertanyaan atau rujukan.</h2>

      <form onSubmit={submit} className="search-form" role="search">
        <label htmlFor="legal-query">Pertanyaan, topik, atau nomor peraturan</label>
        <div className="search-control">
          <input
            id="legal-query"
            name="q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Contoh: apakah Pasal 46 UU 27/2022 masih berlaku?"
            minLength={2}
            maxLength={300}
            required
          />
          <button type="submit" disabled={state === "loading" || query.trim().length < 2 || sources.length === 0}>
            {state === "loading" ? "Menelusuri…" : "Telusuri"}
          </button>
        </div>

        <fieldset className="source-filters">
          <legend>Sumber yang diperiksa</legend>
          {SOURCE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={sources.includes(option.value)}
                onChange={() => toggleSource(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      </form>

      <div className="search-output" aria-live="polite" aria-busy={state === "loading"}>
        {state === "idle" ? (
          <div className="starting-points">
            <p>Coba titik awal:</p>
            <div>
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => { setQuery(suggestion); void runSearch(suggestion); }}>
                  {suggestion}<span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {state === "loading" ? (
          <div className="result-skeleton" aria-label="Sedang mencari sumber hukum">
            <span /><span /><span />
          </div>
        ) : null}

        {state === "error" && error ? (
          <div className="error-state" role="alert">
            <h3>Pencarian belum berhasil</h3>
            <p>{error.message}</p>
            {error.traceId ? <small>Trace: {error.traceId}</small> : null}
            <button type="button" onClick={() => void runSearch()}>Coba kembali</button>
          </div>
        ) : null}

        {state === "success" ? (
          <div className="results-region">
            <div className="results-summary">
              <h3>{documents.length ? `${documents.length} sumber ditemukan` : "Belum ada sumber yang cocok"}</h3>
              <span>{response?.meta.traceId.slice(0, 8)}</span>
            </div>
            {response?.data.warnings.map((warning) => <p className="source-warning" key={warning}>{warning}</p>)}
            {documents.length ? (
              <div className="result-list">{documents.map((document, index) => <ResultCard key={document.id} document={document} index={index} />)}</div>
            ) : (
              <div className="empty-state"><p>Persempit atau ganti istilah. Hasil kosong tidak dianggap bukti bahwa aturan tidak ada.</p></div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
