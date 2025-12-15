const nodemailer = require('nodemailer');
const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASSWORD, EMAIL_FROM } = require('../config/env');

if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASSWORD) {
  throw new Error('EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD must be configured to send emails');
}

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_SECURE,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASSWORD,
  },
});

async function sendInvitationEmail({ to, link }) {
  return transporter.sendMail({
    from: EMAIL_FROM || EMAIL_USER,
    to,
    subject: 'Приглашение в Iggy Reserve',
    text: `Вы были приглашены войти в приложение Iggy Reserve. Для создания аккаунта перейдите по ссылке: ${link}`,
    html: `
      <p>Привет!</p>
      <p>Ты получил приглашение присоединиться к <strong>Iggy Reserve</strong>.</p>
      <p><a href="${link}">Нажми сюда, чтобы придумать пароль и завершить регистрацию</a></p>
      <p>Если ты не ожидаешь этого письма, просто проигнорируй его.</p>
    `,
  });
}

module.exports = {
  sendInvitationEmail,
};
