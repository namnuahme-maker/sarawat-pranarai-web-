'use strict';

/**
 * Tactical Dispatch Service for SARAWAT PRANARAI
 * Handles category definitions, AI text refinement with Gemini,
 * dynamic role mentions, Discord payload formatting, and officer acknowledgments.
 */

const CATEGORY_META = {
  PATROL: {
    label: 'ตรวจจุด / ลาดตระเวน',
    color: 0xf59e0b, // Amber / Orange
    icon: '🛡️',
    description: 'คำสั่งตรวจจุดพื้นที่เสี่ยงและเดินตรวจความเรียบร้อย'
  },
  INVESTIGATION: {
    label: 'สืบข้อมูล / ตรวจสอบเหตุด่วน',
    color: 0x06b6d4, // Cyan / Blue
    icon: '🔍',
    description: 'สั่งการตรวจสอบข้อเท็จจริงหรือข้อมูลเหตุการณ์ฉุกเฉิน'
  },
  ASSEMBLY: {
    label: 'รวมพล / สั่งการพิเศษ',
    color: 0xef4444, // Red
    icon: '🚨',
    description: 'เรียกรวมพลสารวัตรด่วน หรือคำสั่งภารกิจเร่งด่วนที่สุด'
  },
  ANNOUNCEMENT: {
    label: 'ประกาศทั่วไป / กำชับข้อปฏิบัติ',
    color: 0x10b981, // Emerald Green
    icon: '📢',
    description: 'แจ้งเตือนระเบียบวินัย หรือข้อพึงปฏิบัติทั่วไป'
  }
};

/**
 * Polish raw spoken or typed text into SARAWAT Tactical format using Google Gemini.
 * Includes graceful fallback if API key is missing or call fails.
 */
