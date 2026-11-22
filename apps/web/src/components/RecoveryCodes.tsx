import { Button } from '@job4me/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Shows recovery codes once, with copy and download (they are never shown again). */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = t('enroll.codesFile');
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-1 gap-2 rounded-md border border-line bg-surface-muted p-4 font-mono text-base tabular-nums sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button variant="secondary" onClick={download}>
          {t('common.download')}
        </Button>
      </div>
    </div>
  );
}
