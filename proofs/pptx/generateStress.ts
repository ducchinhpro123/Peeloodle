/**
 * P05 proof entry point. Writes:
 *   proofs/out/p05-stress.pptx  — stress fixture mapped through the proof adapter
 *   proofs/out/p02-fixture.pptx — refreshed fixture with the chosen fonts
 * Run with: npx vite-node proofs/pptx/generateStress.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStressPresentation } from '../../src/features/presentations/model/fixtures/stress';
import { buildFixturePptx } from './exportFixture';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');

await mkdir(outDir, { recursive: true });
const fixture = await buildFixturePptx();
await writeFile(join(outDir, 'p02-fixture.pptx'), fixture.buffer);

const stress = await buildFixturePptx(createStressPresentation());
await writeFile(join(outDir, 'p05-stress.pptx'), stress.buffer);
await writeFile(
	join(outDir, 'p05-stress-report.json'),
	`${JSON.stringify(
		{
			...stress.report,
			expectedStrings: [
				'Đánh giá tác động của biến đổi khí hậu',
				'Đồng bằng sông Cửu Long',
				'Năng suất giảm 12%',
				'Khuyến nghị',
				'thích ứng'
			]
		},
		null,
		2
	)}\n`
);
console.log(`fixture ${fixture.buffer.length} bytes, stress ${stress.buffer.length} bytes`);
