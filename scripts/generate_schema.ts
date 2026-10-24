import fs from 'node:fs/promises';
import path from 'node:path';

import { jsonSchemas } from '../src/game_data/json_schema';

/*
 * Writes the JSON Schema for each kind of data file to schema/:
 *
 *   npm run generate-schema           # write
 *   npm run generate-schema -- --check  # exit 1 if the files are out of date
 *
 * Run it after changing src/game_data/schema.ts.
 */

const dir = path.join(import.meta.dirname, '../schema');
const check = process.argv.includes('--check');

async function main() {
    let stale = false;
    for (const { file, json } of jsonSchemas()) {
        const target = path.join(dir, file);
        const text = JSON.stringify(json, null, 4) + '\n';
        if (check) {
            const current = await fs.readFile(target, 'utf8').catch(() => '');
            if (current !== text) {
                console.error(`schema/${file} is out of date`);
                stale = true;
            }
        } else {
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(target, text);
            console.log(`wrote schema/${file}`);
        }
    }
    return stale ? 1 : 0;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(2);
    }
);
