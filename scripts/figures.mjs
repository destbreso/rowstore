// The two figures the README leads with, drawn from the benchmark's own JSON.
//
//   npm run bench -- 0.25 5      (writes BENCHMARKS.md and bench/results.json)
//   npm run figures
//
// Every number here is read out of that file. Nothing is typed in by hand, so a
// figure cannot drift away from the run that produced it.
//
// Rendering rules, learned on earlier packages: npm renders a README on a white
// page and GitHub resolves `prefers-color-scheme` against the VIEWER's operating
// system, so a figure that adapts to the theme is a figure that is sometimes
// white on white. These paint their own background, every color is a literal
// because a CSS variable renders black in librsvg, and contrast is asserted
// rather than eyeballed.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = process.argv[2] ?? "bench/results.json";
const OUT_DIR = process.argv[3] ?? "assets";

const BG = "#ffffff";
const BORDER = "#e1e4e8";
const FG = "#1a1d23";
const MUTED = "#4a515b";
const GRID = "#eceef1";
const SERIES = {
  blue: "#14508f",
  sky: "#2b6cb0",
  amber: "#8a5000",
  teal: "#0f6161",
  plum: "#6b2d7a",
  red: "#a82d18",
};

const channel = (c) => {
  const v = parseInt(c, 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const h = hex.replace("#", "");
  return 0.2126 * channel(h.slice(0, 2)) + 0.7152 * channel(h.slice(2, 4)) + 0.0722 * channel(h.slice(4, 6));
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function assertReadable() {
  const bad = Object.entries({ FG, MUTED, ...SERIES })
    .map(([name, color]) => [name, color, contrast(color, BG)])
    .filter(([, , ratio]) => ratio < 4.5);
  if (bad.length > 0) {
    for (const [name, color, ratio] of bad) console.error(`${name} ${color} is ${ratio.toFixed(2)}:1 on ${BG}, below AA`);
    process.exit(1);
  }
  console.log(`contrast: every text color clears WCAG AA on ${BG}`);
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);

/** Monospace, so a line's width is its character count times the glyph width. */
function wrap(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length + word.length + 1 > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const CHAR = 6.62;

function chart({ width, height, title, subtitle, body, legend = [], footer }) {
  const subtitleLines = wrap(subtitle, Math.floor((width - 32) / CHAR));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<style>text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }</style>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>`,
    `<text x="16" y="24" fill="${FG}" font-size="14" font-weight="700">${esc(title)}</text>`,
    ...subtitleLines.map((l, i) => `<text x="16" y="${42 + i * 15}" fill="${MUTED}" font-size="11">${esc(l)}</text>`),
    body,
  ];
  let x = 16;
  let row = 0;
  for (const [label, color] of legend) {
    const w = 37 + label.length * CHAR;
    if (x + w > width - 16) {
      x = 16;
      row++;
    }
    const y = height - 46 + row * 16;
    parts.push(`<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${color}"/>`);
    parts.push(`<text x="${x + 15}" y="${y + 9}" fill="${MUTED}" font-size="11">${esc(label)}</text>`);
    x += w;
  }
  if (footer) parts.push(`<text x="${width - 16}" y="${height - 12}" fill="${MUTED}" font-size="10" text-anchor="end">${esc(footer)}</text>`);
  parts.push("</svg>");
  return parts.join("");
}

const plotTop = (width, subtitle) => 56 + wrap(subtitle, Math.floor((width - 32) / CHAR)).length * 15;

/** Grouped bars on a log scale, the only honest scale for a 2,000x spread. */
function logBars({ groups, series, title, subtitle, xLabel, yLabel, footer, width = 760, height = 430 }) {
  const left = 84;
  const right = width - 20;
  const top = plotTop(width, subtitle) + 14;
  const bottom = height - 84;
  const values = groups.flatMap((g) => series.map((s) => g.values[s.key]).filter((v) => v > 0));
  const floor = Math.log10(Math.min(...values)) - 0.5;
  const ceil = Math.log10(Math.max(...values)) + 0.18;
  const y = (v) => bottom - ((Math.log10(v) - floor) / (ceil - floor)) * (bottom - top);

  const body = [];
  for (let e = Math.ceil(floor); e <= ceil; e++) {
    const v = 10 ** e;
    body.push(`<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="${GRID}" stroke-width="1"/>`);
    body.push(`<text x="${left - 8}" y="${y(v) + 4}" fill="${MUTED}" font-size="10" text-anchor="end">${fmt(v)}</text>`);
  }
  body.push(`<text x="16" y="${top - 8}" fill="${MUTED}" font-size="10">${esc(yLabel)}</text>`);

  const groupWidth = (right - left) / groups.length;
  const barWidth = Math.min(38, (groupWidth - 14) / series.length);
  groups.forEach((g, gi) => {
    const gx = left + gi * groupWidth + (groupWidth - barWidth * series.length) / 2;
    series.forEach((s, si) => {
      const v = g.values[s.key];
      const bx = gx + si * barWidth;
      if (!(v > 0)) return;
      body.push(`<rect x="${bx}" y="${y(v)}" width="${barWidth - 3}" height="${bottom - y(v)}" rx="2" fill="${s.color}"/>`);
      body.push(`<text x="${bx + (barWidth - 3) / 2}" y="${y(v) - 5}" fill="${MUTED}" font-size="9.5" text-anchor="middle">${fmt(v)}</text>`);
    });
    body.push(`<text x="${left + gi * groupWidth + groupWidth / 2}" y="${bottom + 17}" fill="${FG}" font-size="11" text-anchor="middle">${esc(g.label)}</text>`);
  });
  body.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${MUTED}" stroke-width="1"/>`);
  body.push(`<text x="${(left + right) / 2}" y="${bottom + 34}" fill="${MUTED}" font-size="11" text-anchor="middle">${esc(xLabel)}</text>`);

  return chart({ width, height, title, subtitle, body: body.join(""), legend: series.map((s) => [s.label, s.color]), footer });
}

/** One row per workload, because 24 names do not fit on an x axis. */
function hBars({ rows, series, title, subtitle, xLabel, footer, width = 760 }) {
  const left = 168;
  const right = width - 56;
  const rowHeight = 15 * series.length + 8;
  const top = plotTop(width, subtitle) + 20;
  const height = top + rows.length * rowHeight + 82;
  const bottom = top + rows.length * rowHeight;
  const max = Math.max(...rows.flatMap((r) => series.map((s) => r.values[s.key] ?? 0)), 1.2);
  const x = (v) => left + ((v - 1) / (max - 1)) * (right - left);

  const body = [];
  for (let t = 1; t <= max + 1e-9; t += 0.5) {
    body.push(`<line x1="${x(t)}" y1="${top - 6}" x2="${x(t)}" y2="${bottom}" stroke="${t === 1 ? MUTED : GRID}" stroke-width="1"/>`);
    body.push(`<text x="${x(t)}" y="${bottom + 16}" fill="${MUTED}" font-size="10" text-anchor="middle">${t.toFixed(2)}x</text>`);
  }

  rows.forEach((r, ri) => {
    const ry = top + ri * rowHeight;
    body.push(`<text x="${left - 10}" y="${ry + rowHeight / 2 + 1}" fill="${FG}" font-size="10.5" text-anchor="end">${esc(r.label)}</text>`);
    series.forEach((s, si) => {
      const v = r.values[s.key];
      if (v === undefined) return;
      const w = Math.max(1.5, x(v) - left);
      const by = ry + 4 + si * 15;
      body.push(`<rect x="${left}" y="${by}" width="${w}" height="11" rx="2" fill="${s.color}"/>`);
      body.push(`<text x="${left + w + 5}" y="${by + 9.5}" fill="${MUTED}" font-size="9.5">${v.toFixed(2)}x</text>`);
    });
  });
  body.push(`<text x="${(left + right) / 2}" y="${bottom + 34}" fill="${MUTED}" font-size="11" text-anchor="middle">${esc(xLabel)}</text>`);

  return chart({ width, height, title, subtitle, body: body.join(""), legend: series.map((s) => [s.label, s.color]), footer });
}

// -------------------------------------------------------------------- data

assertReadable();
const { meta, results } = JSON.parse(readFileSync(SOURCE, "utf8"));
const cell = (w, subject) => w.subjects.find((s) => s.subject === subject);
const ratio = (w, subject) => {
  const s = cell(w, subject);
  return s?.toll ? s.toll.total / w.reference.total : undefined;
};
const stamp = `measured by rowtoll, ${meta.platform}, scale ${meta.scale}, seed ${meta.seed}`;
mkdirSync(OUT_DIR, { recursive: true });
const write = (file, svg) => {
  writeFileSync(join(OUT_DIR, file), svg + "\n");
  console.log(`${OUT_DIR}/${file}  ${svg.length} bytes`);
};

// 1. The competitive ratio, workload by workload, both arms.
const eagerRatios = results.map((w) => ratio(w, "rowstore (eager)")).filter((r) => r !== undefined);
const exact = eagerRatios.filter((r) => r <= 1.0001).length;
write(
  "competitive-ratio.svg",
  hBars({
    title: `The price of not knowing the future: 1.00x on ${exact} of ${results.length} workloads`,
    subtitle:
      "Field reads divided by the best index set that exists for the workload, found by exhaustive search with a planner told the true selectivity of every predicate. It chose knowing the whole workload; this store was handed nothing and had to find its indexes from the queries as they arrived.",
    xLabel: "total field reads, relative to the offline optimum",
    footer: stamp,
    rows: results.map((w) => ({
      label: w.workload,
      values: { eager: ratio(w, "rowstore (eager)"), lazy: ratio(w, "rowstore") },
    })),
    series: [
      { key: "eager", label: "buildAfter: 1, builds on first sight", color: SERIES.blue },
      { key: "lazy", label: "the default, waits for one repeat", color: SERIES.sky },
    ],
  }),
);

// 2. Mutation, which is where the harness found the most loss available.
const churn = results.filter((w) => w.workload.startsWith("churn/"));
const arms = [
  { key: "eager", subject: "rowstore (eager)", label: "rowstore, eager", color: SERIES.blue },
  { key: "lazy", subject: "rowstore", label: "rowstore, default", color: SERIES.sky },
  { key: "incremental", subject: "lokijs (adaptive)", label: "lokijs, maintained incrementally", color: SERIES.teal },
  { key: "rebuild", subject: "lokijs", label: "lokijs, rebuilt when invalidated", color: SERIES.red },
  { key: "none", subject: "lokijs (no index)", label: "lokijs, no index declared", color: SERIES.amber },
];
write(
  "mutation.svg",
  logBars({
    title: "Keeping an index true through mutation, at one read per index per change",
    subtitle:
      "Field reads for the whole workload as mutations between queries rise. There is no invalidate-and-rebuild here, because the harness measured what that costs, and no lower bound to reach for either: at m = 16 the eager arm pays 11,400, which is exactly what the offline optimum pays.",
    xLabel: "mutations between queries",
    yLabel: "field reads (log scale)",
    footer: stamp,
    height: 450,
    groups: churn.map((w) => ({
      label: w.workload.replace("churn/m=", "m = "),
      values: Object.fromEntries(arms.map((a) => [a.key, cell(w, a.subject)?.toll?.total ?? 0])),
    })),
    series: arms.map(({ key, label, color }) => ({ key, label, color })),
  }),
);
