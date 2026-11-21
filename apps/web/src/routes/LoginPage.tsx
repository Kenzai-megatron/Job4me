import { Alert, Button, Card, Logo, TextField } from '@job4me/ui';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setCsrfToken } from '../api/client';
import { sessionQuery } from '../api/queries';
import { signWithPasskey } from '../auth/webauthn';
import { errorMessage } from '../components/errors';

type Step = 'passkey' | 'password' | 'code';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('passkey');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const supported = browserSupportsWebAuthn();
  const autofillStarted = useRef(false);

  const signedIn = async (result: { csrfToken: string }) => {
    setCsrfToken(result.csrfToken);
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    await navigate({ to: '/' });
  };

  const passkeyCeremony = async (autofill: boolean) => {
    const { options } = await api.post<{ options: unknown }>('/api/auth/passkey/options');
    const response = await signWithPasskey(options, autofill);
    const result = await api.post<{ csrfToken: string }>('/api/auth/passkey/verify', { response });
    await signedIn(result);
  };

  // Passkey suggestions in the field's autofill menu (conditional mediation), when available.
  useEffect(() => {
    if (!supported || autofillStarted.current) return;
    autofillStarted.current = true;
    void browserSupportsWebAuthnAutofill().then((available) => {
      if (!available) return;
      passkeyCeremony(true).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.post('/api/auth/password', { email, password });
      setPassword('');
      setStep('code');
    });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await signedIn(await api.post<{ csrfToken: string }>('/api/auth/second-factor', { code }));
      } catch (caught) {
        setCode('');
        throw caught;
      }
    });
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo className="text-3xl" />
      <Card>
        <div className="flex flex-col gap-5">
          <h1 className="text-2xl font-bold tracking-tight">
            {step === 'code' ? t('login.codeTitle') : t('login.title')}
          </h1>
          {error ? <Alert tone="error">{error}</Alert> : null}

          {step === 'passkey' ? (
            <div className="flex flex-col gap-4">
              <p className="text-muted">{t('login.intro')}</p>
              {supported ? null : <Alert>{t('login.noWebAuthn')}</Alert>}
              <TextField
                label={t('login.passkeyField')}
                name="username"
                autoComplete="username webauthn"
                className="sr-only"
                tabIndex={-1}
              />
              <Button
                onClick={() => void run(() => passkeyCeremony(false))}
                loading={busy}
                disabled={!supported}
                block
              >
                {t('login.passkeyButton')}
              </Button>
              <Button variant="ghost" onClick={() => setStep('password')} block>
                {t('login.usePassword')}
              </Button>
            </div>
          ) : null}

          {step === 'password' ? (
            <form className="flex flex-col gap-4" onSubmit={submitPassword}>
              <TextField
                label={t('login.email')}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <TextField
                label={t('login.password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <Button type="submit" loading={busy} block>
                {t('login.passwordSubmit')}
              </Button>
              <Button variant="ghost" onClick={() => setStep('passkey')} block>
                {t('login.usePasskey')}
              </Button>
            </form>
          ) : null}

          {step === 'code' ? (
            <form className="flex flex-col gap-4" onSubmit={submitCode}>
              <p className="text-muted">{t('login.codeIntro')}</p>
              <TextField
                label={t('login.code')}
                autoComplete="one-time-code"
                inputMode="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
                autoFocus
              />
              <Button type="submit" loading={busy} block>
                {t('login.codeSubmit')}
              </Button>
            </form>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
