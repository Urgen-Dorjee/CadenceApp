/** "2.10.0" > "2.9.1" */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}
