import jwt from "jsonwebtoken";

const JWT_ISSUER = "realtime-chat";
const JWT_AUDIENCE = "realtime-chat-client";

export const signAccessToken = (user) => {
  return jwt.sign({ username: user.username }, process.env.JWT_SECRET, {
    subject: String(user.id),
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
};

export const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  const id = Number(payload.sub);

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof payload.username !== "string"
  ) {
    throw new Error("Некорректный JWT");
  }

  return {
    id,
    username: payload.username,
  };
};
