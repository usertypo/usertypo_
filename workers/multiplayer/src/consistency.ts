/** WPM consistency (kogasa-style) from progress snapshots — matches Render socket-server. */
export function computeConsistencyFromSnapshots(
  snapshots: Array<[number, number, number, number]>,
): number {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return 100;
  const rawWpms: number[] = [];
  for (let i = 1; i < snapshots.length; i += 1) {
    const dtMs = snapshots[i][3] - snapshots[i - 1][3];
    if (dtMs <= 0) continue;
    const deltaKeystrokes = snapshots[i][2] - snapshots[i - 1][2];
    if (deltaKeystrokes <= 0) continue;
    const dtMin = dtMs / 60_000;
    rawWpms.push(Math.max(0, (deltaKeystrokes / 5) / dtMin));
  }
  if (rawWpms.length < 2) return 100;
  const mean = rawWpms.reduce((a, b) => a + b, 0) / rawWpms.length;
  if (mean <= 0) return 100;
  const stdDev = Math.sqrt(
    rawWpms.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / rawWpms.length,
  );
  const cov = stdDev / mean;
  const kogasa = 100 * (1 - Math.tanh(cov + (cov ** 3) / 3 + (cov ** 5) / 5));
  return Math.max(0, Math.min(100, Math.round(kogasa)));
}
