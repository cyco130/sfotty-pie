// Build entry point: writes the font files into fonts/.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PS_NAME, buildFonts } from "./font.ts";

const packageDir = join(import.meta.dirname, "..");
const { version } = JSON.parse(
	readFileSync(join(packageDir, "package.json"), "utf8"),
) as { version: string };

const { ttf, woff2 } = buildFonts(version);

const fontsDir = join(packageDir, "fonts");
mkdirSync(fontsDir, { recursive: true });
writeFileSync(join(fontsDir, `${PS_NAME}.ttf`), ttf);
writeFileSync(join(fontsDir, `${PS_NAME}.woff2`), woff2);
process.stdout.write(
	`Wrote fonts/${PS_NAME}.ttf (${ttf.length} bytes) and fonts/${PS_NAME}.woff2 (${woff2.length} bytes)\n`,
);
