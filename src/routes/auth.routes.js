import express from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import { signAccessToken } from "../utils/jwt.js";
import { credentialsSchema } from "../utils/validation.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const validateCredentials = (req, res, next) => {
  const { error, value } = credentialsSchema.validate(req.body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      error: "Некорректные данные",
      details: error.details.map((item) => item.message),
    });
  }

  req.validatedBody = value;
  next();
};

// POST /api/auth/register
router.post("/register", validateCredentials, async (req, res, next) => {
  try {
    const { username, password } = req.validatedBody;

    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "Имя пользователя уже занято",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let user;

    try {
      user = await prisma.user.create({
        data: {
          username,
          passwordHash,
        },
        select: {
          id: true,
          username: true,
          createdAt: true,
        },
      });
    } catch (error) {
      // Защита от гонки двух одновременных регистраций.
      if (error.code === "P2002") {
        return res.status(409).json({
          error: "Имя пользователя уже занято",
        });
      }

      throw error;
    }

    res.status(201).json({
      user,
      token: signAccessToken(user),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post("/login", validateCredentials, async (req, res, next) => {
  try {
    const { username, password } = req.validatedBody;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        error: "Неверное имя пользователя или пароль",
      });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
      },
      token: signAccessToken(user),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        error: "Пользователь не найден",
      });
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

export default router;
