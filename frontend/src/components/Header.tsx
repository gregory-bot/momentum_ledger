interface Props {
  services: Record<string, string> | undefined;
}

export function Header({ services }: Props) {
  return (
    <header className="top">
      <div className="brand">
        <div className="logo" aria-hidden>
          ML
        </div>
        <div>
          <h1>Momentum Ledger</h1>
          <p>Verified, personalized match intelligence · synthetic data</p>
        </div>
      </div>
      <ul className="chips" aria-label="Active services">
        {services &&
          Object.entries(services).map(([k, v]) => (
            <li className="chip" key={k}>
              {k.replace("_", " ")}: <b>{v}</b>
            </li>
          ))}
      </ul>
    </header>
  );
}
