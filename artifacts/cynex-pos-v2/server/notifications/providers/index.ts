/**
 * Provider registry.
 *
 * Add SMS later by implementing NotificationProvider (for example Semaphore or
 * Twilio) and registering its channel here. The queue already stores channel
 * and provider names, so no data migration is needed.
 */

import { NotificationError, type NotificationChannel, type NotificationProvider } from '../types';
import { ResendProvider } from './resend';

type ProviderFactory = () => NotificationProvider;

const PROVIDERS: Partial<Record<NotificationChannel, ProviderFactory>> = {
  email: () => new ResendProvider(),
};

export function providerForChannel(channel: string): NotificationProvider {
  const factory = PROVIDERS[channel as NotificationChannel];
  if (!factory) {
    throw new NotificationError(`Unsupported notification channel: ${channel}`, 400, false);
  }
  return factory();
}

export function notificationServiceHealth(): {
  configured: boolean;
  provider: string;
  channels: Array<{ channel: string; provider: string; configured: boolean }>;
} {
  const channels = (Object.entries(PROVIDERS) as Array<[NotificationChannel, ProviderFactory]>).map(
    ([channel, factory]) => {
      const provider = factory();
      return { channel, provider: provider.id, configured: provider.isConfigured() };
    },
  );

  return {
    configured: channels.some((entry) => entry.configured),
    provider: 'resend',
    channels,
  };
}
