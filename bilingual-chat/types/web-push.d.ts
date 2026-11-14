// web-push v4 est livré sans types : déclaration minimale de ce qu'on utilise.
declare module "web-push" {
  export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  export type RequestOptions = {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    timeout?: number;
  };
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: RequestOptions,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
  export class WebPushError extends Error {
    statusCode: number;
    endpoint: string;
  }
}
