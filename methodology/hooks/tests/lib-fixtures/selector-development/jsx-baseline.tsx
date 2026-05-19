export function SubmitButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button className="btn-primary" onClick={onClick}>{label}</button>;
}
