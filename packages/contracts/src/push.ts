import { z } from 'zod';

/** A browser push subscription (PushSubscription.toJSON()). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string() });
export const pushUnsubscribeRequestSchema = z.object({ endpoint: z.url().max(2048) });
export const pushStatusResponseSchema = z.object({ devices: z.number().int() });
