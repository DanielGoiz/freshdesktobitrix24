import axios from "axios";

const BITRIX_TASK_ADD_URL = "https://alfanexus.bitrix24.com.br/rest/13/pxv2w31pfrpuk2oe/tasks.task.add";

const RESPONSIBLE_ID = 13; // responsável principal
const ACCOMPLICES = [1];   // co-responsáveis
const DEADLINE_DAYS = 3;
const MAX_RETRIES = 3;

// Calcula deadline
const getDeadline = (days = DEADLINE_DAYS) => {
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + days);
  return deadline.toISOString();
};

// Monta título da tarefa
const buildTitle = (ticketId, subject) => `Freshdesk #${ticketId} – ${subject}`.slice(0, 255);

// Monta descrição da tarefa, incluindo anexos como links
const buildDescription = (data) => {
  const requesterEmail = data.requester_email || "Não informado";
  const descriptionText = data.description_text || "Sem descrição";

  // Garante que tags seja array
  const tags = Array.isArray(data.tags) ? data.tags.join(", ") : "Nenhuma";
  const status = data.status || "Não informado";
  const priority = data.priority || "Não informado";

  // Garante que attachments seja array
  let attachments = "Nenhum";
  if (Array.isArray(data.attachments) && data.attachments.length > 0) {
    attachments = data.attachments
      .map((att, idx) => {
        if (!att) return null;
        const url = att.content_url || att;
        const name = att.name || `Anexo ${idx + 1}`;
        if (!url) return null;
        return `${idx + 1}. ${name}: ${url}`;
      })
      .filter(Boolean)
      .join("\n");
    if (!attachments) attachments = "Nenhum";
  }

  return [
    "=== DESCRIÇÃO ===",
    descriptionText,
    "",
    "=== METADADOS DO TICKET ===",
    `Solicitante: ${requesterEmail}`,
    `Status: ${status}`,
    `Prioridade: ${priority}`,
    `Tags: ${tags}`,
    "",
    "=== ANEXOS ===",
    attachments,
    "",
    "Origem: Freshdesk"
  ].join("\n");
};

// Função de envio com retry
const sendTask = async (payload) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(BITRIX_TASK_ADD_URL, payload, { timeout: 10000 });
      if (response.data.error) throw new Error(`Bitrix24 erro: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (err) {
      console.error(`Erro na tentativa ${attempt}:`, err.response?.data || err.message);
      if (attempt === MAX_RETRIES) throw err;
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const data = req.body || {};
  const ticketId = data.id;
  const subject = data.subject || "Ticket sem assunto";

  if (!ticketId) return res.status(400).json({ error: "Ticket ID ausente" });

  try {
    const title = buildTitle(ticketId, subject);
    const description = buildDescription(data);
    const deadline = getDeadline();

    const bitrixPayload = {
      fields: {
        TITLE: title,
        DESCRIPTION: description,
        RESPONSIBLE_ID: RESPONSIBLE_ID,
        ACCOMPLICES: ACCOMPLICES,
        DEADLINE: deadline,
        PRIORITY: 2,
        STATUS: 2
      }
    };

    const result = await sendTask(bitrixPayload);
    return res.status(200).json({ ok: true, bitrix_result: result });

  } catch (err) {
    console.error("Erro geral no handler:", err.message);
    return res.status(500).json({
      error: "Falha ao criar tarefa no Bitrix24",
      details: err.response?.data || err.message
    });
  }
}
