"use client";
import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './input';
import { cn } from '@/lib/utils';

export function PasswordInput({ className, disabled, visibilityLabel = 'password', ...props }: Omit<ComponentProps<'input'>, 'type'> & { visibilityLabel?: string }) {
  const [visible, setVisible] = useState(false);
  const label = `${visible ? 'Hide' : 'Show'} ${visibilityLabel}`;
  return <div className="relative">
    <Input {...props} disabled={disabled} type={visible ? 'text' : 'password'} className={cn(className, 'pr-12')}/>
    <button type="button" aria-label={label} title={label} aria-pressed={visible} aria-controls={props.id} disabled={disabled}
      className="absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      onClick={() => setVisible(value => !value)}>
      {visible ? <EyeOff className="h-4 w-4" aria-hidden="true"/> : <Eye className="h-4 w-4" aria-hidden="true"/>}
    </button>
  </div>;
}
