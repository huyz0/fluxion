export function view(props: { mode: string }) {
  if (props.mode === 'edit') return 1;
  return 0;
}
