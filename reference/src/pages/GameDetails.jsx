import Dashboard from "./Dashboard.jsx";

export default function GameDetails(props) {
  return (
    <Dashboard
      {...props}
      title="Detalhes dos jogos"
      subtitle="Scanner, sinais e registro de resultado por mercado."
    />
  );
}
