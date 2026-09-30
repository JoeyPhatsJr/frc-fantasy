import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type IconProps } from './icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export type AlertProps = {
  tone: AlertTone;
  className?: string;
  children: ReactNode;
};

const TONES: Record<AlertTone, { box: string; icon: string; Icon: (props: IconProps) => ReactNode }> = {
  info: { box: 'border-primary/30 border-l-primary bg-primary/5', icon: 'text-primary', Icon: Info },
  success: { box: 'border-success/30 border-l-success bg-success/5', icon: 'text-success', Icon: CircleCheck },
  warning: { box: 'border-accent/50 border-l-accent bg-accent/10', icon: 'text-warning', Icon: TriangleAlert },
  danger: {
    box: 'border-red-alliance/30 border-l-red-alliance bg-red-alliance/5',
    icon: 'text-red-alliance',
    Icon: CircleAlert,
  },
};

/** Danger alerts interrupt screen readers (role="alert"); the rest are polite (role="status"). */
export function Alert({ tone, className, children }: AlertProps) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={[
        'flex items-start gap-3 rounded-xl border border-l-4 p-3 text-sm font-medium text-fg',
        box,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon className={`mt-px size-5 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
