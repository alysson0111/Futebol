export default function AnalysisBadge({ status }) {
  const wait = status !== "Entrada";
  return (
    <span className={`status ${wait ? "wait" : ""}`}>
      <span className="dot" />
      {status || "Observar"}
    </span>
  );
}
