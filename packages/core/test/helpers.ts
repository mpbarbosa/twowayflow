import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, "fixtures");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".flow.ts"))
    .sort();
}

export const EXAMPLE_DIR = join(here, "..", "..", "..", "examples");

export function exampleNames(): string[] {
  return readdirSync(EXAMPLE_DIR)
    .filter((f) => f.endsWith(".flow.ts"))
    .sort();
}

export function example(name: string): string {
  return readFileSync(join(EXAMPLE_DIR, name), "utf8");
}
