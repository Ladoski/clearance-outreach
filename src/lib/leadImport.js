const { parse } = require('csv-parse/sync');
const pdfParse = require('pdf-parse');

/**
 * Parses a CSV buffer into normalized lead rows.
 * Expected (case-insensitive, flexible) headers:
 *   name, phone, email, company, notes, preferred_channel
 * Extra columns are ignored; missing ones default to null.
 */
function parseCsvLeads(buffer) {
  const records = parse(buffer, {
    columns: (header) => header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')),
    skip_empty_lines: true,
    trim: true,
  });

  return records.map(normalizeRow).filter((r) => r.phone || r.email);
}

/**
 * Best-effort PDF lead extraction. PDFs vary wildly in layout, so this
 * looks for lines containing a phone number and/or email and treats
 * everything else on the line as the name. CSV is strongly recommended
 * for reliable imports; PDF is a fallback for quick-and-dirty lists.
 */
async function parsePdfLeads(buffer) {
  const data = await pdfParse(buffer);
  const lines = data.text.split('\n').map((l) => l.trim()).filter(Boolean);

  const phoneRe = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
  const emailRe = /([\w.+-]+@[\w-]+\.[\w.-]+)/;

  const rows = [];
  for (const line of lines) {
    const phoneMatch = line.match(phoneRe);
    const emailMatch = line.match(emailRe);
    if (!phoneMatch && !emailMatch) continue;

    let name = line;
    if (phoneMatch) name = name.replace(phoneMatch[0], '');
    if (emailMatch) name = name.replace(emailMatch[0], '');
    name = name.replace(/[,;|]+/g, ' ').trim();

    rows.push(
      normalizeRow({
        name: name || null,
        phone: phoneMatch ? normalizePhone(phoneMatch[0]) : null,
        email: emailMatch ? emailMatch[0] : null,
      })
    );
  }
  return rows;
}

function normalizeRow(row) {
  return {
    name: row.name || null,
    phone: row.phone ? normalizePhone(row.phone) : null,
    email: row.email || null,
    company: row.company || null,
    notes: row.notes || null,
    preferred_channel: (row.preferred_channel || (row.phone ? 'sms' : 'email') || 'sms').toLowerCase(),
  };
}

/** Very light E.164-ish normalizer for US/CA numbers; adjust for your market. */
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw; // leave as-is if it doesn't match expected patterns
}

module.exports = { parseCsvLeads, parsePdfLeads, normalizePhone };
