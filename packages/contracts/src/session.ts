import { z } from 'zod';

/** What the interface learns on load: signed in or not, and the CSRF token to send back. */
export const sessionStateSchema = z.object({
  authenticated: z.boolean(),
  csrfToken: z.string(),
});

export type SessionState = z.infer<typeof sessionStateSchema>;
