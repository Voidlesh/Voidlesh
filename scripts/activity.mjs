// Renders a minimal weekly-contributions chart for the profile README.
// Usage: GITHUB_TOKEN=... node scripts/activity.mjs <username>
import { writeFileSync, mkdirSync } from "node:fs";

const USERNAME = process.argv[2] ?? "Voidlesh";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = "assets";

const DAYS = 91;
const WIDTH = 840;
const HEIGHT = 220;
const PAD = { top: 52, right: 24, bottom: 34, left: 24 };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const THEMES = {
  light: { title: "#1f2328", muted: "#656d76", grid: "#d0d7de", line: "#6d28d9", area: "#6d28d9" },
  dark: { title: "#e6edf3", muted: "#7d8590", grid: "#30363d", line: "#a78bfa", area: "#a78bfa" },
};

async function fetchCalendar() {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub API error: ${JSON.stringify(json.errors)}`);
  return json.data.user.contributionsCollection.contributionCalendar;
}

function lastDays(calendar) {
  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .slice(-DAYS)
    .map((day) => ({ start: new Date(day.date), count: day.contributionCount }));
}

// Catmull-Rom spline converted to cubic Béziers, clamped so the curve never dips below the baseline.
function smoothPath(points, baseline) {
  return points.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const p0 = points[i - 2] ?? points[i - 1];
    const p1 = points[i - 1];
    const p2 = points[i + 1] ?? p;
    const c1y = Math.min(baseline, p1.y + (p.y - p0.y) / 6);
    const c2y = Math.min(baseline, p.y - (p2.y - p1.y) / 6);
    const c1x = p1.x + (p.x - p0.x) / 6;
    const c2x = p.x - (p2.x - p1.x) / 6;
    return `${d} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }, "");
}

function monthLabels(days, xAt) {
  return days
    .map((day, i) => ({ day, i }))
    .filter(({ day, i }) => i > 0 && day.start.getMonth() !== days[i - 1].start.getMonth())
    .filter(({ i }) => i < days.length - 2)
    .map(({ day, i }) => ({ x: xAt(i), label: MONTHS[day.start.getMonth()] }));
}

function render(calendar, theme) {
  const days = lastDays(calendar);
  const max = Math.max(1, ...days.map((d) => d.count));
  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + chartH;
  const xAt = (i) => PAD.left + (i / (days.length - 1)) * chartW;
  const yAt = (count) => baseline - (count / max) * chartH;

  const points = days.map((d, i) => ({ x: xAt(i), y: yAt(d.count) }));
  const line = smoothPath(points, baseline);
  const area = `${line} L${xAt(days.length - 1)},${baseline} L${PAD.left},${baseline} Z`;
  const total = days.reduce((sum, day) => sum + day.count, 0).toLocaleString("en-US");
  const labels = monthLabels(days, xAt)
    .map(({ x, label }) => `<text x="${x.toFixed(1)}" y="${HEIGHT - 10}" text-anchor="middle">${label}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${total} contributions in the last 3 months">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${theme.area}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${theme.area}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g font-family="${FONT}">
    <text x="${PAD.left}" y="26" font-size="14" fill="${theme.muted}"><tspan font-weight="600" fill="${theme.title}">${total}</tspan> contributions in the last 3 months</text>
    <line x1="${PAD.left}" y1="${baseline}" x2="${WIDTH - PAD.right}" y2="${baseline}" stroke="${theme.grid}" stroke-width="1"/>
    <path d="${area}" fill="url(#fill)"/>
    <path d="${line}" fill="none" stroke="${theme.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <g font-size="11" fill="${theme.muted}">${labels}</g>
  </g>
</svg>
`;
}

const calendar = await fetchCalendar();
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(`${OUT_DIR}/activity-3m-${name}.svg`, render(calendar, theme));
}
console.log(`Rendered activity chart: ${calendar.totalContributions} contributions`);
