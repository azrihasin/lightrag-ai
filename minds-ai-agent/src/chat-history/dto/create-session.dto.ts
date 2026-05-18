import { z } from 'zod';

export const CreateSessionSchema = z.object({
  user_id: z.string().max(255).optional(),
  title: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;
