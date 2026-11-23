import type { SourceRun } from '@job4me/contracts';
import { formatDateTime, formatNumber } from '@job4me/i18n';
import { Badge } from '@job4me/ui';
import { useTranslation } from 'react-i18next';

/** Why a run did not go as planned: the reason of a skip, or the error with its HTTP status. */
export function useRunDetail() {
  const { t } = useTranslation();
  return (run: SourceRun): string | null => {
    if (run.skipReason) return t(`sources.skipReasons.${run.skipReason}`);
    if (!run.errorCode) return null;
    const error = t(`sources.errorCodes.${run.errorCode}`);
    return run.httpStatus ? t('sources.httpStatus', { error, status: run.httpStatus }) : error;
  };
}

/** Status, what was read, kept and new, how long it took, and why when it did not succeed. */
export function RunSummary({ run, withDate = true }: { run: SourceRun; withDate?: boolean }) {
  const { t } = useTranslation();
  const detail = useRunDetail()(run);
  const counted = run.status !== 'skipped' && run.status !== 'running';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={run.status === 'succeeded' ? 'accent' : 'neutral'}>
          {t(`sources.statuses.${run.status}`)}
        </Badge>
        {counted ? (
          <span className="text-sm">
            {t('sources.counts', {
              read: formatNumber(run.readCount),
              kept: formatNumber(run.keptCount),
              fresh: formatNumber(run.newCount),
            })}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        {[
          withDate && run.finishedAt ? formatDateTime(run.finishedAt) : null,
          withDate ? t(`sources.triggers.${run.trigger}`) : null,
          counted && run.durationMs !== null
            ? t('sources.duration', {
                seconds: formatNumber(Math.round(run.durationMs / 100) / 10),
              })
            : null,
          detail,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}
