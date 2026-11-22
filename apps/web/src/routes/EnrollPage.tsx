import { Alert, Button, Card, Logo, TextField } from '@job4me/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, setCsrfToken } from '../api/client';
import { sessionQuery } from '../api/queries';
import { createPasskey } from '../auth/webauthn';
import { RecoveryCodes } from '../components/RecoveryCodes';
import { useWithReauth } from '../components/ReauthProvider';
import { errorMessage } from '../components/errors';

type Step = 'passkey' | 'totp' | 'codes';
const STEPS: Step[] = ['passkey', 'totp', 'codes'];

/** Reads the one-time token from the fragment, then removes it from the address bar. */
function takeToken(): string | null {
  const match = /^#t=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return match?.[1] ?? null;
}

export function EnrollPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const withReauth = useWithReauth();
  const [token] = useState(takeToken);
  const [step, setStep] = useState<Step>('passkey');
  const [error, setError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [totp, setTotp] = useState<{ secret: string; qrCode: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [stored, setStored] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'link_invalid') setLinkInvalid(true);
      else setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const createFirstPasskey = () =>
    run(async () => {
      const { options } = await api.post<{ options: unknown }>('/api/auth/enroll/options', {
        token,
      });
      const response = await createPasskey(options);
      const result = await api.post<{ csrfToken: string }>('/api/auth/enroll/verify', {
        token,
        response,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setCsrfToken(result.csrfToken);
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
      setStep('totp');
    });

  useEffect(() => {
    if (step === 'totp' && !totp) {
      void run(async () => {
        setTotp(
          await withReauth(() =>
            api.post<{ secret: string; qrCode: string }>('/api/auth/totp/setup'),
          ),
        );
      });
    }
    if (step === 'codes' && !codes) {
      void run(async () => {
        const result = await withReauth(() =>
          api.post<{ codes: string[] }>('/api/auth/recovery-codes'),
        );
        setCodes(result.codes);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const confirmTotp = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.post('/api/auth/totp/confirm', { code });
      setStep('codes');
    });
  };

  const stepNumber = STEPS.indexOf(step) + 1;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Logo className="text-3xl" />
      <Card>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('enroll.steps', { current: stepNumber, total: STEPS.length })}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{t('enroll.title')}</h1>
          </div>

          {!token ? <Alert tone="error">{t('enroll.noToken')}</Alert> : null}
          {linkInvalid ? (
            <Alert tone="error" title={t('enroll.linkInvalidTitle')}>
              {t('enroll.linkInvalid')}
            </Alert>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}

          {token && !linkInvalid && step === 'passkey' ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('enroll.passkeyTitle')}</h2>
              <p className="text-muted">{t('enroll.passkeyIntro')}</p>
              <TextField
                label={t('enroll.passkeyName')}
                hint={t('enroll.passkeyNameHint')}
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
              />
              <Button onClick={() => void createFirstPasskey()} loading={busy} block>
                {t('enroll.passkeyButton')}
              </Button>
            </div>
          ) : null}

          {step === 'totp' ? (
            <form className="flex flex-col gap-4" onSubmit={confirmTotp}>
              <h2 className="text-lg font-semibold">{t('enroll.totpTitle')}</h2>
              <p className="text-muted">{t('enroll.totpIntro')}</p>
              {totp ? (
                <>
                  <img
                    src={totp.qrCode}
                    alt={t('enroll.totpQrAlt')}
                    width={240}
                    height={240}
                    className="mx-auto rounded-md border border-line bg-white p-2"
                  />
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold">
                      {t('enroll.totpManual')}
                    </summary>
                    <code className="mt-2 block break-all rounded-md bg-surface-muted p-3 font-mono">
                      {totp.secret.match(/.{1,4}/g)?.join(' ')}
                    </code>
                  </details>
                </>
              ) : null}
              <TextField
                label={t('enroll.totpCode')}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                required
              />
              <Button type="submit" loading={busy} disabled={!totp} block>
                {t('enroll.totpConfirm')}
              </Button>
              <p className="text-sm text-muted">{t('enroll.totpSkipWarning')}</p>
              <Button variant="ghost" onClick={() => setStep('codes')} block>
                {t('enroll.totpSkip')}
              </Button>
            </form>
          ) : null}

          {step === 'codes' ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('enroll.codesTitle')}</h2>
              <p className="text-muted">{t('enroll.codesIntro')}</p>
              {codes ? <RecoveryCodes codes={codes} /> : null}
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--accent)]"
                  checked={stored}
                  onChange={(event) => setStored(event.target.checked)}
                />
                <span>{t('enroll.codesStored')}</span>
              </label>
              <Button onClick={() => void navigate({ to: '/' })} disabled={!stored || !codes} block>
                {t('enroll.finish')}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
