'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const AUTH_SECRET = process.env.WEBHOOK_SECRET || 'pranarai_secret_sarawat_2026';

function signAuthToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && Date.now() > payload.exp) return null;
      return payload;
    }
  } catch (e) {}
  return null;
}

function shouldBlurPhoto(m, currentUser) {
  if (!m) return false;
  const u = currentUser;
  if (u && (u.isAdmin || u.role === 'ADMIN' || u.isTeacher || u.role === 'TEACHER' || u.isCommander || u.isLeader)) {
    return false;
  }
  if (m.role === 'PRESIDENT' || m.role === 'VICE_PRESIDENT') {
    return false;
  }
  // 🛡️ หากผู้ใช้งานที่ล็อกอินอยู่คือเจ้าของข้อมูลบัตรใบนี้เอง (ID ตรงกัน) ให้ปลดล็อกและแสดงรูปภาพตามปกติ
  if (u && (
    (u.memberId && String(u.memberId) === String(m.id)) ||
    (u.id && m.discord_id && String(u.id) === String(m.discord_id)) ||
    (u.dutyId && m.duty_id && String(u.dutyId) === String(m.duty_id))
  )) {
    return false;
  }
  return true;
}

test('Self-Profile Auth & Privacy - token signing and verification', () => {
  const payload = {
    id: '123456789012345678',
    username: 'namnuah',
    memberId: 'mem_001',
    dutyId: 'TS1',
    role: 'MEMBER',
    exp: Date.now() + 60 * 60 * 1000
  };

  const token = signAuthToken(payload);
  assert.ok(typeof token === 'string' && token.includes('.'));

  const verified = verifyAuthToken(token);
  assert.ok(verified !== null);
  assert.equal(verified.id, '123456789012345678');
  assert.equal(verified.memberId, 'mem_001');

  // Expired token rejects
  const expiredToken = signAuthToken({ ...payload, exp: Date.now() - 1000 });
  assert.equal(verifyAuthToken(expiredToken), null);

  // Tampered token rejects
  const tamperedToken = token.slice(0, -4) + 'abcd';
  assert.equal(verifyAuthToken(tamperedToken), null);
});

test('Self-Profile Privacy - normal officer viewing own profile unlocks card and photo', () => {
  const currentUser = {
    id: '123456789012345678',
    memberId: 'mem_001',
    dutyId: 'TS1',
    role: 'MEMBER',
    isAdmin: false
  };

  const selfMember = {
    id: 'mem_001',
    discord_id: '123456789012345678',
    duty_id: 'TS1',
    role: 'MEMBER'
  };

  const otherMember = {
    id: 'mem_002',
    discord_id: '987654321098765432',
    duty_id: 'TS2',
    role: 'MEMBER'
  };

  // 1. Normal officer viewing OWN profile -> UNLOCKED (shouldBlurPhoto = false)
  assert.equal(shouldBlurPhoto(selfMember, currentUser), false, 'Normal officer can view their own unblurred photo');

  // 2. Normal officer viewing ANOTHER officer -> LOCKED/BLURRED (shouldBlurPhoto = true)
  assert.equal(shouldBlurPhoto(otherMember, currentUser), true, 'Normal officer cannot view another officer unblurred photo');

  // 3. Admin viewing ANY officer -> UNLOCKED (shouldBlurPhoto = false)
  const adminUser = { ...currentUser, isAdmin: true, role: 'ADMIN' };
  assert.equal(shouldBlurPhoto(otherMember, adminUser), false, 'Admin can view any officer profile unblurred');
});
