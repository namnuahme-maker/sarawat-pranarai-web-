'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CATEGORY_META,
  polishDispatchMessage,
  resolveMentionRoleIds,
  buildDiscordDispatchPayload,
  recoverLogFromEmbed,
  handleDispatchAcknowledgment
} = require('../lib/dispatch_service');

test('Task 1: Migration v12 dispatch_logs exists and has required schema', () => {
  const rootMigrationPath = path.resolve(__dirname, '../../sql/migration_v12_dispatch_system.sql');
  const webMigrationPath = path.resolve(__dirname, '../sql/migration_v12_dispatch_system.sql');

  assert.ok(fs.existsSync(rootMigrationPath), 'Root migration v12 must exist');
  assert.ok(fs.existsSync(webMigrationPath), 'Web migration v12 must exist');

  const rootSql = fs.readFileSync(rootMigrationPath, 'utf8');
  const webSql = fs.readFileSync(webMigrationPath, 'utf8');

  assert.equal(rootSql, webSql, 'Root and web migration files must be identical');

  assert.match(rootSql, /CREATE TABLE IF NOT EXISTS public\.dispatch_logs/i);
  assert.match(rootSql, /category TEXT NOT NULL CHECK \(category IN \('PATROL', 'INVESTIGATION', 'ASSEMBLY', 'ANNOUNCEMENT'\)\)/i);
  assert.match(rootSql, /mention_target TEXT NOT NULL DEFAULT 'none'/i);
  assert.match(rootSql, /selected_version TEXT NOT NULL CHECK \(selected_version IN \('original', 'ai'\)\)/i);
  assert.match(rootSql, /acknowledged_officers JSONB DEFAULT '\[\]'::jsonb/i);
});

test('Task 2: polishDispatchMessage falls back safely when API key missing or error occurs', async () => {
  // Test fallback formatting when no Gemini key is provided
  const raw = '  ครูบอกให้รีบไปดูเด็กทะเลาะกันหน้าตึก 5 ด่วนๆ เลย  ';
  const result = await polishDispatchMessage({
    category: 'PATROL',
    rawText: raw,
    apiKey: null
  });

  assert.ok(result.success, 'Fallback must succeed without 500 error');
  assert.ok(result.isFallback, 'Must indicate fallback mode');
  assert.match(result.polishedText, /ตรวจจุด \/ ลาดตระเวน/);
  assert.match(result.polishedText, /เด็กทะเลาะกันหน้าตึก 5/);
});

test('Task 2: polishDispatchMessage calls Gemini API with tactical prompt when key provided', async () => {
  const mockFetch = async (url, opts) => {
    assert.match(url, /generativelanguage\.googleapis\.com/);
    const body = JSON.parse(opts.body);
    assert.ok(body.contents[0].parts[0].text.includes('สารวัตรนักเรียน'));

    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '📍 **พิกัด:** หน้าอาคาร 5\n🎯 **ภารกิจ:** ตรวจสอบกลุ่มนักเรียนและระงับเหตุความขัดแย้ง\n⏰ **เวลาปฏิบัติการ:** ทันที\n⚠️ **ข้อควรระวัง:** ปฏิบัติตามยุทธวิธีและรายงานเหตุต่อครูเวร'
                }
              ]
            }
          }
        ]
      })
    };
  };

  const result = await polishDispatchMessage({
    category: 'PATROL',
    rawText: 'ครูบอกให้รีบไปดูเด็กทะเลาะกันหน้าตึก 5 ด่วนๆ เลย',
    apiKey: 'mock_key',
    fetchFn: mockFetch
  });

  assert.ok(result.success);
  assert.equal(result.isFallback, false);
  assert.match(result.polishedText, /หน้าอาคาร 5/);
  assert.match(result.polishedText, /ภารกิจ:/);
});

test('Task 3: resolveMentionRoleIds resolves dynamic roles accurately', () => {
  const env = {
    ROLE_VERIFIED: 'role_verified_123',
    ROLE_SPECIAL: 'role_special_999',
    ROLE_MON: 'role_mon_001',
    ROLE_TUE: 'role_tue_002',
    ROLE_WED: 'role_wed_003',
    ROLE_THU: 'role_thu_004',
    ROLE_FRI: 'role_fri_005',
    ROLE_PRESIDENT: 'role_pres_777',
    ROLE_VICE_PRESIDENT: 'role_vp_888',
    ROLE_HEAD_M: 'role_head_m_111',
    ROLE_DEPUTY_M: 'role_dep_m_222'
  };

  // Test @everyone-sarawat
  const allRoles = resolveMentionRoleIds({ mentionTarget: '@everyone-sarawat', env });
  assert.deepEqual(allRoles, ['role_verified_123']);

  // Test @shift-today on a Monday (e.g. 2026-11-23 is Monday)
  const mondayDate = new Date('2026-11-23T10:00:00+07:00');
  const mondayRoles = resolveMentionRoleIds({ mentionTarget: '@shift-today', env, now: mondayDate });
  assert.deepEqual(mondayRoles, ['role_mon_001', 'role_special_999']);

  // Test @shift-today on Sunday (weekend fallback to special role)
  const sundayDate = new Date('2026-11-29T10:00:00+07:00');
  const weekendRoles = resolveMentionRoleIds({ mentionTarget: '@shift-today', env, now: sundayDate });
  assert.deepEqual(weekendRoles, ['role_special_999']);

  // Test none
  const noRoles = resolveMentionRoleIds({ mentionTarget: 'none', env });
  assert.deepEqual(noRoles, []);
});

