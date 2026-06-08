import { z } from 'zod';

/**
 * Optional overrides for the vdb_chunks.json → LanceDB conversion.
 * All fields fall back to env vars / sensible defaults resolved in the service.
 */
export const ConvertVdbSchema = z.object({
  sourceFile: z
    .string()
    .optional()
    .describe('Absolute or repo-relative path to the embeddings source vdb_chunks.json file.'),
  dbDir: z
    .string()
    .optional()
    .describe('Directory that will hold the LanceDB database (the "lancedb" folder).'),
  tableName: z
    .string()
    .min(1)
    .optional()
    .describe('Name of the LanceDB table to (re)create. Defaults to "vdb_chunks".'),
  overwrite: z
    .boolean()
    .optional()
    .describe('Overwrite the table if it already exists (default true).'),
});

export type ConvertVdbDto = z.infer<typeof ConvertVdbSchema>;
