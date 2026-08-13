import { describe, expect, it } from 'vitest';
import { serviceCgroupChildCount } from './serviceCgroup.ts';
import type { CgroupIo } from './serviceCgroup.ts';

function fakeIo(input: {
  controlGroup: string;
  mainPid: number;
  procs: Record<string, string>;
}): CgroupIo {
  return {
    systemctl(argv) {
      if (argv.includes('ControlGroup')) return input.controlGroup;
      if (argv.includes('MainPID')) return String(input.mainPid);
      throw new Error('unexpected systemctl arguments');
    },
    walk(root) {
      return Object.keys(input.procs).filter((name) => name.startsWith(root));
    },
    readFile(name) {
      const content = input.procs[name];
      if (content === undefined) throw new Error('missing fake file');
      return content;
    },
  };
}

describe('serviceCgroupChildCount', () => {
  it('counts every descendant cgroup process except the service main pid', () => {
    expect(serviceCgroupChildCount('kb-dashboard.service', ['/sys/fs/cgroup'], fakeIo({
      controlGroup: '/system.slice/kb-dashboard.service', mainPid: 41,
      procs: { '/sys/fs/cgroup/system.slice/kb-dashboard.service/cgroup.procs': '41\n42\n', '/sys/fs/cgroup/system.slice/kb-dashboard.service/worker/cgroup.procs': '43\n' },
    }))).toBe(2);
  });
});
