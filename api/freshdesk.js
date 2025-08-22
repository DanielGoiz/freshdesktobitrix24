import axios from "axios";

const BITRIX_WEBHOOK_URL = "https://SEU_DOMINIO.bitrix24.com/rest/1/SEU_TOKEN/tasks.task.add";
const RESPONSIBLE_ID = 1; // ID do usuário responsável na sua conta Bitrix24
const DEADLINE_DAYS = 1; // prazo padrão em dias
const MAX_RETRIES = 3; // número de tentativas em caso de erro temporário

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const data = req.body || {};

  const ticketId = data.id || data.ticket_id || (data.ticket && data.ticket.id);
  const subject = data.subject || (data.ticket && data.ticket.subject) || "Ticket sem assunto";
  const description =
    data.description_text ||
    data.description ||
    (data.ticket && (data.ticket.description_text || data.ticket.description)) ||
    "Sem descrição";
  const requesterEmail =
    data.requester_email ||
    (data.requester && data.requester.email) ||
    (data.ticket && data.ticket.requester && data.ticket.requester.email) ||
    data.email;

  if (!ticketId) {
    return res.status(400).json({ error: "Ticket ID ausente" });
  }

  // Calcula deadline
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + DEADLINE_DAYS);

  // Monta título e descrição da tarefa
  const title = `Freshdesk #${ticketId} – ${subject}`.slice(0, 255);
  const desc = [
    description,
    "",
    "—",
    "Metadados:",
    requesterEmail ? `Solicitante: ${requesterEmail}` : null,
    "Origem: Freshdesk"
  ].filter(Boolean).join("\n");

  const bitrixPayload = {
    fields: {
      TITLE: title,
      DESCRIPTION: desc,
      RESPONSIBLE_ID: RESPONSIBLE_ID,
      DEADLINE: deadline.toISOString(),
      PRIORITY: 2, // prioridade alta
      STATUS: 2 // nova
    }
  };

  // Função de envio com retry
  const sendTask = async (payload) => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Tentativa ${attempt}: Enviando tarefa para Bitrix24`);
        const response = await axios.post(BITRIX_WEBHOOK_URL, payload, { timeout: 10000 });
        if (response.data.error) {
          throw new Error(`Bitrix24 erro: ${JSON.stringify(response.data)}`);
        }
        console.log("Tarefa criada com sucesso:", response.data);
        return response.data;
      } catch (err) {
        console.error(`Erro na tentativa ${attempt}:`, err.response?.data || err.message);
        if (attempt === MAX_RETRIES) throw err;
      }
    }
  };

  try {
    const result = await sendTask(bitrixPayload);
    return res.status(200).json({ ok: true, bitrix_result: result });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao criar tarefa no Bitrix24", details: err.response?.data || err.message });
  }
}
