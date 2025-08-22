import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const data = req.body || {};

    const ticketId = data.id || data.ticket_id || (data.ticket && data.ticket.id);
    const subject = data.subject || (data.ticket && data.ticket.subject) || "Ticket sem assunto";
    const description =
      data.description_text ||
      data.description ||
      (data.ticket && (data.ticket.description_text || data.ticket.description)) ||
      "";
    const requesterEmail =
      data.requester_email ||
      (data.requester && data.requester.email) ||
      (data.ticket && data.ticket.requester && data.ticket.requester.email) ||
      data.email;

    if (!ticketId) {
      return res.status(400).json({ error: "Ticket ID ausente" });
    }

    // Calcula prazo (deadline) com base na env DEADLINE_DAYS
    const deadlineDays = parseInt(process.env.DEADLINE_DAYS || "1", 10);
    const deadline = new Date();
    deadline.setUTCDate(deadline.getUTCDate() + deadlineDays);

    const title = `Freshdesk #${ticketId} – ${subject}`.slice(0, 255);
    const desc = [
      description || "Sem descrição",
      "",
      "—",
      "Metadados:",
      requesterEmail ? `Solicitante: ${requesterEmail}` : null,
      `Origem: Freshdesk`
    ]
      .filter(Boolean)
      .join("\n");

    const bitrixPayload = {
      fields: {
        TITLE: title,
        DESCRIPTION: desc,
        RESPONSIBLE_ID: process.env.DEFAULT_RESPONSIBLE_ID,
        DEADLINE: deadline.toISOString()
      }
    };

    const bxResp = await axios.post(process.env.BITRIX_WEBHOOK_URL, bitrixPayload, {
      timeout: 10000
    });

    if (bxResp.data && bxResp.data.error) {
      return res.status(502).json({ error: "Erro Bitrix24", details: bxResp.data });
    }

    return res.status(200).json({ ok: true, bitrix_result: bxResp.data });
  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({ error: "Erro geral", details: err.response?.data || err.message });
  }
}
