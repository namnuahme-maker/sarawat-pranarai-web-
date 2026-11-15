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
    path.join(__dirname, '..', 'gdrive-key.json'),
    path.join(__dirname, '..', '..', 'gdrive-key.json')
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
  const creds = getServiceAccountCredentials();
  const folderId = process.env.GDRIVE_FOLDER_ID;

  if (!creds) {
    console.log('[GDRIVE] ⚠️ ยังไม่ได้ตั้งค่า Google Service Account Key (ข้ามการอัปโหลดเข้า Drive)');
    return { success: false, skipped: true, reason: 'No Google Service Account configured' };
  }

  try {
    const token = await getGoogleAccessToken(creds);

    const boundary = '-------sarawat_boundary_' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const fileMeta = {
      name: filename,
      parents: folderId ? [folderId] : [],
      description: `รูปโปรไฟล์สารวัตรนักเรียน: ${metadata.memberName || filename} (${metadata.dutyId || '-'})`
    };

    const multipartRequestBody = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(fileMeta) +
        delimiter +
        'Content-Type: image/jpeg\r\n' +
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

module.exports = {
  uploadToGoogleDrive,
  getServiceAccountCredentials
};
