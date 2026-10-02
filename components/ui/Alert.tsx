import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type IconProps } from './icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export type AlertProps = {
  tone: AlertTone;
  className?: string;
  children: ReactNode;
};

const TONES: Record<AlertTone, { box: string; icon: string; Icon: (props: IconProps) => ReactNode }> = {
  info: { box: 'border-primary', icon: 'text-primary', Icon: Info },
  success: { box: 'border-success', icon: 'text-success', Icon: CircleCheck },
  warning: { box: 'border-warning', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'border-red-alliance', icon: 'text-red-alliance-text', Icon: CircleAlert },
};

/** Danger alerts interrupt screen readers (role="alert"); the rest are polite (role="status"). */
export function Alert({ tone, className, children }: AlertProps) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={[
        'flex items-start gap-3 border-l-4 bg-surface py-2 pr-3 pl-3 text-[15px] text-fg',
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
