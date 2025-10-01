import "./workers/emailWorker";
import "./workers/dataProcessingWorker";

console.log("🚀 Todos os workers foram iniciados!\n");
console.log("Aguardando jobs nas filas...");
console.log("Pressione Ctrl+C para encerrar.\n");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n👋 Encerrando workers...");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n👋 Encerrando workers...");
  process.exit(0);
});
