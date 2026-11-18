let token = null;
let currentUser = null;
let socket = null;
let activeChat = { type: "global", userId: null };
let typingTimeout = null;
let isTyping = false;

const $ = (selector) => document.querySelector(selector);

const histories = new Map();

const authView = $("#authView");
const chatView = $("#chatView");
const authStatus = $("#authStatus");
const chatStatus = $("#chatStatus");
const messagesElement = $("#messages");
const usersElement = $("#users");
const messageInput = $("#messageInput");
const typingStatus = $("#typingStatus");

function historyKey(chat) {
  return chat.type === "global" ? "global" : `dm:${chat.userId}`;
}

function setStatus(element, text) {
  element.textContent = text;
}

async function api(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = "message";

  const author = message.author || message.from || {};
  const own = Number(author.id) === Number(currentUser.id);

  if (own) article.classList.add("mine");

  const name = document.createElement("strong");
  name.textContent = own ? "Вы" : author.username || "Пользователь";

  const text = document.createElement("div");
  text.textContent = message.text;

  const time = document.createElement("small");
  time.textContent = message.createdAt
    ? new Date(message.createdAt).toLocaleString()
    : "";

  article.append(name, text, time);
  messagesElement.appendChild(article);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function addToHistory(chat, message) {
  const key = historyKey(chat);

  if (!histories.has(key)) histories.set(key, []);

  const list = histories.get(key);

  // Не добавляем одно сообщение повторно.
  if (list.some((item) => item.id === message.id)) return;

  list.push(message);

  if (list.length > 100) list.shift();

  if (historyKey(activeChat) === key) {
    renderMessage(message);
  }
}

function showHistory(chat) {
  messagesElement.replaceChildren();

  for (const message of histories.get(historyKey(chat)) || []) {
    renderMessage(message);
  }
}

function setActiveChat(type, userId = null, username = "") {
  stopTyping();

  activeChat = { type, userId };
  typingStatus.textContent = "";

  $("#chatTitle").textContent =
    type === "global"
      ? "Общий чат"
      : `Переписка с ${username || "пользователем"}`;

  showHistory(activeChat);
  setStatus(chatStatus, "");

  if (type === "dm" && socket?.connected) {
    socket.emit("dm:history", { userId });
  }
}

function showUsers(users) {
  usersElement.replaceChildren();

  for (const user of users) {
    if (Number(user.id) === Number(currentUser.id)) continue;

    const button = document.createElement("button");
    button.className = "user-button";
    button.textContent = "● " + user.username;

    button.addEventListener("click", () => {
      setActiveChat("dm", user.id, user.username);
    });

    usersElement.appendChild(button);
  }
}

function connectSocket() {
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    setStatus($("#connectionStatus"), "Подключено");
  });

  socket.on("connect_error", (error) => {
    setStatus($("#connectionStatus"), "Ошибка подключения");
    setStatus(chatStatus, error.message);

    if (/токен|авторизац|недействител|ист[её]к/i.test(error.message)) {
      socket.disconnect();
    }
  });

  socket.on("disconnect", () => {
    setStatus($("#connectionStatus"), "Отключено");
    typingStatus.textContent = "";
  });

  socket.on("chat:error", (data) => {
    setStatus(chatStatus, data.message);
  });

  socket.on("users:list", showUsers);

  socket.on("user:online", (user) => {
    setStatus(chatStatus, user.username + " теперь онлайн");
  });

  socket.on("user:offline", (user) => {
    setStatus(chatStatus, `Пользователь ${user.id} отключился`);
  });

  socket.on("messages:history", (messages) => {
    histories.set("global", messages);
    if (activeChat.type === "global") showHistory(activeChat);
  });

  socket.on("message:new", (message) => {
    addToHistory({ type: "global" }, message);
  });

  socket.on("dm:history", ({ userId, messages }) => {
    histories.set(`dm:${userId}`, messages);

    if (
      activeChat.type === "dm" &&
      Number(activeChat.userId) === Number(userId)
    ) {
      showHistory(activeChat);
    }
  });

  socket.on("dm:received", (message) => {
    const otherId = message.from.id;

    addToHistory({ type: "dm", userId: otherId }, message);

    if (
      activeChat.type !== "dm" ||
      Number(activeChat.userId) !== Number(otherId)
    ) {
      setStatus(chatStatus, "Новое личное сообщение");
    }
  });

  socket.on("dm:sent", (message) => {
    addToHistory({ type: "dm", userId: message.toUserId }, message);

    setStatus(
      chatStatus,
      message.delivered
        ? "Сообщение доставлено"
        : "Сообщение сохранено. Получатель офлайн.",
    );
  });

  socket.on("typing:update", (data) => {
    if (
      activeChat.type !== "dm" ||
      Number(activeChat.userId) !== Number(data.userId)
    )
      return;

    typingStatus.textContent = data.isTyping
      ? `${data.username} печатает...`
      : "";
  });
}

async function authenticate(mode) {
  const username = $("#username").value.trim();
  const password = $("#password").value;

  setStatus(authStatus, "");

  try {
    const data = await api(`/api/auth/${mode}`, { username, password });

    token = data.token;
    currentUser = data.user;

    $("#profile").textContent = `Вы вошли как ${currentUser.username}`;

    authView.classList.add("hidden");
    chatView.classList.remove("hidden");

    connectSocket();
  } catch (error) {
    setStatus(authStatus, error.message);
  }
}

$("#authForm").addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate("login");
});

$("#registerBtn").addEventListener("click", () => {
  authenticate("register");
});

$("#globalBtn").addEventListener("click", () => {
  setActiveChat("global");
});

$("#backBtn").addEventListener("click", () => {
  setActiveChat("global");
});

function stopTyping() {
  clearTimeout(typingTimeout);

  if (isTyping && activeChat.type === "dm" && socket?.connected) {
    socket.emit("typing:stop", { toUserId: activeChat.userId });
  }

  isTyping = false;
}

messageInput.addEventListener("input", () => {
  if (activeChat.type !== "dm" || !socket?.connected) return;

  if (!isTyping) {
    isTyping = true;
    socket.emit("typing:start", { toUserId: activeChat.userId });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 1000);
});

$("#messageForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();

  if (!text || !socket?.connected) return;

  if (activeChat.type === "global") {
    socket.emit("message:send", { text });
  } else {
    socket.emit("dm:send", {
      toUserId: activeChat.userId,
      text,
    });
  }

  messageInput.value = "";
  stopTyping();
});

$("#logoutBtn").addEventListener("click", () => {
  stopTyping();

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  token = null;
  currentUser = null;
  histories.clear();

  messagesElement.replaceChildren();
  usersElement.replaceChildren();

  chatView.classList.add("hidden");
  authView.classList.remove("hidden");

  $("#password").value = "";
  setStatus(authStatus, "Вы вышли из чата");
});
