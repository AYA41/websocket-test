import { Server } from "socket.io";
import prisma from "../config/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { messageSchema, dmSchema, historySchema } from "../utils/validation.js";

const MAX_EVENTS = 15;
const WINDOW_MS = 5000;

export const createChat = (httpServer, allowedOrigins) => {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: false,
    },
    // Дополнительная проверка Origin при установке соединения.
    allowRequest(req, callback) {
      const origin = req.headers.origin;

      callback(null, !origin || allowedOrigins.includes(origin));
    },
    maxHttpBufferSize: 1e6,
    connectTimeout: 10000,
  });

  // userId -> Set(socketId)
  const onlineUsers = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (typeof token !== "string" || !token) {
        return next(new Error("Требуется авторизация"));
      }

      const payload = verifyAccessToken(token);

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { id: true, username: true },
      });

      if (!user) {
        return next(new Error("Пользователь не найден"));
      }

      socket.user = user;
      next();
    } catch {
      next(new Error("Недействительный или просроченный токен"));
    }
  });

  function emitError(socket, message) {
    socket.emit("chat:error", { message });
  }

  function checkRateLimit(socket) {
    const now = Date.now();

    if (!socket.data.rate || now - socket.data.rate.start >= WINDOW_MS) {
      socket.data.rate = { start: now, count: 0 };
    }

    socket.data.rate.count += 1;
    return socket.data.rate.count <= MAX_EVENTS;
  }

  function validate(schema, data) {
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      convert: true,
      stripUnknown: false,
    });

    return error ? null : value;
  }

  function toPublicUser(user) {
    return {
      id: user.id,
      username: user.username,
    };
  }

  function toGlobalMessage(message) {
    return {
      id: message.id,
      text: message.text,
      type: "global",
      author: toPublicUser(message.sender),
      createdAt: message.createdAt.toISOString(),
    };
  }

  function toDirectMessage(message) {
    return {
      id: message.id,
      text: message.text,
      type: "dm",
      from: toPublicUser(message.sender),
      toUserId: message.recipientId,
      createdAt: message.createdAt.toISOString(),
    };
  }

  async function getOnlineList() {
    const ids = Array.from(onlineUsers.keys());

    if (!ids.length) return [];

    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
  }

  async function broadcastUsers() {
    io.emit("users:list", await getOnlineList());
  }

  io.on("connection", async (socket) => {
    const user = socket.user;
    const userId = user.id;

    let sockets = onlineUsers.get(userId);

    if (!sockets) {
      sockets = new Set();
      onlineUsers.set(userId, sockets);
    }

    const wasOffline = sockets.size === 0;

    sockets.add(socket.id);
    socket.join(`user:${userId}`);

    try {
      const history = await prisma.message.findMany({
        where: { type: "global" },
        include: {
          sender: {
            select: { id: true, username: true },
          },
        },
        orderBy: { id: "desc" },
        take: 100,
      });

      socket.emit("messages:history", history.reverse().map(toGlobalMessage));

      await broadcastUsers();

      if (wasOffline) {
        socket.broadcast.emit("user:online", toPublicUser(user));
      }
    } catch {
      emitError(socket, "Не удалось загрузить историю чата");
    }

    // Общий чат.
    socket.on("message:send", async (data) => {
      if (!checkRateLimit(socket)) {
        return emitError(socket, "Слишком много событий. Подождите.");
      }

      const value = validate(messageSchema, data);

      if (!value) {
        return emitError(socket, "Некорректный текст сообщения");
      }

      try {
        const message = await prisma.message.create({
          data: {
            text: value.text,
            type: "global",
            senderId: userId,
          },
          include: {
            sender: {
              select: { id: true, username: true },
            },
          },
        });

        io.emit("message:new", toGlobalMessage(message));
      } catch {
        emitError(socket, "Не удалось сохранить сообщение");
      }
    });

    // Личные сообщения.
    socket.on("dm:send", async (data) => {
      if (!checkRateLimit(socket)) {
        return emitError(socket, "Слишком много событий. Подождите.");
      }

      const value = validate(dmSchema, data);

      if (!value || value.toUserId === userId) {
        return emitError(socket, "Некорректный получатель или текст");
      }

      try {
        const recipient = await prisma.user.findUnique({
          where: { id: value.toUserId },
          select: { id: true },
        });

        if (!recipient) {
          return emitError(socket, "Получатель не найден");
        }

        const message = await prisma.message.create({
          data: {
            text: value.text,
            type: "dm",
            senderId: userId,
            recipientId: recipient.id,
          },
          include: {
            sender: {
              select: { id: true, username: true },
            },
          },
        });

        const serialized = toDirectMessage(message);
        const delivered = Boolean(onlineUsers.get(recipient.id)?.size);

        // Сообщение сохраняется независимо от того,
        // находится ли получатель онлайн.
        if (delivered) {
          io.to(`user:${recipient.id}`).emit("dm:received", serialized);
        }

        socket.emit("dm:sent", {
          ...serialized,
          delivered,
        });
      } catch {
        emitError(socket, "Не удалось отправить сообщение");
      }
    });

    // История личной переписки.
    socket.on("dm:history", async (data) => {
      if (!checkRateLimit(socket)) {
        return emitError(socket, "Слишком много запросов");
      }

      const value = validate(historySchema, data);

      if (!value || value.userId === userId) {
        return emitError(socket, "Некорректный пользователь");
      }

      try {
        const otherUser = await prisma.user.findUnique({
          where: { id: value.userId },
          select: { id: true },
        });

        if (!otherUser) {
          return emitError(socket, "Пользователь не найден");
        }

        const messages = await prisma.message.findMany({
          where: {
            type: "dm",
            OR: [
              {
                senderId: userId,
                recipientId: value.userId,
              },
              {
                senderId: value.userId,
                recipientId: userId,
              },
            ],
          },
          include: {
            sender: {
              select: { id: true, username: true },
            },
          },
          orderBy: { id: "desc" },
          take: 100,
        });

        socket.emit("dm:history", {
          userId: value.userId,
          messages: messages.reverse().map(toDirectMessage),
        });
      } catch {
        emitError(socket, "Не удалось загрузить переписку");
      }
    });

    // Индикатор печати в личном чате.
    socket.on("typing:start", (data) => {
      if (!checkRateLimit(socket)) return;

      const recipientId = Number(data?.toUserId);

      if (
        !Number.isSafeInteger(recipientId) ||
        recipientId <= 0 ||
        recipientId === userId
      )
        return;

      socket.to(`user:${recipientId}`).emit("typing:update", {
        userId,
        username: user.username,
        isTyping: true,
      });
    });

    socket.on("typing:stop", (data) => {
      const recipientId = Number(data?.toUserId);

      if (
        !Number.isSafeInteger(recipientId) ||
        recipientId <= 0 ||
        recipientId === userId
      )
        return;

      socket.to(`user:${recipientId}`).emit("typing:update", {
        userId,
        username: user.username,
        isTyping: false,
      });
    });

    socket.on("disconnect", async (reason) => {
      const currentSockets = onlineUsers.get(userId);

      if (!currentSockets) return;

      currentSockets.delete(socket.id);

      if (currentSockets.size === 0) {
        onlineUsers.delete(userId);

        io.emit("user:offline", { id: userId });

        try {
          await broadcastUsers();
        } catch {
          console.error("Не удалось обновить список пользователей");
        }
      }

      console.log(`Отключение пользователя ${userId}: ${reason}`);
    });
  });

  return io;
};
