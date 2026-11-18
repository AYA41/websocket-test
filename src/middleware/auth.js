import { verifyAccessToken } from "../utils/jwt.js";

export const requireAuth = async (req, res, next) => {
  const authorization = req.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return res.status(401).json({
      error: "Требуется авторизация",
    });
  }

  try {
    const user = verifyAccessToken(match[1]);

    req.user = user;
    next();
  } catch {
    return res.status(401).json({
      error: "Токен недействителен или истёк",
    });
  }
};