test('Task 3: buildDiscordDispatchPayload constructs content, embed, and ack button', () => {
  const payload = buildDiscordDispatchPayload({
    logId: 'test-uuid-1234',
    category: 'ASSEMBLY',
    mentionRoleIds: ['role_verified_123'],
    finalText: '📍 รวมพลหน้าเสาธงทันที',
    senderName: 'กฤตยชญ์ (ประธาน)',
    senderRole: 'PRESIDENT',
    selectedVersion: 'ai'
  });

  assert.equal(payload.content, '<@&role_verified_123>');
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, CATEGORY_META.ASSEMBLY.color);
  assert.match(payload.embeds[0].title, /รวมพล \/ สั่งการพิเศษ/);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].components[0].custom_id, 'btn_dispatch_ack_test-uuid-1234');
});

test('Task 3: buildDiscordDispatchPayload defensively slices long finalText to 4000 chars', () => {
  const hugeText = 'A'.repeat(5000);
  const payload = buildDiscordDispatchPayload({
    logId: 'test-uuid-5000',
    category: 'PATROL',
    finalText: hugeText,
    senderName: 'Admin',
    senderRole: 'ADMIN'
  });

  assert.equal(payload.embeds[0].description.length, 4000);
});

test('Task 4: handleDispatchAcknowledgment enforces role verification and idempotency', () => {
  const log = {
    id: 'test-uuid-1234',
    acknowledged_officers: []
  };

  // 1. Unverified user rejected
  const guestUser = { id: 'guest_1', displayName: 'Guest', roles: [] };
  const rejected = handleDispatchAcknowledgment({
    log,
    officerUser: guestUser,
    env: { ROLE_VERIFIED: 'role_verified_123' }
  });
  assert.equal(rejected.success, false);
  assert.match(rejected.reason, /ไม่มีสิทธิ์/);

  // 2. Verified officer succeeds
  const verifiedOfficer = { id: 'officer_1', displayName: 'สารวัตรเอก', roles: ['role_verified_123'] };
  const firstAck = handleDispatchAcknowledgment({
    log,
    officerUser: verifiedOfficer,
    env: { ROLE_VERIFIED: 'role_verified_123' }
  });
  assert.equal(firstAck.success, true);
  assert.equal(firstAck.officers.length, 1);
  assert.equal(firstAck.officers[0].discord_id, 'officer_1');

  // 3. Repeat click idempotent rejection
  const logWithOneAck = {
    id: 'test-uuid-1234',
    acknowledged_officers: firstAck.officers
  };
  const secondAck = handleDispatchAcknowledgment({
    log: logWithOneAck,
    officerUser: verifiedOfficer,
    env: { ROLE_VERIFIED: 'role_verified_123' }
  });
  assert.equal(secondAck.success, false);
  assert.ok(secondAck.alreadyAck);
});

test('Task 5: recoverLogFromEmbed extracts acknowledged officers correctly', () => {
  const embed = {
    title: '🛡️ ศูนย์สั่งการด่วน: ตรวจจุด / ลาดตระเวน',
    fields: [
      {
        name: '👥 รายชื่อผู้รับทราบภารกิจ (2 นาย)',
        value: '1. **นายณิชกานต์ คำไชย (น้ำเหนือ)** (23:40)\n2. **นายพงศ์ภัค (แบงก์)** (23:42)'
      }
    ]
  };

  const recovered = recoverLogFromEmbed(embed, 'recovered-id-123');
  assert.ok(recovered);
  assert.equal(recovered.id, 'recovered-id-123');
  assert.equal(recovered.acknowledged_officers.length, 2);
  assert.equal(recovered.acknowledged_officers[0].name, 'นายณิชกานต์ คำไชย (น้ำเหนือ)');
  assert.equal(recovered.acknowledged_officers[1].name, 'นายพงศ์ภัค (แบงก์)');
});

test('Task 5: handleDispatchAcknowledgment falls back to embed when log is null and prevents duplicate by name', () => {
  const embed = {
    title: '🛡️ ศูนย์สั่งการด่วน: ตรวจจุด / ลาดตระเวน',
    fields: [
      {
        name: '👥 รายชื่อผู้รับทราบภารกิจ (1 นาย)',
        value: '1. **นายณิชกานต์ คำไชย (น้ำเหนือ)** (23:40)'
      }
    ]
  };

  // 1. Same officer attempts to acknowledge again -> should reject as already acknowledged
  const duplicateOfficer = {
    id: 'different_discord_id_or_same',
    displayName: 'นายณิชกานต์ คำไชย (น้ำเหนือ)',
    roles: ['role_verified_123']
  };

  const dupResult = handleDispatchAcknowledgment({
    log: null,
    embed,
    officerUser: duplicateOfficer,
    env: { ROLE_VERIFIED: 'role_verified_123' }
  });

  assert.equal(dupResult.success, false);
  assert.ok(dupResult.alreadyAck);

  // 2. New officer acknowledges -> should succeed and increment count to 2
  const newOfficer = {
    id: 'officer_new_456',
    displayName: 'นายพงศ์ภัค (แบงก์)',
    roles: ['role_verified_123']
  };

  const newResult = handleDispatchAcknowledgment({
    log: null,
    embed,
    officerUser: newOfficer,
    env: { ROLE_VERIFIED: 'role_verified_123' }
  });

  assert.equal(newResult.success, true);
  assert.equal(newResult.officers.length, 2);
  assert.equal(newResult.officers[1].name, 'นายพงศ์ภัค (แบงก์)');
});
