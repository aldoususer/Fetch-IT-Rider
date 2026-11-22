import { REGISTRATION_STEPS, type RegistrationStep } from '@/lib/rider-registration';

export function RegistrationProgress({ step, verified = false, busy = false, onSelect }: { step: RegistrationStep; verified?: boolean; busy?: boolean; onSelect?: (step: RegistrationStep) => void }) {
  return <div className="ra-progress">
    <p>Step {step + 1} of {REGISTRATION_STEPS.length}</p>
    <progress value={step + 1} max={REGISTRATION_STEPS.length} aria-label="Application step"/>
    {onSelect && verified && <details>
      <summary>Application steps</summary>
      <nav aria-label="Application steps"><ol>{REGISTRATION_STEPS.map((name, index) => <li key={name}>
        <button type="button" aria-current={index === step ? 'step' : undefined} disabled={busy} onClick={event => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          onSelect(index as RegistrationStep);
        }}>{name}</button>
      </li>)}</ol></nav>
    </details>}
  </div>;
}