async function polishDispatchMessage({ category, rawText, apiKey, fetchFn = globalThis.fetch }) {
  const cat = CATEGORY_META[category] || CATEGORY_META.PATROL;
  const cleanRaw = (rawText || '').trim();

  if (!cleanRaw) {
    throw new Error('กรุณาระบุข้อความคำอธิบายภารกิจ');
  }

  // 🛡️ Safe Fallback if Gemini API key is missing
  if (!apiKey) {
    return {
      success: true,
      isFallback: true,
      category,
      polishedText: `📍 **หมวดหมู่:** ${cat.label}\n🎯 **ภารกิจ:** ${cleanRaw}\n⏰ **เวลา:** ทันที\n⚠️ **ข้อควรระวัง:** ปฏิบัติหน้าที่ด้วยความสุภาพ รอบคอบ และรายงานผลต่อหัวหน้าเวร`
    };
  }

  const systemPrompt = `คุณคือระบบปัญญาประดิษฐ์ศูนย์สั่งการยุทธวิธี "สารวัตรนักเรียน โรงเรียนพระนารายณ์" (SARAWAT PRANARAI TACTICAL DISPATCH AI).
ภารกิจของคุณ: รับข้อความที่ผู้บริหาร (ครู/ประธาน/แอดมิน) พูดผ่านเสียงหรือพิมพ์มา แล้วทำการขัดเกลาและจัดโครงสร้างใหม่ให้เป็น "คำสั่งยุทธวิธีทางการ" ของสารวัตรนักเรียน.

กฎเหล็ก:
1. ตัดคำหยาบ, คำสแลง, คำพูดอารมณ์ฉุนเฉียว, และคำสร้อยฟุ่มเฟือยทิ้งทั้งหมด
2. ห้ามแต่งเติมข้อเท็จจริงเกินกว่าที่ผู้ใช้ระบุ แต่ให้จัดระเบียบข้อมูลให้อ่านเข้าใจง่ายที่สุด
3. จัดรูปแบบให้เป็นระเบียบตามโครงสร้างนี้เท่านั้น:
📍 **พิกัด/เป้าหมาย:** (ระบุจุด เช่น อาคาร 5, ประตูหน้า, โรงอาหาร หรือระบุตามเนื้อหา)
🎯 **คำสั่ง/ภารกิจ:** (สรุปสิ่งที่สารวัตรต้องปฏิบัติอย่างชัดเจน หนักแน่น สุภาพ)
⏰ **เวลาปฏิบัติการ:** (ระบุเวลาทันที หรือเวลาตามที่ผู้สั่งระบุ)
⚠️ **ข้อพึงระวัง:** (เน้นย้ำความปลอดภัย กฎระเบียบโรงเรียน และการรายงานผล)
4. ความยาวไม่เกิน 500 ตัวอักษร เพื่อให้แสดงผลใน Discord Embed ได้สวยงามและกระชับ
5. หมวดหมู่ภารกิจ: "${cat.label}" (${category})`;

  const candidateModels = [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest'
  ];

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${systemPrompt}\n\nข้อความต้นฉบับ:\n"${cleanRaw}"` }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800
          }
        }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
      });

      if (!res.ok) continue;

      const data = await res.json();
      const outputText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (outputText && outputText.trim()) {
        return {
          success: true,
          isFallback: false,
          category,
          polishedText: outputText.trim()
        };
      }
    } catch (err) {
      // Continue to next model or fallback
    }
  }

  // Fallback if all Gemini models failed
  return {
    success: true,
    isFallback: true,
    category,
    polishedText: `📍 **หมวดหมู่:** ${cat.label}\n🎯 **ภารกิจ:** ${cleanRaw}\n⏰ **เวลา:** ทันที\n⚠️ **ข้อควรระวัง:** ปฏิบัติหน้าที่ด้วยความสุภาพ รอบคอบ และรายงานผลต่อหัวหน้าเวร`
  };
}

/**
 * Resolve dynamic role IDs from mentionTarget
 */
function resolveMentionRoleIds({ mentionTarget, env = process.env, now = new Date() }) {
  if (!mentionTarget || mentionTarget === 'none') {
    return [];
  }

  if (mentionTarget === '@everyone-sarawat') {
    return env.ROLE_VERIFIED ? [env.ROLE_VERIFIED] : [];
  }

  // Determine Bangkok (UTC+7) day of week
  const bkkDate = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  const dayOfWeek = bkkDate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  if (mentionTarget === '@shift-today') {
    const roles = [];
    const dayRoleMap = {
      1: env.ROLE_MON,
      2: env.ROLE_TUE,
      3: env.ROLE_WED,
      4: env.ROLE_THU,
      5: env.ROLE_FRI
    };

    if (dayRoleMap[dayOfWeek]) {
      roles.push(dayRoleMap[dayOfWeek]);
    }

    // Special shift role is always on daily duty
    if (env.ROLE_SPECIAL) {
      roles.push(env.ROLE_SPECIAL);
    }

    return roles.filter(Boolean);
  }

  if (mentionTarget === '@shift-leaders') {
    const roles = [];
    if (env.ROLE_PRESIDENT) roles.push(env.ROLE_PRESIDENT);
    if (env.ROLE_VICE_PRESIDENT) roles.push(env.ROLE_VICE_PRESIDENT);

    const leaderMap = {
      1: [env.ROLE_HEAD_M, env.ROLE_DEPUTY_M],
      2: [env.ROLE_HEAD_T, env.ROLE_DEPUTY_T],
      3: [env.ROLE_HEAD_W, env.ROLE_DEPUTY_W],
      4: [env.ROLE_HEAD_THU, env.ROLE_DEPUTY_THU],
      5: [env.ROLE_HEAD_F, env.ROLE_DEPUTY_F],
      0: [env.ROLE_HEAD_S, env.ROLE_DEPUTY_S],
      6: [env.ROLE_HEAD_S, env.ROLE_DEPUTY_S]
    };

    if (leaderMap[dayOfWeek]) {
      roles.push(...leaderMap[dayOfWeek]);
    }

    return roles.filter(Boolean);
  }

  return [];
}

/**
 * Build Discord REST API payload including Mention Content, Rich Embed, and Ack Button
 */
function buildDiscordDispatchPayload({
  logId,
  category,
  mentionRoleIds = [],
  finalText,
  senderName,
  senderRole,
  selectedVersion = 'ai',
  acknowledgedCount = 0,
  acknowledgedOfficers = []
}) {
  const cat = CATEGORY_META[category] || CATEGORY_META.PATROL;
  const content = mentionRoleIds.length > 0
    ? mentionRoleIds.map(rid => `<@&${rid}>`).join(' ')
    : '';

  const versionBadge = selectedVersion === 'ai' ? '🤖 ขัดเกลาโดย AI' : '✍️ ข้อความดั้งเดิม';

  // Build officer preview (up to 10 names to prevent 1024 char limits)
  let ackFieldText = 'ยังไม่มีผู้กดรับทราบภารกิจ';
  if (acknowledgedOfficers && acknowledgedOfficers.length > 0) {
    const previewList = acknowledgedOfficers.slice(0, 10).map((o, idx) => {
      const timeStr = o.timestamp ? new Date(o.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
      return `${idx + 1}. **${o.name || o.username}** ${timeStr ? `(${timeStr})` : ''}`;
    });
    if (acknowledgedOfficers.length > 10) {
      previewList.push(`*...และอีก ${acknowledgedOfficers.length - 10} นาย*`);
    }
    ackFieldText = previewList.join('\n');
  }

  const embed = {
    title: `${cat.icon} ศูนย์สั่งการด่วน: ${cat.label}`,
    description: (finalText || '').slice(0, 4000),
    color: cat.color,
    fields: [
      {
        name: '👤 ผู้สั่งการ',
        value: `**${senderName || 'ผู้ดูแลระบบ'}** (${senderRole || 'COMMANDER'})`,
        inline: true
      },
      {
        name: '📝 รูปแบบข้อความ',
        value: versionBadge,
        inline: true
      },
      {
        name: `👥 รายชื่อผู้รับทราบภารกิจ (${acknowledgedCount} นาย)`,
        value: ackFieldText,
        inline: false
      }
    ],
    footer: {
      text: 'กองสารวัตรนักเรียน โรงเรียนพระนารายณ์ • ระบบศูนย์สั่งการฉุกเฉิน'
    },
    timestamp: new Date().toISOString()
  };

  const components = [
    {
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 1, // Primary (Blurple)
          custom_id: `btn_dispatch_ack_${logId}`,
          label: `📌 รับทราบภารกิจ (${acknowledgedCount} นาย)`,
          disabled: false
        }
      ]
    }
  ];

  return {
    content,
    embeds: [embed],
    components
  };
}

/**
 * Recover a dispatch log representation from an existing Discord embed
 */
function recoverLogFromEmbed(embed, logId = 'unknown') {
  if (!embed) return null;
  const fields = embed.fields || embed.data?.fields || [];
  const ackField = fields.find(f => f.name && f.name.includes('รายชื่อผู้รับทราบภารกิจ'));
  const recovered = [];
  if (ackField && ackField.value && !ackField.value.includes('ยังไม่มีผู้กดรับทราบภารกิจ')) {
    const lines = ackField.value.split('\n');
    for (const line of lines) {
      const match = line.match(/\*\*(.*?)\*\*/);
      if (match && match[1]) {
        recovered.push({
          discord_id: null,
          name: match[1].trim(),
          role: 'OFFICER'
        });
      }
    }
  }
  return {
    id: logId,
    fallback_from_embed: true,
    acknowledged_officers: recovered
  };
}

/**
 * Handle officer clicking the [รับทราบภารกิจ] button
 */
function handleDispatchAcknowledgment({ log, officerUser, env = process.env, memberRecord = null, embed = null }) {
  let effectiveLog = log;
  if (!effectiveLog && embed) {
    effectiveLog = recoverLogFromEmbed(embed, 'fallback');
  }

  if (!effectiveLog) {
    return { success: false, reason: 'ไม่พบข้อมูลภารกิจนี้ในระบบ' };
  }

  // 1. Check authorization (ROLE_VERIFIED or registered member in database)
  const isVerifiedRole = env.ROLE_VERIFIED && officerUser.roles && officerUser.roles.includes(env.ROLE_VERIFIED);
  const isRegistered = !!memberRecord || isVerifiedRole || officerUser.isAdmin || officerUser.isTeacher || officerUser.isLeader;

  if (!isRegistered) {
    return { success: false, reason: 'ท่านไม่มีสิทธิ์กดรับทราบภารกิจนี้ (เฉพาะสารวัตรนักเรียนที่ผ่านการยืนยันตัวตนแล้วเท่านั้น)' };
  }

  const existingOfficers = Array.isArray(effectiveLog.acknowledged_officers) ? [...effectiveLog.acknowledged_officers] : [];

  // 2. Idempotency check: already acknowledged?
  const officerName = officerUser.displayName || officerUser.username;
  const alreadyIndex = existingOfficers.findIndex(o => 
    (o.discord_id && o.discord_id === officerUser.id) ||
    (o.name && (o.name === officerName || o.name === officerUser.username))
  );

  if (alreadyIndex !== -1) {
    return {
      success: false,
      alreadyAck: true,
      reason: 'ท่านได้รับทราบภารกิจนี้ไปแล้ว',
      officers: existingOfficers
    };
  }

  // 3. Append officer entry
  const newOfficer = {
    discord_id: officerUser.id,
    name: officerName,
    role: memberRecord?.shift_role || memberRecord?.role || 'OFFICER',
    timestamp: new Date().toISOString()
  };

  existingOfficers.push(newOfficer);

  return {
    success: true,
    alreadyAck: false,
    officer: newOfficer,
    officers: existingOfficers,
    count: existingOfficers.length,
    log: effectiveLog
  };
}

module.exports = {
  CATEGORY_META,
  polishDispatchMessage,
  resolveMentionRoleIds,
  buildDiscordDispatchPayload,
  recoverLogFromEmbed,
  handleDispatchAcknowledgment
};
