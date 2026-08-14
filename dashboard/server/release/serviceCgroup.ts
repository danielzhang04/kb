import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
// Cgroup paths are always slash-delimited, including when the dashboard runs on Windows.
import { posix as path } from 'node:path';

export interface CgroupIo {
  systemctl(argv: readonly string[]): string;
  walk(root: string): string[];
  readFile(name: string): string;
}

function walk(root: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const name = path.join(root, entry.name);
    if (entry.isDirectory()) entries.push(...walk(name));
    else entries.push(name);
  }
  return entries;
}

export const productionCgroupIo: CgroupIo = {
  systemctl(argv) {
    return execFileSync('systemctl', [...argv], { encoding: 'utf8' });
  },
  walk,
  readFile(name) {
    return readFileSync(name, 'utf8');
  },
};

export function serviceCgroupChildCount(
  unit = process.env.DASHBOARD_SERVICE_UNIT ?? 'kb-dashboard.service',
  roots: readonly string[] = ['/sys/fs/cgroup'],
  io: CgroupIo = productionCgroupIo,
): number {
  const group = io.systemctl(['show', '--property', 'ControlGroup', '--value', unit]).trim();
  const mainPid = Number.parseInt(io.systemctl(['show', '--property', 'MainPID', '--value', unit]).trim(), 10);
  if (!group.startsWith('/') || group === '/' || !Number.isInteger(mainPid) || mainPid <= 0) throw new Error('invalid service cgroup identity');
  const cgroupRoot = roots[0];
  if (!cgroupRoot) throw new Error('invalid service cgroup root');
  const root = path.resolve(cgroupRoot, `.${group}`);
  if (path.relative(path.resolve(cgroupRoot), root).startsWith('..')) throw new Error('service cgroup escapes root');
  const pids = new Set<number>();
  for (const file of io.walk(root).filter((name) => path.basename(name) === 'cgroup.procs')) {
    for (const row of io.readFile(file).split(/\s+/)) {
      const pid = Number.parseInt(row, 10);
      if (Number.isInteger(pid) && pid > 0 && pid !== mainPid) pids.add(pid);
    }
  }
  return pids.size;
}
