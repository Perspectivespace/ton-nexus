/**
 * Статичный SVG-арт «Арены» (лобби и карточка в «Играх») — порт heroArt из прототипа: неоновый закат, город,
 * перспективная сетка, кольцо зоны, фишки «Я» и соперника. Детерминирован (без случайности), без анимаций.
 * id — префикс для id градиентов/фильтров (на странице может быть два арта).
 */
const HEX = (x: number, y: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");

export function heroArtSvg(id: string, h = 178): string {
  const W = 360, hz = Math.round(h * 0.42), vx = 180;
  let grid = "";
  for (let i = -9; i <= 9; i++) grid += `<line x1="${vx + i * 6}" y1="${hz}" x2="${vx + i * 64}" y2="${h}"/>`;
  for (let k = 1; k <= 7; k++) {
    const y = hz + (h - hz) * Math.pow(k / 7, 1.9);
    grid += `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke-opacity="${(0.25 + k * 0.1).toFixed(2)}"/>`;
  }
  let city = "", win = "", x = 0, s = 7;
  while (x < W) {
    s = (s * 73 + 11) % 97;
    const w = 10 + (s % 18), hh = 10 + (s % 34) * (Math.abs(x - vx) > 70 ? 1 : 0.55);
    city += `<rect x="${x}" y="${hz - hh}" width="${w - 1}" height="${hh}"/>`;
    if (s % 3 === 0) win += `<rect x="${x + 3}" y="${hz - hh + 4}" width="2" height="2"/>`;
    if (s % 4 === 1) win += `<rect x="${x + w - 6}" y="${hz - hh + 9}" width="2" height="2"/>`;
    x += w;
  }
  let stars = "";
  for (let i = 0, q = 3; i < 26; i++) {
    q = (q * 61 + 17) % 359;
    stars += `<circle cx="${q}" cy="${((q * 7) % (hz - 14)) + 4}" r="${i % 5 ? 0.6 : 1}"/>`;
  }
  const ring = `M${vx - 128} ${h - 18} L${vx + 128} ${h - 18} L${vx + 78} ${hz + 14} L${vx - 78} ${hz + 14} Z`;
  const blk = (bx: number, by: number, bw: number, bh: number, d: number, c: string) =>
    `<g><path d="M${bx} ${by} h${bw} l${d} -${d * 0.7} h-${bw} z" fill="${c}" fill-opacity=".55" stroke="${c}" stroke-width=".8"/><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="url(#${id}b)" stroke="${c}" stroke-opacity=".5" stroke-width=".8"/><path d="M${bx} ${by}h${bw}" stroke="#E8FEFF" stroke-width="1.2"/></g>`;
  const bars = [4, 9, 14, 19].map((y) => `<rect x="${vx - 30}" y="${hz - 30 + y + y * 0.3}" width="60" height="${1 + y * 0.12}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs>
 <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05040E"/><stop offset=".6" stop-color="#1A0B2E"/><stop offset="1" stop-color="#3A0C35"/></linearGradient>
 <radialGradient id="${id}h" cx=".5" cy="1" r=".6"><stop offset="0" stop-color="#FF2E7E" stop-opacity=".55"/><stop offset="1" stop-color="#FF2E7E" stop-opacity="0"/></radialGradient>
 <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A0618"/><stop offset="1" stop-color="#03050B"/></linearGradient>
 <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C3C5A"/><stop offset="1" stop-color="#081320"/></linearGradient>
 <filter id="${id}gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
 <linearGradient id="${id}fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#05060D" stop-opacity="0"/><stop offset="1" stop-color="#05060D" stop-opacity=".92"/></linearGradient>
</defs>
<rect width="${W}" height="${hz}" fill="url(#${id}s)"/>
<g fill="#CFE8FF" fill-opacity=".55">${stars}</g>
<ellipse cx="${vx}" cy="${hz}" rx="210" ry="70" fill="url(#${id}h)"/>
<circle cx="${vx}" cy="${hz - 6}" r="26" fill="#FF5C9C" fill-opacity=".85"/>
<g fill="#05040E">${bars}</g>
<g fill="#07061A">${city}</g><g fill="#2BF5FF" fill-opacity=".7">${win}</g>
<rect y="${hz}" width="${W}" height="${h - hz}" fill="url(#${id}f)"/>
<g stroke="#2BF5FF" stroke-opacity=".5" stroke-width=".8">${grid}</g>
<line x1="0" y1="${hz}" x2="${W}" y2="${hz}" stroke="#FF8FC0" stroke-width="1.2"/>
<path d="${ring}" fill="#FF2E7E" fill-opacity=".06" stroke="#FF2E7E" stroke-width="5" stroke-opacity=".5" filter="url(#${id}gl)"/>
<path d="${ring}" fill="none" stroke="#FF8FC0" stroke-width="1.4"/>
${blk(vx - 104, h - 52, 30, 16, 10, "#2BF5FF")}${blk(vx + 70, h - 66, 24, 12, 8, "#7C9BFF")}${blk(vx - 40, hz + 26, 18, 8, 6, "#9D7CFF")}
<line x1="${vx - 26}" y1="${h - 44}" x2="${vx + 46}" y2="${hz + 40}" stroke="#2BF5FF" stroke-width="5" stroke-opacity=".5" filter="url(#${id}gl)"/>
<line x1="${vx - 26}" y1="${h - 44}" x2="${vx + 46}" y2="${hz + 40}" stroke="#E8FEFF" stroke-width="1.4"/>
<circle cx="${vx + 46}" cy="${hz + 40}" r="9" fill="#FFD3E3" filter="url(#${id}gl)"/>
<g><polygon points="${HEX(vx + 46, hz + 34, 10)}" fill="#3A0A1E" stroke="#FF2E7E" stroke-width="1.6"/><text x="${vx + 46}" y="${hz + 38}" fill="#FFD3E3" font-family="Tektur, sans-serif" font-weight="700" font-size="10" text-anchor="middle">K</text></g>
<g><polygon points="${HEX(vx - 88, hz + 36, 8)}" fill="#3A0A1E" stroke="#FF2E7E" stroke-width="1.3" stroke-opacity=".8"/></g>
<ellipse cx="${vx - 30}" cy="${h - 34}" rx="20" ry="6" fill="#2BF5FF" fill-opacity=".35" filter="url(#${id}gl)"/>
<g><polygon points="${HEX(vx - 30, h - 46, 14)}" fill="#06323A" stroke="#2BF5FF" stroke-width="2"/><polygon points="${HEX(vx - 30, h - 46, 10.5)}" fill="none" stroke="#2BF5FF" stroke-opacity=".35"/>
<text x="${vx - 30}" y="${h - 41}" fill="#D2FDFF" font-family="Tektur, sans-serif" font-weight="700" font-size="13" text-anchor="middle">Я</text></g>
<rect width="${W}" height="${h}" fill="url(#${id}fade)"/>
</svg>`;
}

/** Арт в обёртке; sweep — одна мягкая развёртка (эмбиент-анимация экрана лобби) */
export function ArenaArt({ id, h, className, sweep = false }: { id: string; h: number; className: string; sweep?: boolean }) {
  return (
    <span className={className} aria-hidden="true">
      <span className="ar-art-svg" dangerouslySetInnerHTML={{ __html: heroArtSvg(id, h) }} />
      {sweep && <i className="ar-sweep" />}
    </span>
  );
}
