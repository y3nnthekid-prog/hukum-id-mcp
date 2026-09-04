const steps = [
  ["Akad", "Murabahah, mudharabah, ijarah"],
  ["Fatwa", "Ketentuan dan pedoman DSN-MUI"],
  ["Regulasi", "UU, POJK, PBI, dan aturan terkait"],
  ["KHES", "Rukun, syarat, dan akibat hukum"],
  ["Putusan", "Penerapan dalam sengketa nyata"],
];

export function ResearchRail() {
  return (
    <aside className="research-rail" id="hes-map" aria-labelledby="hes-title">
      <p className="section-index">02 / PETA HES</p>
      <h2 id="hes-title">Satu isu, lima lapis pemeriksaan.</h2>
      <p className="rail-intro">
        Fatwa tidak berdiri sendiri. Telusuri bagaimana satu akad bergerak dari prinsip syariah
        menjadi norma positif dan diuji dalam putusan.
      </p>
      <ol className="hes-path">
        {steps.map(([title, description], index) => (
          <li key={title}>
            <span className="path-index">{index + 1}</span>
            <span><strong>{title}</strong><small>{description}</small></span>
          </li>
        ))}
      </ol>
      <div className="rail-note">
        <span className="live-dot" aria-hidden="true" />
        <p><strong>Status sumber terlihat.</strong> Gangguan situs tidak pernah disamarkan sebagai hasil nihil.</p>
      </div>
    </aside>
  );
}
