import { REGISTRATION_STEPS, type RegistrationStep } from '@/lib/rider-registration';

export function RegistrationProgress({ step, verified = false, busy = false, onSelect }: { step: RegistrationStep; verified?: boolean; busy?: boolean; onSelect?: (step: RegistrationStep) => void }) {
  return <nav className="ra-progress" aria-label="Rider registration progress"><ol>{REGISTRATION_STEPS.map((name, index) => <li key={name}>
    <button type="button" aria-current={index === step ? 'step' : undefined} disabled={busy || !onSelect || (index > 0 && !verified)} onClick={() => onSelect?.(index as RegistrationStep)}>
      <span className="ra-progress-number">{index === 0 && verified ? '✓' : index + 1}</span><span>{name}</span>
    </button>
  </li>)}</ol></nav>;
}
