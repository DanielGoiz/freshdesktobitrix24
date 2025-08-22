import express from "express";
import axios from "axios";
import morgan from "morgan";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const DEFAULT_RESPONSIBLE_ID = parseInt(process.env.DEFAULT_RESPONSIBLE_ID || "1", 10);
const DEADLINE_DAYS = parseInt(process.env.DEADLINE_DAYS || "1", 10);
const SHARED_SECRET = process.env.SHARED_SECRET || null;

if (!BITRIX_WEBHOOK_URL) {
  console.warn("[WARN] BITRIX_WEBHOOK_URL não configurado. Defina no arquivo .env");
}

// Parsers para JSON e x-www-form-urlencoded (Freshdesk pode enviar de ambos jeitos)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(morgan("tiny"));

// Healthcheck
app.get("/", (_req, res) => {
  res.send("Freshdesk -> Bitrix24 integration is running.");
});

// Endpoint para Webhook do Freshdesk
app.post("/freshdesk", async (req, res) => {
  try {
    // Autorização simples por segredo compartilhado (opcional)
    if (SHARED_SECRET) {
      const headerSecret = req.get("X-Shared-Secret");
      if (!headerSecret || headerSecret !== SHARED_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    // Aceita payloads diretos de automations do Freshdesk (placeholders) ou genéricos
    const body = req.body || {};

    // Alguns provedores enviam string JSON em 'payload'
    let data = body;
    if (typeof body === "string") {
      try { data = JSON.parse(body); } catch {}
    }
    if (body.payload && typeof body.payload === "string") {
      try { data = JSON.parse(body.payload); } catch {}
    }

    // Suporta estrutura comum do Freshdesk
    // Esperados: id, subject, description / description_text, requester_email ou requester.email
    const ticketId = data.id || data.ticket_id || (data.ticket && data.ticket.id);
    const subject = data.subject || (data.ticket && data.ticket.subject) || "Ticket sem assunto";
    const description = data.description_text || data.description || (data.ticket && (data.ticket.description_text || data.ticket.description)) || "";
    const requesterEmail = data.requester_email || (data.requester && data.requester.email) || (data.ticket && data.ticket.requester && data.ticket.requester.email) || data.email;
    const priority = data.priority || (data.ticket && data.ticket.priority);
    const status = data.status || (data.ticket && data.ticket.status);

    if (!ticketId) {
      return res.status(400).json({ error: "Payload inválido: ticket id ausente" });
    }

    const deadlineISO = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + (Number.isFinite(DEADLINE_DAYS) ? DEADLINE_DAYS : 1));
      return d.toISOString();
    })();

    const title = `Freshdesk #${ticketId} – ${subject}`.slice(0, 255);
    const descLines = [
      description || "Sem descrição",
      "",
      "—",
      "Metadados:",
      requesterEmail ? `Solicitante: ${requesterEmail}` : null,
      priority != null ? `Prioridade: ${priority}` : null,
      status != null ? `Status: ${status}` : null,
      `Origem: Freshdesk`
    ].filter(Boolean);

    const bitrixPayload = {
      fields: {
        TITLE: title,
        DESCRIPTION: descLines.join("\n"),
        RESPONSIBLE_ID: DEFAULT_RESPONSIBLE_ID,
        DEADLINE: deadlineISO
      }
    };

    // Chamada à API do Bitrix24
    if (!BITRIX_WEBHOOK_URL) {
      return res.status(500).json({ error: "BITRIX_WEBHOOK_URL não configurado" });
    }

    const bxResp = await axios.post(BITRIX_WEBHOOK_URL, bitrixPayload, {
      timeout: 15000
    });

    if (bxResp.data && bxResp.data.error) {
      console.error("[Bitrix24 Error]", bxResp.data);
      return res.status(502).json({ error: "Erro Bitrix24", details: bxResp.data });
    }

    return res.status(200).json({ ok: true, bitrix_result: bxResp.data });
  } catch (err) {
    console.error("Erro geral:", err.response?.data || err.message);
    return res.status(500).json({ error: "Erro ao processar webhook", details: err.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor on port ${PORT}`);
});
