declare module "web-push" {
  interface PushSubscription {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  interface PushPayload {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    image?: string;
    data?: Record<string, unknown>;
    tag?: string;
    requireInteraction?: boolean;
  }

  interface RequestOptions {
    headers?: Record<string, string>;
    proxy?: string;
  }

  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string
  ): void;

  export function sendNotification(
    subscription: PushSubscription,
    payload: string | Buffer,
    options?: RequestOptions
  ): Promise<void>;

  export function generateVAPIDKeys(): {
    publicKey: string;
    privateKey: string;
  };
}
