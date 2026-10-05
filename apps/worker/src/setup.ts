import { promises as fs } from 'node:fs';
import { config } from './config.js';

/** Writes the isolate config, adding per-box CPU pinning when JUDGE_CPUS is set. */
export async function writeIsolateConfig(): Promise<void> {
  const lines = [
    'box_root = /var/local/lib/isolate',
    'lock_root = /run/isolate/locks',
    'cg_root = /sys/fs/cgroup/isolate',
    'first_uid = 60000',
    'first_gid = 60000',
    'num_boxes = 1000',
  ];
  config.cpus.forEach((cpu, slot) => {
    for (let k = 0; k < 10; k++) lines.push(`box${slot * 10 + k}.cpus = ${cpu}`);
  });
  await fs.mkdir('/run/isolate/locks', { recursive: true });
  await fs.writeFile(config.isolateConfig, lines.join('\n') + '\n');
}
