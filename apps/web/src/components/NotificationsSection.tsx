import { Alert, Button, Card } from '@job4me/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from './errors';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** VAPID public key (base64url) to the bytes PushManager expects. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function NotificationsSection() {
  const { t } = useTranslation();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const devices = useQuery({
    queryKey: ['push-devices'],
    queryFn: () => api.get<{ devices: number }>('/api/push/subscriptions'),
  });
  const supported = pushSupported();
  const denied = supported && Notification.permission === 'denied';

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await task();
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  // iOS asks for the permission only after a tap, in an app installed on the home screen.
  const enable = () =>
    run(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(t('notifications.denied'));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await api.get<{ publicKey: string }>('/api/push/public-key');
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      await api.post('/api/push/subscriptions', subscription.toJSON());
      await devices.refetch();
      setMessage(t('notifications.enabled'));
    });

  const test = () =>
    run(async () => {
      await api.post('/api/push/test');
      setMessage(t('notifications.testSent'));
    });

  return (
    <Card aria-labelledby={titleId}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {t('notifications.title')}
          </h2>
          <p className="text-sm text-muted">{t('notifications.intro')}</p>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert>{message}</Alert> : null}
        {!supported ? <Alert>{t('notifications.unsupported')}</Alert> : null}
        {denied ? <Alert>{t('notifications.denied')}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={busy}
            disabled={!supported || denied}
            onClick={() => void enable()}
          >
            {t('notifications.enable')}
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            disabled={!devices.data?.devices}
            onClick={() => void test()}
          >
            {t('notifications.test')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
