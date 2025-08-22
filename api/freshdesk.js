import axios from "axios";
import FormData from "form-data";

const BITRIX_TASK_ADD_URL = "https://alfanexus.bitrix24.com.br/rest/13/pxv2w31pfrpuk2oe/tasks.task.add";
const BITRIX_FILE_UPLOAD_URL = "https://alfanexus.bitrix24.com.br/rest/13/pxv2w31pfrpuk2oe/disk.folder.uploadfile";

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

// Monta descrição da tarefa
const buildDescription = (data) => {
  const requesterEmail = data.requester_email || "Não informado";
  const descriptionText = data.description_text || "Sem descrição";
  const tags = Array.isArray(data.tags) ? data.tags.join(", ") : "Nenhuma";
  const status = data.status || "Não informado";
  const priority = data.priority || "Não informado";

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
    "=== ORIGEM ===",
    "Freshdesk"
  ].join("\n");
};

// Faz upload de um arquivo no Bitrix e retorna o ID
const uploadFileToBitrix = async (fileUrl, fileName) => {
  try {
    const fileResp = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const formData = new FormData();
    formData.append("file", fileResp.data, { filename: fileName });
    formData.append("folderId", 0); // pasta raiz do Bitrix Drive

    const resp = await axios.post(BITRIX_FILE_UPLOAD_URL, formData, {
      headers: formData.getHeaders(),
      timeout: 10000
    });

    if (resp.data.error) throw new Error(`Erro no upload do arquivo: ${JSON.stringify(resp.data)}`);
    return resp.data.result.ID;
  } catch (err) {
    console.error("Falha no upload do arquivo:", fileName, err.message);
    return null; // retorna null se falhar
  }
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
    // Faz upload seguro de todos os anexos
    let fileIDs = [];
    if (Array.isArray(data.attachments) && data.attachments.length) {
      for (let i = 0; i < data.attachments.length; i++) {
        const attachment = data.attachments[i];
        const url = attachment?.content_url || attachment;
        if (!url) continue; // pula anexos inválidos
        const fileName = attachment?.name || url.split("/").pop();
        const fileID = await uploadFileToBitrix(url, fileName);
        if (fileID) fileIDs.push(fileID); // só adiciona IDs válidos
      }
    }

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
        STATUS: 2,
        FILES: fileIDs
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
