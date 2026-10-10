import Dashboard from "./Dashboard.jsx";

export default function Prematch(props) {
  return (
    <Dashboard
      {...props}
      title="Pre-jogo por periodo"
      subtitle="Busca de fixtures entre datas usando a API protegida no servidor."
    />
  );
}
