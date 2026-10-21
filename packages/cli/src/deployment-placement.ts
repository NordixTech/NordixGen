import { readFile, writeFile } from "node:fs/promises";
import { type ParseError, applyEdits, modify, parse } from "jsonc-parser";
import type { Environment } from "./deployment-model.js";

export const placementVariable = "NORDIX_WORKER_PLACEMENT";

/** Neon identifies provider-region; Wrangler uses provider:region as a placement hint. */
export function cloudflareRegion(neonRegion: string): string | undefined {
  const match = /^(aws|gcp|azure)-([a-z][a-z0-9-]{0,62})$/.exec(neonRegion);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

export function workerPlacement(value: string): { mode: "smart" } | { region: string } {
  if (value === "smart") return { mode: "smart" };
  if (/^(aws|gcp|azure):[a-z][a-z0-9-]{0,62}$/.test(value)) return { region: value };
  throw Error("Invalid backend placement. Select a cloud region or smart in cicd:setup.");
}

/** Apply on both build and deploy: ignored local profiles are unavailable in Workers Builds. */
export async function applyWorkerPlacement(
  file: string,
  environment: Environment,
  value: string | undefined,
): Promise<void> {
  if (value === undefined) return;
  const placement = workerPlacement(value);
  const source = await readFile(file, "utf8");
  const errors: ParseError[] = [];
  const config = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (
    errors.length ||
    !config ||
    typeof config !== "object" ||
    !config.env?.[environment] ||
    typeof config.env[environment] !== "object" ||
    Array.isArray(config.env[environment])
  )
    throw Error(
      "Invalid Wrangler environment configuration. Review wrangler.jsonc before retrying.",
    );
  const edits = modify(source, ["env", environment, "placement"], placement, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  const output = applyEdits(source, edits);
  if (output !== source) await writeFile(file, output);
}
