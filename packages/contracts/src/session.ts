import { z } from 'zod';

/** What the interface learns on load: signed in or not, who, and the CSRF token to send back. */
export const sessionStateSchema = z.object({
  authenticated: z.boolean(),
  csrfToken: z.string(),
  user: z
    .object({
      displayName: z.string(),
      locale: z.string(),
      timeZone: z.string(),
    })
    .optional(),
});

export type SessionState = z.infer<typeof sessionStateSchema>;
