import Joi from "joi";

const usernameSchema = Joi.string()
  .trim()
  .lowercase()
  .min(3)
  .max(24)
  .pattern(/^[a-z0-9_-]+$/)
  .required()
  .messages({
    "string.pattern.base":
      "Имя может содержать только латинские буквы, цифры, _ и -",
    "string.min": "Минимум 3 символа",
    "string.max": "Максимум 24 символа",
  });

const passwordSchema = Joi.string()
  .min(12)
  .max(72)
  .custom((value, helpers) => {
    if (Buffer.byteLength(value, "utf8") > 72) {
      return helpers.error("string.maxBytes");
    }

    return value;
  })
  .required()
  .messages({
    "string.maxBytes": "Пароль не должен превышать 72 байта в UTF-8",
  });

export const credentialsSchema = Joi.object({
  username: usernameSchema,
  password: passwordSchema,
}).unknown(false);

export const messageSchema = Joi.object({
  text: Joi.string().trim().min(1).max(2000).required(),
}).unknown(false);

export const dmSchema = Joi.object({
  toUserId: Joi.number().integer().positive().required(),
  text: Joi.string().trim().min(1).max(2000).required(),
}).unknown(false);

export const historySchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
}).unknown(false);
