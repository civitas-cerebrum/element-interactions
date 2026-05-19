export function SubmitButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <div data-testid="submit-button"><button className="btn-primary" onClick={onClick}>{label}</button></div>;
}
