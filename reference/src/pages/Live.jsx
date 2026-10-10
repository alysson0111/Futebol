import Dashboard from "./Dashboard.jsx";

export default function Live(props) {
  return (
    <Dashboard
      {...props}
      title="Jogos em andamento"
      subtitle="Ao vivo ativado automaticamente ao abrir o sistema."
    />
  );
}
