export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Не записываем токены, пароли или тело запроса в логи.
  console.error("Ошибка приложения:", {
    method: req.method,
    path: req.path,
    name: err.name,
    code: err.code,
  });

  res.status(500).json({
    error: "Внутренняя ошибка сервера",
  });
};
