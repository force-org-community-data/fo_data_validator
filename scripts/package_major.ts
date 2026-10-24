import fs from 'node:fs';
import path from 'node:path';

/* The package's semver major, which the schemas' `$id` is built from */
export function packageMajor(): number {
    const file = path.join(import.meta.dirname, '../package.json');
    const { version } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        version: string;
    };
    return Number(version.split('.')[0]);
}
