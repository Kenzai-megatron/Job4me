import { Alert, Badge, Button, Card, Logo, ScoreBadge, TextField } from '@job4me/ui';
import { useTranslation } from 'react-i18next';

// Development only (not in production builds): the design system on one page, to validate
// colours, type and components on real screens (plan, section 10).

const TOKENS = [
  'bg',
  'surface',
  'surface-muted',
  'ink',
  'muted',
  'line',
  'line-strong',
  'accent',
  'accent-soft',
  'danger',
  'score-80',
  'score-60',
  'score-40',
  'score-0',
];

export function DesignPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <Logo className="text-4xl" />
        <p className="text-muted">Design system — page de développement</p>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Couleurs</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOKENS.map((token) => (
            <div key={token} className="flex flex-col gap-1">
              <div
                className="h-12 rounded-md border border-line"
                style={{ background: `var(--${token})` }}
              />
              <code className="text-xs">--{token}</code>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Typographie</h2>
        <p className="text-3xl font-bold tracking-tight">Titre de page, 30 px</p>
        <p className="text-xl font-semibold">Titre de section, 20 px</p>
        <p>Texte courant, 16 px : le minimum sur téléphone.</p>
        <p className="text-sm text-muted">Texte secondaire, 14 px.</p>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Tranches de score</h2>
        <div className="flex flex-wrap gap-3">
          <ScoreBadge score={92} label={t('scores.band80')} />
          <ScoreBadge score={71} label={t('scores.band60')} />
          <ScoreBadge score={48} label={t('scores.band40')} />
          <ScoreBadge score={12} label={t('scores.band0')} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Composants</h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <Button>Principal</Button>
            <Button variant="secondary">Secondaire</Button>
            <Button variant="ghost">Discret</Button>
            <Button variant="danger">Supprimer</Button>
            <Button loading>Chargement</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Neutre</Badge>
            <Badge tone="accent">Accent</Badge>
          </div>
          <TextField label="Champ" hint="Une aide sous le champ." placeholder="Saisie" />
          <TextField label="Champ en erreur" error="Ce champ est obligatoire." />
          <Alert title="Information">Un message d'information.</Alert>
          <Alert tone="error" title="Erreur">
            Un message d'erreur.
          </Alert>
        </div>
      </Card>
    </main>
  );
}
