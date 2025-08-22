import axios from "axios";

const BITRIX_WEBHOOK_URL = "https://alfanexus.bitrix24.com.br/rest/13/pxv2w31pfrpuk2oe/tasks.task.add";
const RESPONSIBLE_ID = 13;
const DEADLINE_DAYS = 3;
const MAX_RETRIES = 3;

// Função para calcular deadline
const getDeadline = (days = DEADLINE_DAYS) => {
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + days);
  return deadline.toISOString();
};

// Função para montar título da tarefa
const buildTitle = (ticketId, subject) => {
  return `Freshdesk #${ticketId} – ${subject}`.slice(0, 255);
};

// Função para montar descrição detalhada
const buildDescription = (data) => {
  const requesterEmail =
    data.requester_email ||
    (data.requester && data.requester.email) ||
    (data.ticket && data.ticket.requester && data.ticket.requester.email) ||
    data.email;

  const description =
    data.description_text ||
    data.description ||
    (data.ticket && (data.ticket.description_text || data.ticket.description)) ||
    "Sem descrição";

  const tags = data.tags ? `Tags: ${data.tags.join(", ")}` : null;
  const status = data.status ? `Status do ticket: ${data.status}` : null;

  return [
    description,
    "",
    "—",
    "Metadados do Ticket:",
    requesterEmail ? `Solicitante: ${requesterEmail}` : null,
    status,
    tags,
    "Origem: Freshdesk"
  ].filter(Boolean).join("\n");
};

// Função de envio com retry
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const data = req.body || {};
  const ticketId = data.id || data.ticket_id || (data.ticket && data.ticket.id);
  const subject = data.subject || (data.ticket && data.ticket.subject) || "Ticket sem assunto";

  if (!ticketId) return res.status(400).json({ error: "Ticket ID ausente" });

  const title = buildTitle(ticketId, subject);
  const description = buildDescription(data);
  const deadline = getDeadline();

  const bitrixPayload = {
    fields: {
      TITLE: title,
      DESCRIPTION: description,
      RESPONSIBLE_ID: RESPONSIBLE_ID,
      DEADLINE: deadline,
      PRIORITY: 2, // alta
      STATUS: 2    // nova
    }
  };

  try {
    const result = await sendTask(bitrixPayload);
    return res.status(200).json({ ok: true, bitrix_result: result });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao criar tarefa no Bitrix24", details: err.response?.data || err.message });
  }
}
