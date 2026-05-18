import { z } from 'zod';

export const UpdateSessionSchema = z.object({
  title: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((d) => d.title !== undefined || d.metadata !== undefined, {
  message: 'At least one of title or metadata is required',
});

export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>;
