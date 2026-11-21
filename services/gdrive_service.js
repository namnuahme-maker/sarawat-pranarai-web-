/**
 * 📁 GOOGLE DRIVE API V3 SERVICE (ZERO-DEPENDENCY)
 * จัดเก็บไฟล์รูปภาพสารวัตรนักเรียนเข้า Google Drive โฟลเดอร์ของโรงเรียน
 * ใช้ Service Account ผ่าน Native Node.js crypto + fetch (ไม่ต้องลงไลบรารีเพิ่ม)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * ดึง Service Account Credentials จาก Env หรือไฟล์
 */
function getServiceAccountCredentials() {
  if (process.env.GDRIVE_SERVICE_ACCOUNT_JSON) {
    try {
      const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON.trim();
      if (raw.startsWith('{')) return JSON.parse(raw);
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (e) {
      console.warn('[GDRIVE] Failed to parse GDRIVE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }

  const candidatePaths = [
    path.join(__dirname, '..', 'credentials', 'gdrive-key.json'),
    path.join(__dirname, '..', '..', 'credentials', 'gdrive-key.json'),
    path.join(__dirname, 'credentials', 'gdrive-key.json'),
    path.join(__dirname, '..', 'gdrive-key.json'),
    path.join(__dirname, '..', '..', 'gdrive-key.json'),
    'C:\\Users\\NAMNUAH\\Downloads\\norse-sequence-514809-u2-678efc9ab780.json'
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {}
    }
  }

  return null;
}

/**
 * ขอ Access Token จาก Google OAuth2 Token Endpoint ด้วย Service Account JWT
 */
async function getGoogleAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const claim = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const base64UrlEncode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64url');

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(claim)}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  sign.end();

  const signature = sign.sign(creds.private_key, 'base64url');
  const jwt = `${unsignedToken}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3500);
  return cachedToken;
}

/**
 * อัปโหลดไฟล์ภาพเข้าสู่ Google Drive
 * @param {Buffer} buffer - ข้อมูลไฟล์รูปภาพ
 * @param {string} filename - ชื่อไฟล์ที่ต้องการบันทึก
 * @param {object} metadata - ข้อมูลเพิ่มเติมเกี่ยวกับสารวัตร
 */
async function uploadToGoogleDrive(buffer, filename, metadata = {}) {
  const folderId = metadata.folderId || (metadata.category === 'lost_found' ? (process.env.GDRIVE_LOST_FOLDER_ID || '1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ') : (process.env.GDRIVE_FOLDER_ID || '1lcAN_otZ7RPOax6J1oodV-LjQ4hou_ez'));

  const webhookUrl = process.env.GDRIVE_WEBHOOK_URL ||
                     process.env.GOOGLE_DRIVE_WEBAPP_URL ||
                     process.env.GOOGLE_APPS_SCRIPT_URL ||
                     process.env.GDRIVE_APPS_SCRIPT_URL;

  // 1. ช่องทางที่ 1: Google Apps Script Webhook (แนะนำสูงสุดสำหรับโฟลเดอร์ใน My Drive - ไม่ติด Quota 0 Byte)
  if (webhookUrl) {
    try {
      const mime = metadata.mimeType || (filename.endsWith('.png') ? 'image/png' : (filename.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'));
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({
          folderId,
          category: metadata.category || 'profile',
          filename,
          mimeType: mime,
          base64Data: buffer.toString('base64'),
          metadata
        })
      });
      if (res.ok) {
        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (e) {
          const match = text.match(/\{[\s\S]*"success"\s*:\s*true[\s\S]*\}/);
          if (match) data = JSON.parse(match[0]);
        }
        if (data && data.success && data.fileId) {
          console.log(`[GDRIVE] ✅ อัปโหลดสำเร็จผ่าน Apps Script Gateway: ${filename} (ID: ${data.fileId})`);
          return {
            success: true,
            fileId: data.fileId,
            webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.fileId}/view`
          };
        }
      }
    } catch (whErr) {
      console.warn('[GDRIVE WEBHOOK NOTICE]:', whErr.message);
    }
  }

  // 2. ช่องทางที่ 2: Google Service Account Direct API (สำหรับ Shared Drive)
  const creds = getServiceAccountCredentials();

  if (!creds) {
    console.log('[GDRIVE] ⚠️ ยังไม่ได้ตั้งค่า GDRIVE_WEBHOOK_URL หรือ Service Account Key (ข้ามการอัปโหลดเข้า Drive)');
    return { success: false, skipped: true, reason: 'No Google credentials configured' };
  }

  try {
    const token = await getGoogleAccessToken(creds);
    const mime = metadata.mimeType || (filename.endsWith('.png') ? 'image/png' : (filename.endsWith('.mp4') ? 'video/mp4' : (filename.endsWith('.mov') ? 'video/quicktime' : (filename.endsWith('.webm') ? 'video/webm' : 'image/jpeg'))));

    const boundary = '-------sarawat_boundary_' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const fileMeta = {
      name: filename,
      parents: folderId ? [folderId] : [],
      description: metadata.description || (metadata.caseId ? `ไฟล์หลักฐานคดี ${metadata.caseId} โดย ${metadata.uploader || 'สารวัตร'}` : `รูปโปรไฟล์สารวัตรนักเรียน: ${metadata.memberName || filename} (${metadata.dutyId || '-'})`)
    };

    const multipartRequestBody = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(fileMeta) +
        delimiter +
        `Content-Type: ${mime}\r\n` +
        'Content-Transfer-Encoding: binary\r\n\r\n'
      ),
      buffer,
      Buffer.from(closeDelimiter)
    ]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(multipartRequestBody.length)
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive upload error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log(`[GDRIVE] ✅ อัปโหลดรูปสำเร็จเข้า Google Drive: ${data.name} (ID: ${data.id})`);
    return {
      success: true,
      fileId: data.id,
      webViewLink: data.webViewLink
    };
  } catch (err) {
    console.error('[GDRIVE ERROR]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * ดาวน์โหลดไฟล์จาก Google Drive
 * @param {string} fileId - ID หรือ URL ของไฟล์บน Google Drive
 * @returns {Promise<{success: boolean, buffer?: Buffer, mimeType?: string, error?: string}>}
 */
async function downloadFromGoogleDrive(fileId) {
  if (!fileId) return { success: false, error: 'File ID is required' };

  // สกัดเอาเฉพาะ ID ถ้าส่งมาเป็น URL
  let cleanId = fileId.trim();
  const idMatch = cleanId.match(/[-\w]{25,}/);
  if (idMatch) cleanId = idMatch[0];

  // 1. ลองผ่าน Service Account Direct API
  const creds = getServiceAccountCredentials();
  if (creds) {
    try {
      const token = await getGoogleAccessToken(creds);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${cleanId}?alt=media&supportsAllDrives=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const mimeType = res.headers.get('content-type') || 'image/png';
        return { success: true, buffer, mimeType, fileId: cleanId };
      }
    } catch (e) {
      console.warn('[GDRIVE DOWNLOAD SERVICE ACCOUNT WARN]:', e.message);
    }
  }

  // 2. Fallback: ลองดาวน์โหลดผ่าน Google Apps Script Webhook หรือ Public Export
  try {
    const pubUrls = [
      `https://drive.google.com/uc?export=download&id=${cleanId}`,
      `https://lh3.googleusercontent.com/d/${cleanId}`
    ];
    for (const url of pubUrls) {
      const pubRes = await fetch(url, { redirect: 'follow' });
      if (pubRes.ok) {
        const arrayBuf = await pubRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const mimeType = pubRes.headers.get('content-type') || 'image/png';
        return { success: true, buffer, mimeType, fileId: cleanId };
      }
    }
  } catch (pubErr) {
    console.warn('[GDRIVE DOWNLOAD PUBLIC WARN]:', pubErr.message);
  }

  return { success: false, error: 'Failed to download from Google Drive' };
}

module.exports = {
  uploadToGoogleDrive,
  downloadFromGoogleDrive,
  getServiceAccountCredentials
};
