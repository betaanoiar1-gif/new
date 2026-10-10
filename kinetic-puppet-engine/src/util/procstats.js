// Peak-memory sampling for a process tree (node + Chrome children), read from /proc (Linux).
// Falls back to node's own RSS elsewhere. Units: MB (1 MB = 1024*1024 bytes).
import { readFileSync, readdirSync } from 'node:fs';

const PAGE_BYTES = 4096;

function snapshotTree(rootPid) {
  const children = new Map();
  const rss = new Map();
  let entries = [];
  try { entries = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return null; }
  for (const d of entries) {
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const statm = readFileSync(`/proc/${d}/statm`, 'utf8').split(' ');
      rss.set(Number(d), Number(statm[1]) * PAGE_BYTES);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(d));
    } catch { /* process exited between readdir and read */ }
  }
  let total = 0;
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rss.get(pid) || 0;
    for (const c of children.get(pid) || []) stack.push(c);
  }
  return total;
}

export class PeakMemorySampler {
  constructor(intervalMs = 50) {
    this.intervalMs = intervalMs;
    this.peakTreeBytes = 0;
    this.peakNodeBytes = 0;
    this.timer = null;
  }
  sample() {
    const node = process.memoryUsage().rss;
    this.peakNodeBytes = Math.max(this.peakNodeBytes, node);
    const tree = snapshotTree(process.pid);
    this.peakTreeBytes = Math.max(this.peakTreeBytes, tree ?? node);
  }
  start() {
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
    return this;
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.sample();
    return {
      peakTreeMB: +(this.peakTreeBytes / 1048576).toFixed(1),
      peakNodeMB: +(this.peakNodeBytes / 1048576).toFixed(1),
    };
  }
}
