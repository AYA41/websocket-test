import "dotenv/config";
import { httpServer } from "./src/app.js";
import prisma from "./src/config/prisma.js";

if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
  throw new Error("JWT_SECRET должен содержать не менее 32 байт");
}

const PORT = Number(process.env.PORT || 3000);

httpServer.listen(PORT, () => {
  console.log(`Realtime Chat: http://localhost:${PORT}`);
});

async function shutdown() {
  console.log("Остановка сервера...");

  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
