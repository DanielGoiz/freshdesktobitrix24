import axios from "axios";

const BITRIX_WEBHOOK_URL = "https://alfanexus.bitrix24.com.br/rest/13/pxv2w31pfrpuk2oe/tasks.task.add";
const BITRIX_NOTIFY_URL = "https://alfanexus.bitrix24.com.br/rest/13/pxv2w31pfrpuk2oe/im.notify.system.add";

const RESPONSIBLE_ID = 13;
const DEADLINE_DAYS = 3;
const MAX_RETRIES = 3;

const getDeadline = (days = DEADLINE_DAYS) => {
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + days);
  return deadline.toISOString();
};

const buildTitle = (ticketId, requesterName, companyName) => {
  return `Chamado #${ticketId} - ${requesterName || "Cliente"} (${companyName || "Empresa"})`.slice(0, 255);
};

const buildDescription = (data) => {
  const requesterName =
    data.requester_name ||
    (data.requester && data.requester.name) ||
    (data.ticket && data.ticket.requester && data.ticket.requester.name) ||
    "Cliente";

  const requesterEmail =
    data.requester_email ||
    (data.requester && data.requester.email) ||
    (data.ticket && data.ticket.requester && data.ticket.requester.email) ||
    data.email ||
    "Não informado";

  // Aqui pegamos o assunto do Freshdesk e usamos como nome da empresa
  const companyName = data.subject || (data.ticket && data.ticket.subject) || "Empresa não informada";

  // Tipo do Freshdesk vira assunto da tarefa
  const subject = data.type || (data.ticket && data.ticket.type) || "Sem assunto";

  const description =
    data.description_text ||
    data.description ||
    (data.ticket && (data.ticket.description_text || data.ticket.description)) ||
    "Sem descrição";

  const hasAttachments =
    (data.attachments && data.attachments.length > 0) ||
    (data.ticket && data.ticket.attachments && data.ticket.attachments.length > 0)
      ? "📎 Ticket contém anexos"
      : "Sem anexos";

  return `
Assunto: ${subject}

Nome do Cliente: ${requesterName}
Empresa: ${companyName}
Email do Cliente: ${requesterEmail}

Descrição do Problema:
${description}

${hasAttachments}
  `;
};

const sendTask = async (payload) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Tentativa ${attempt}: Enviando tarefa para Bitrix24`);
      const response = await axios.post(BITRIX_WEBHOOK_URL, payload, { timeout: 10000 });
      if (response.data.error) throw new Error(`Bitrix24 erro: ${JSON.stringify(response.data)}`);
      console.log("Tarefa criada com sucesso:", response.data);
      return response.data;
    } catch (err) {
      console.error(`Erro na tentativa ${attempt}:`, err.response?.data || err.message);
      if (attempt === MAX_RETRIES) throw err;
    }
  }
};

const sendNotification = async (userId, message) => {
  try {
    const response = await axios.post(
      BITRIX_NOTIFY_URL,
      {
        USER_ID: userId,
        MESSAGE: message
      }
    );
    console.log("Notificação enviada:", response.data);
    return response.data;
  } catch (err) {
    console.error("Erro ao enviar notificação:", err.response?.data || err.message);
    throw err;
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const data = req.body || {};
  const ticketId = data.id || data.ticket_id || (data.ticket && data.ticket.id);

  const requesterName =
    data.requester_name ||
    (data.requester && data.requester.name) ||
    (data.ticket && data.ticket.requester && data.ticket.requester.name) ||
    "Cliente";

  // Assunto do Freshdesk como nome da empresa
  const companyName = data.subject || (data.ticket && data.ticket.subject) || "Empresa não informada";

  // Tipo do Freshdesk como assunto da tarefa
  const subject = data.type || (data.ticket && data.ticket.type) || "Sem assunto";

  if (!ticketId) return res.status(400).json({ error: "Ticket ID ausente" });

  const title = buildTitle(ticketId, requesterName, companyName);
  const description = buildDescription(data);
  const deadline = getDeadline();

  const bitrixPayload = {
    fields: {
      TITLE: title,
      DESCRIPTION: description,
      RESPONSIBLE_ID: RESPONSIBLE_ID,
      DEADLINE: deadline,
      PRIORITY: 2,
      STATUS: 2
    }
  };

  try {
    const result = await sendTask(bitrixPayload);

    const notificationMessage = `🔔 Novo chamado aberto!\nChamado #${ticketId} - ${requesterName} (${companyName})\nAssunto: ${subject}`;
    await sendNotification(RESPONSIBLE_ID, notificationMessage);

    return res.status(200).json({ ok: true, bitrix_result: result });
  } catch (err) {
    return res.status(500).json({
      error: "Falha ao criar tarefa ou enviar notificação no Bitrix24",
      details: err.response?.data || err.message
    });
  }
}
