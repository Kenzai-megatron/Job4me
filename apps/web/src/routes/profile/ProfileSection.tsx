import { Card } from '@job4me/ui';
import type { ReactNode } from 'react';

/** A rubric of the profile page: a titled card that the completeness links point to. */
export function ProfileSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <Card aria-labelledby={headingId} className="scroll-mt-20">
      <div id={id} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          {intro ? <p className="text-sm text-muted">{intro}</p> : null}
        </div>
        {children}
      </div>
    </Card>
  );
}
