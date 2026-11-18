// Im Demo werden keine Mails verschickt
export default { createTransport: () => ({ sendMail: async () => {} }) };
