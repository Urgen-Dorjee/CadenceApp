import * as RadixSwitch from '@radix-ui/react-switch'

interface Props {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function Switch({ id, checked, onChange, disabled }: Props) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="relative w-9 h-5 shrink-0 rounded-full bg-line-strong data-[state=checked]:bg-accent transition-colors disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block w-4 h-4 rounded-full bg-white shadow translate-x-0.5 data-[state=checked]:translate-x-[18px] transition-transform" />
    </RadixSwitch.Root>
  )
}
