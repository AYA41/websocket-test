import express from "express";
import http from "http";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import prisma from "./config/prisma.js";
import { createChat } from "./socket/chat.js";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Аналог __filename и __dirname для ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin не разрешён"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  maxAge: 600,
};

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "10kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Слишком много попыток. Попробуйте позже.",
  },
});

app.use("/api/auth", authLimiter, authRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Список пользователей для авторизованного клиента.
app.get("/api/users", requireAuth, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { id: { not: req.user.id } },
      select: {
        id: true,
        username: true,
      },
      orderBy: { username: "asc" },
      take: 100,
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

// Статические файлы клиентского приложения.
app.use(express.static(path.join(__dirname, "../public")));

app.use((req, res) => {
  res.status(404).json({ error: "Маршрут не найден" });
});

app.use(errorHandler);

const io = createChat(httpServer, allowedOrigins);

export { app, httpServer, io };
