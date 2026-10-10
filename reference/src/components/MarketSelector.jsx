export default function MarketSelector({ value, onChange }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="all">Todos</option>
      <option value="over05">+0.5 gols</option>
      <option value="over15">+1.5 gols</option>
      <option value="over25">+2.5 gols</option>
      <option value="under25">Under 2.5</option>
      <option value="under35">Under 3.5 IA</option>
      <option value="corners">Escanteios</option>
      <option value="handicap">Handicap</option>
      <option value="ml">ML</option>
    </select>
  );
}
