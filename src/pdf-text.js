// Ekstraksi baris bersama mesin dan peramban; profil mematok SHA-256 berkas ini.
function textItems(items, viewportTransform) {
  const [a,b,c,d,e,f] = viewportTransform ?? [1,0,0,-1,0,0];
  const scale = Math.hypot(a,b);
  return items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const x = Number(item.transform?.[4] ?? 0), y = Number(item.transform?.[5] ?? 0);
    // Posisi layar mengikuti rotasi/crop halaman. Penyusun baris memakai y ke atas.
    return { text:item.str.trim(), x:a*x+c*y+e, y:-(b*x+d*y+f),
      width:Number(item.width ?? 0)*scale, height:Math.max(Number(item.height ?? 0)*scale,1) };
  });
}
function renderLines(items) {
  const ordered = [...items].sort((left, right) => {
    const sameLine = Math.abs(left.y - right.y) <= Math.max(left.height, right.height) * 0.35;
    return sameLine ? left.x - right.x : right.y - left.y;
  });
  const lines = [];
  for (const item of ordered) {
    const current = lines.at(-1);
    if (current && Math.abs(current.y - item.y) <= Math.max(current.height, item.height) * 0.35) {
      current.parts.push(item);
      current.height = Math.max(current.height, item.height);
    } else lines.push({ y: item.y, height: item.height, parts: [item] });
  }
  return lines.map(line => line.parts.sort((left, right) => left.x - right.x).map(item => item.text).join(' ')).join('\n');
}
export function pageText(items, pageWidth, viewportTransform) {
  const positioned = textItems(items, viewportTransform);
  if (!positioned.length) return '';
  const midpoint = pageWidth / 2;
  const left = positioned.filter(item => item.x + item.width / 2 < midpoint);
  const right = positioned.filter(item => item.x + item.width / 2 >= midpoint);
  // reduce menghindari batas argumen fungsi pada halaman padat.
  const leftEdge = left.reduce((edge, item) => Math.max(edge, item.x + item.width), -Infinity);
  const rightEdge = right.reduce((edge, item) => Math.min(edge, item.x), Infinity);
  const columns = left.length >= 2 && right.length >= 2 && rightEdge - leftEdge >= Math.max(24, pageWidth * 0.04);
  return (columns ? renderLines(left) + '\n' + renderLines(right) : renderLines(positioned))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
