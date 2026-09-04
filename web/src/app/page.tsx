import { ResearchRail } from "../components/research-rail";
import { SearchWorkspace } from "../components/search-workspace";

export default function HomePage() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#main-content" aria-label="HukumID, beranda">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>HukumID</span>
        </a>
        <p className="header-context">Ruang riset hukum Indonesia</p>
        <nav className="header-nav" aria-label="Navigasi utama">
          <a href="#search">Pencarian</a>
          <a href="#hes-map">Peta HES</a>
          <a href="#principles">Metodologi</a>
        </nav>
      </header>

      <main id="main-content">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Evidence-first legal research</p>
            <h1 id="page-title">Temukan hukumnya.<br />Periksa sumbernya.</h1>
          </div>
          <p className="intro-copy">
            Satu meja kerja untuk peraturan, putusan, fatwa DSN-MUI, KHES, dan literatur.
            Setiap kesimpulan dirancang untuk kembali ke dokumen dan halaman asal.
          </p>
        </section>

        <div className="workspace-grid">
          <SearchWorkspace />
          <ResearchRail />
        </div>

        <section className="principles" id="principles" aria-labelledby="principles-title">
          <p className="section-index">03 / METODOLOGI</p>
          <div>
            <h2 id="principles-title">Ketika bukti tidak cukup, HukumID berhenti.</h2>
            <p>
              Pencarian metadata bukan bukti isi. HukumID membuka dokumen, mencari locator persis,
              memeriksa status keberlakuan, lalu mempertahankan hanya klaim yang terhubung ke evidence.
            </p>
          </div>
          <ol className="method-list">
            <li><span>01</span>Cari kandidat pada sumber resmi</li>
            <li><span>02</span>Buka dokumen dan locator persis</li>
            <li><span>03</span>Periksa perubahan dan konflik</li>
            <li><span>04</span>Simpulkan dengan jejak evidence</li>
          </ol>
        </section>
      </main>

      <footer className="site-footer">
        <p>HukumID membantu riset; bukan nasihat hukum dan bukan fatwa.</p>
        <p>v0.6 · Hukum nasional + ekonomi syariah</p>
      </footer>
    </div>
  );
}
