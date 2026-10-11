// FreeZone BD - tiny QR code maker (no libraries, no internet). Byte mode, error correction level M, versions 1-10 (up to 213 characters).
// makeQR("https://...") -> array of rows, each row an array of true (dark) / false (light) squares.
// drawQR(canvas, text, size) paints it on a canvas with the white "quiet zone" around it.

const EC = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// Reed-Solomon arithmetic in GF(256)
const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= gmul(c, EXP[i]); });
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gmul(gen[i + 1], factor);
  });
  return rem;
}

function bchBits(value, poly, bits) {
  let v = value << bits;
  const top = (n) => 31 - Math.clz32(n);
  while (top(v) >= top(poly)) v ^= poly << (top(v) - top(poly));
  return (value << bits) | v;
}

export function makeQR(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const [, b1, d1, b2, d2] = EC[v];
    if (bytes.length + 2 + (v > 9 ? 1 : 0) <= b1 * d1 + b2 * d2) { version = v; break; }
  }
  if (!version) throw new Error("Text is too long for the QR code");
  const [ecLen, b1, d1, b2, d2] = EC[version];
  const dataCap = b1 * d1 + b2 * d2;

  // bit stream: mode 0100, length, data, terminator, padding
  const bits = [];
  const put = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4);
  put(bytes.length, version > 9 ? 16 : 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

  // split into blocks, add error correction, interleave
  const blocks = [];
  let pos = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2;
    const chunk = data.slice(pos, pos + len);
    pos += len;
    blocks.push({ chunk, ec: rsRemainder(chunk, ecLen) });
  }
  const stream = [];
  for (let i = 0; i < Math.max(d1, d2); i++) blocks.forEach((b) => { if (i < b.chunk.length) stream.push(b.chunk[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => stream.push(b.ec[i]));

  // matrix
  const n = version * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false)); // function modules (not data)
  const setF = (r, c, dark) => { if (r >= 0 && r < n && c >= 0 && c < n) { m[r][c] = dark; fn[r][c] = true; } };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      setF(r0 + r, c0 + c, inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const al = ALIGN[version];
  al.forEach((r) => al.forEach((c) => {
    const last = al.length - 1;
    if ((r === al[0] && c === al[0]) || (r === al[0] && c === al[last]) || (r === al[last] && c === al[0])) return; // overlaps a finder
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }));
  setF(n - 8, 8, true); // dark module
  for (let i = 0; i < 9; i++) { if (!fn[8][i]) setF(8, i, false); if (!fn[i][8]) setF(i, 8, false); }
  for (let i = 0; i < 8; i++) { setF(8, n - 1 - i, false); setF(n - 1 - i, 8, false); }
  if (version >= 7) {
    const info = bchBits(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) { const bit = ((info >> i) & 1) === 1; setF(Math.floor(i / 3), n - 11 + (i % 3), bit); setF(n - 11 + (i % 3), Math.floor(i / 3), bit); }
  }

  // place data bits in the zig-zag order
  const all = [];
  stream.forEach((b) => { for (let i = 7; i >= 0; i--) all.push((b >> i) & 1); });
  const cells = [];
  let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c = 5;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (let k = 0; k < 2; k++) if (!fn[r][c - k]) cells.push([r, c - k]);
    }
    up = !up;
  }
  cells.forEach(([r, c], i) => { m[r][c] = (all[i] || 0) === 1; });

  const MASKS = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  const build = (mask) => {
    const g = m.map((row) => row.slice());
    cells.forEach(([r, c]) => { if (MASKS[mask](r, c)) g[r][c] = !g[r][c]; });
    const fmt = bchBits(mask, 0x537, 10) ^ 0x5412; // level M = 00
    const bit = (i) => ((fmt >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
    g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
    for (let i = 9; i < 15; i++) g[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) g[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) g[n - 15 + i][8] = bit(i);
    g[n - 8][8] = true;
    return g;
  };

  const penalty = (g) => {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          const cur = pass ? g[b][a] : g[a][b], prev = pass ? g[b - 1][a] : g[a][b - 1];
          if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
      }
    }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) p += 3;
    const pat = [true, false, true, true, true, false, true, false, false, false, false];
    const rev = pat.slice().reverse();
    for (let r = 0; r < n; r++) for (let c = 0; c <= n - 11; c++) {
      if (pat.every((v, k) => g[r][c + k] === v) || rev.every((v, k) => g[r][c + k] === v)) p += 40;
      if (pat.every((v, k) => g[c + k][r] === v) || rev.every((v, k) => g[c + k][r] === v)) p += 40;
    }
    const dark = g.reduce((s, row) => s + row.filter(Boolean).length, 0);
    p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return p;
  };

  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = build(mask), s = penalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best;
}

export function drawQR(canvas, text, size = 280) {
  const grid = makeQR(text);
  const quiet = 4;
  const total = grid.length + quiet * 2;
  const scale = Math.max(1, Math.floor(size / total));
  canvas.width = canvas.height = total * scale;
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000000";
  grid.forEach((row, r) => row.forEach((dark, c) => { if (dark) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale); }));
  return canvas;
}
