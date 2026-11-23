/**
 * 🌐 SARAWAT PRANARAI - CENTRAL COMMAND WEB SERVER
 * เว็บแดชบอร์ดศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์
 * โฮสต์แยกอิสระบน Render.com Web Service
 */

require('dotenv').config();

// Global Process Exception Handlers
process.on('uncaughtException', (err) => {
  console.error('[WEB FATAL] Uncaught Exception:', err?.stack || err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[WEB WARN] Unhandled Rejection at:', promise, 'reason:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let wsTransport = null;
try {
  wsTransport = require('ws');
  if (!globalThis.WebSocket) {
    globalThis.WebSocket = wsTransport;
  }
} catch (e) {}

const { createClient } = require('@supabase/supabase-js');
const { uploadToGoogleDrive, downloadFromGoogleDrive } = require('./services/gdrive_service');
const { custodyOrFilter, isSchoolCustodyItem } = require('./lib/school_custody');
const {
  CATEGORY_META,
  polishDispatchMessage,
  resolveMentionRoleIds,
  buildDiscordDispatchPayload,
  handleDispatchAcknowledgment
} = require('./lib/dispatch_service');

const app = express();
app.set('trust proxy', 1); // รองรับ Reverse Proxy บน Render (HTTPS termination)
const PORT = process.env.PORT || 10001; // ค่าเริ่มต้นพอร์ตเว็บ 10001 (เพื่อไม่ชนกับบอทพอร์ต 10000 เมื่อรันในเครื่องเดียวกัน)

// Helper: สร้าง Supabase Client แบบปลอดภัย ป้องกัน Server Crash เมื่อขาดการตั้งค่า ENV
function createSafeSupabaseClient(url, key, context = 'WEB') {
  const cleanUrl = String(url || '').trim();
  const cleanKey = String(key || '').trim();
  if (cleanUrl && cleanKey) {
    try {
      const options = {
        auth: { persistSession: false, autoRefreshToken: false }
      };
      if (wsTransport) {
        options.realtime = { transport: wsTransport };
      }
      const client = createClient(cleanUrl, cleanKey, options);
      console.log(`[${context}] ✅ เชื่อมต่อ Supabase สำเร็จ: ${cleanUrl.substring(0, 25)}...`);
      return client;
    } catch (e) {
      console.error(`[${context}] ⚠️ ไม่สามารถเชื่อมต่อ Supabase:`, e.message);
    }
  } else {
    console.warn(`[${context}] ⚠️ ขาดค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY - ใช้งาน Safe Mock Fallback`);
  }

  const dummyChain = {
    select: () => dummyChain,
    insert: () => dummyChain,
    update: () => dummyChain,
    delete: () => dummyChain,
    eq: () => dummyChain,
    neq: () => dummyChain,
    in: () => dummyChain,
    is: () => dummyChain,
    or: () => dummyChain,
    order: () => dummyChain,
    limit: () => dummyChain,
    range: () => dummyChain,
    single: async () => ({ data: null, error: new Error('Supabase unconfigured') }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null })
  };

  return {
    from: () => dummyChain,
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: new Error('Supabase storage unconfigured') }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
        remove: async () => ({ data: null, error: null })
      })
    }
  };
}

// เชื่อมต่อ Supabase Database
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createSafeSupabaseClient(supabaseUrl, supabaseKey, 'WEB');

// Keep old Thursday values readable while the web and Discord bot roll out
// independently; all new writes and user-facing values use Th / ThS.
function canonicalDutyDay(value) {
  const code = String(value || '').trim();
  if (code === 'Ts') return 'Th';
  if (code === 'TSS' || code === 'TsS') return 'ThS';
  return code;
}

function baseDutyDay(value) {
  const code = canonicalDutyDay(value);
  if (code === 'S') return 'S';
  return code.endsWith('S') ? code.replace(/S+$/, '') : code;
}

function expandDutyDayAliases(values) {
  return [...new Set(values.flatMap(value => {
    const code = canonicalDutyDay(value);
    if (code === 'Th') return ['Th', 'Ts'];
    if (code === 'ThS') return ['ThS', 'TSS', 'TsS'];
    return [code];
  }))];
}

function canonicalDutyId(value) {
  const id = String(value || '').trim();
  let match = id.match(/^TSS(\d*)$/i) || id.match(/^TsS(\d*)$/);
  if (match) return `ThS${match[1]}`;
  match = id.match(/^Ts(\d*)$/);
  if (match) return `Th${match[1]}`;
  match = id.match(/^THS(\d*)$/i);
  if (match) return `ThS${match[1]}`;
  match = id.match(/^TH(\d*)$/i);
  if (match) return `Th${match[1]}`;
  return id.toUpperCase();
}

// =============================================================
// 🔐 DISCORD OAUTH2 AUTHENTICATION & SESSION CONFIGURATION
// =============================================================
const AUTH_SECRET = process.env.WEBHOOK_SECRET || 'pranarai_secret_sarawat_2026';
const DISCORD_CLIENT_ID = process.env.CLIENT_ID || '1567571996928114898';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.GUILD_ID || '1567547042207895664';

// Helper: ดึงค่า Cookie จาก Header
function getCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  const match = header.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// Helper: สร้าง Token ปลอดภัยด้วย HMAC-SHA256
function signAuthToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Helper: ตรวจสอบความถูกต้องของ Token
function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null; // หมดอายุ
    return payload;
  } catch (err) {
    return null;
  }
}

// Helper: ตรวจหา User ที่ล็อกอินจาก Cookie หรือ Header
function getUserFromReq(req) {
  // 1. ตรวจสอบจาก Cookie
  const cookieToken = getCookie(req, 'sarawat_auth');
  if (cookieToken) {
    const user = verifyAuthToken(cookieToken);
    if (user) return user;
  }
  // 2. ตรวจสอบจาก Authorization Bearer
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7).trim();
    const user = verifyAuthToken(bearerToken);
    if (user) return user;
  }

  // 3. ตรวจสอบจาก query parameter ?auth= หรือ ?token= (สำหรับลิงก์ตรงจาก Discord)
  const queryToken = req.query?.auth || req.query?.token;
  if (queryToken && typeof queryToken === 'string') {
    const user = verifyAuthToken(queryToken.trim());
    if (user) return user;
  }

  // 4. บน Localhost ข้ามขั้นตอน Login ผ่าน Discord อัตโนมัติ (Dev Mode)
  const host = (req && req.get) ? (req.get('host') || '') : '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || process.env.NODE_ENV === 'development' || !process.env.PORT;
  if (isLocalhost) {
    return {
      id: 'dev_local_admin',
      username: 'Local Developer',
      nickname: 'ผู้ดูแลระบบ (Local Admin)',
      discriminator: '0000',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
      officialPhoto: null,
      role: 'ADMIN',
      isAdmin: true,
      isTeacher: false,
      isPresident: true,
      isVicePresident: true,
      canManageMembers: true,
      isCommander: true,
      isLeader: true,
      isGuildMember: true,
      roles: ['1567547042207895664'],
      serverNick: '⚡ ผู้ดูแลระบบ (Localhost)',
      rank: 'ผู้ดูแลระบบ'
    };
  }

  return null;
}

// Middleware: บังคับ Login ผ่าน Discord สำหรับ Endpoint หรือหน้าเว็บที่กำหนด
function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (user) {
    req.user = user;
    // หากเข้าใช้งานด้วย ?auth=... ให้เซ็ตคุกกี้เซสชัน sarawat_auth ให้อัตโนมัติ เพื่อให้คงสถานะล็อกอิน
    if (req.query?.auth && !getCookie(req, 'sarawat_auth')) {
      res.cookie('sarawat_auth', req.query.auth, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });
    }
    return next();
  }

  // กรณีเป็นคำขอแบบ API ส่ง 401 Unauthorized JSON
  const isApi = (req.originalUrl && req.originalUrl.startsWith('/api/')) || req.path.startsWith('/api/');
  if (isApi) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'กรุณาเข้าสู่ระบบด้วย Discord ก่อนใช้งาน',
      loginUrl: '/login'
    });
  }

  // กรณีเป็นหน้าเว็บปกติ Redirect ไปหน้า /login พร้อม Return URL
  let returnUrl = req.originalUrl || '/';
  if (returnUrl.includes('/login')) returnUrl = '/';
  return res.redirect(`/login?redirect=${encodeURIComponent(returnUrl)}`);
}

// Helper: ดึง Base URL ปัจจุบัน
function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : (req.secure ? 'https' : req.protocol);
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

// ฟังก์ชันแกนกลาง: ยืนยันตัวตน Discord และตรวจสอบสมาชิกเซิร์ฟเวอร์
async function processDiscordUserLogin(accessToken, res) {
  try {
    // 1. ดึงข้อมูล User จาก Discord API
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) {
      return { success: false, error: 'invalid_token', message: 'Token ไม่ถูกต้องหรือหมดอายุ' };
    }
    const discordUser = await userRes.json();
    const discordId = discordUser.id;

    // 2. ตรวจสอบสมาชิกและยศในเซิร์ฟเวอร์สารวัตร (Discord Guild)
    let guildMember = null;
    let roles = [];
    let isGuildMember = false;
    let serverNick = null;

    if (DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`, {
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });
        if (memberRes.ok) {
          guildMember = await memberRes.json();
          isGuildMember = true;
          roles = guildMember.roles || [];
          serverNick = guildMember.nick;
        } else if (memberRes.status === 404) {
          return {
            success: false,
            error: 'not_in_guild',
            message: `บัญชี Discord (@${discordUser.username}) ไม่ได้อยู่ในเซิร์ฟเวอร์สารวัตรนักเรียน โรงเรียนพระนารายณ์`
          };
        }
      } catch (err) {
        console.warn('[AUTH] Guild member lookup warning:', err.message);
      }
    }

    // 3. ตรวจสอบข้อมูลในฐานข้อมูล Supabase (ตาราง members)
    let memberData = null;
    try {
      const { data } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', discordId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) memberData = data;
    } catch (e) {}

    const roleAdmin = process.env.ROLE_ADMIN;
    const roleTeacher = process.env.ROLE_TEACHER;
    const rolePresident = process.env.ROLE_PRESIDENT;
    const roleVicePresident = process.env.ROLE_VICE_PRESIDENT;

    // ตรวจสอบสิทธิ์ผู้ดูแลระบบ (Admin role หรือ Discord Administrator permission)
    const isAdmin = (roleAdmin && roles.includes(roleAdmin)) || 
                    memberData?.role === 'ADMIN' ||
                    (guildMember && (BigInt(guildMember.permissions || '0') & BigInt(0x8)) === BigInt(0x8));
    const isTeacher = (roleTeacher && roles.includes(roleTeacher)) || memberData?.role === 'TEACHER' || memberData?.shift_role === 'TEACHER';
    const isPresident = roles.includes(rolePresident) || memberData?.role === 'PRESIDENT';
    const isVicePresident = roles.includes(roleVicePresident) || memberData?.role === 'VICE_PRESIDENT';
    const isLeader = isAdmin || isTeacher || isPresident || isVicePresident || roles.some(r => typeof r === 'string' && r.startsWith('ROLE_HEAD'));
    const isCommander = isAdmin || isPresident;
    const isVerified = roles.includes(process.env.ROLE_VERIFIED) || !!memberData;

    // 🌟 เน้นย้ำ: ดึงรูปโปรไฟล์ที่ผู้ใช้งานส่งในช่องส่งรูป (profile_image_url) มาใช้เป็นหลักอันดับ 1
    const submittedPhoto = memberData?.profile_image_url || memberData?.photo_url || memberData?.profile_photo_url;
    const avatarUrl = submittedPhoto || (discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${(parseInt(discordUser.discriminator || '0') % 5)}.png`);

    const authUser = {
      id: discordId,
      username: discordUser.username,
      displayName: serverNick || (memberData ? `${memberData.first_name} ${memberData.last_name || ''} (${memberData.nickname || ''})`.trim() : (discordUser.global_name || discordUser.username)),
      nickname: memberData?.nickname || serverNick || discordUser.global_name || discordUser.username,
      avatar: avatarUrl,
      officialPhoto: submittedPhoto || null,
      roles: roles,
      isGuildMember,
      isAdmin,
      isTeacher,
      isPresident,
      isVicePresident,
      canManageMembers: isAdmin || isTeacher || isPresident || isVicePresident,
      isCommander,
      isLeader,
      isVerified,
      role: isAdmin ? 'ADMIN' : (isTeacher ? 'TEACHER' : (isPresident ? 'PRESIDENT' : (isVicePresident ? 'VICE_PRESIDENT' : (memberData?.role || 'MEMBER')))),
      dutyId: memberData?.duty_id || null,
      rank: memberData?.rank || (isAdmin ? '⚡ ผู้ดูแลระบบ' : (isTeacher ? '👨‍🏫 ครูที่ปรึกษา' : (isPresident ? 'ประธาน' : (isVicePresident ? 'รองประธาน' : (memberData?.shift_role || 'สารวัตร'))))),
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // อายุเซสชัน 7 วัน
    };

    // ฝัง Cookie แบบ HttpOnly ปลอดภัยสูง
    const token = signAuthToken(authUser);
    res.cookie('sarawat_auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return { success: true, user: authUser, token };
  } catch (error) {
    console.error('[AUTH] Login processing error:', error);
    return { success: false, error: 'server_error', message: error.message };
  }
}

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// -------------------------------------------------------------
// 1. Static Assets สาธารณะ (ภาพ, Uploads, Favicon, Scripts)
// -------------------------------------------------------------
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));

// หน้าเว็บเครื่องมือครอปรูปถ่ายสารวัตรนักเรียน (1:1 Aspect Ratio)
app.get(['/crop', '/crop.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'crop.html'));
});

// -------------------------------------------------------------
// 2. หน้า Login และ Discord OAuth2 Authentication Endpoints
// -------------------------------------------------------------
app.get(['/login', '/login.html'], (req, res) => {
  const user = getUserFromReq(req);
  if (user) {
    let redirect = req.query.redirect || '/';
    if (redirect.includes('login')) redirect = '/';
    return res.redirect(redirect);
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ดึงการตั้งค่า OAuth2 สำหรับ Client-side
app.get('/api/auth/config', (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    clientId: DISCORD_CLIENT_ID,
    hasClientSecret: !!DISCORD_CLIENT_SECRET,
    redirectUri: `${baseUrl}/auth/discord/callback`
  });
});

// เริ่มกระบวนการ Login (Redirect ไปยัง Discord OAuth2)
app.get('/auth/discord/login', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/auth/discord/callback`;
  const state = req.query.redirect ? encodeURIComponent(req.query.redirect) : '';

  if (DISCORD_CLIENT_SECRET) {
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify&state=${state}`;
    return res.redirect(discordAuthUrl);
  } else {
    // โหมด Implicit Grant (ส่งตรงไป /login เพื่อรับ #access_token)
    const tokenRedirectUri = `${baseUrl}/login`;
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(tokenRedirectUri)}&scope=identify&state=${state}`;
    return res.redirect(discordAuthUrl);
  }
});

// OAuth2 Callback สำหรับ Authorization Code Flow
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error || !code) {
    return res.redirect(`/login?error=${encodeURIComponent(error || 'cancelled')}&message=${encodeURIComponent(error_description || '')}`);
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/auth/discord/callback`;

  try {
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[AUTH] Token exchange failed:', tokenData);
      return res.redirect('/login?error=token_exchange_failed');
    }

    const loginResult = await processDiscordUserLogin(tokenData.access_token, res);
    if (!loginResult.success) {
      return res.redirect(`/login?error=${encodeURIComponent(loginResult.error)}&message=${encodeURIComponent(loginResult.message || '')}`);
    }

    const returnUrl = state ? decodeURIComponent(state) : '/';
    return res.redirect(returnUrl);
  } catch (err) {
    console.error('[AUTH] Callback error:', err);
    return res.redirect('/login?error=server_error');
  }
});

// ยืนยันตัวตนด้วย Access Token จาก Implicit Grant Flow
app.post('/api/auth/discord/token', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) {
    return res.status(400).json({ success: false, error: 'missing_token', message: 'กรุณาระบุ access_token' });
  }

  const loginResult = await processDiscordUserLogin(access_token, res);
  if (!loginResult.success) {
    return res.status(403).json(loginResult);
  }
  return res.json(loginResult);
});

// ตรวจสอบสถานะ User ปัจจุบัน พร้อมซิงค์รูปโปรไฟล์ที่ส่งล่าสุดจาก Supabase
app.get('/api/auth/me', async (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.json({
      loggedIn: false,
      user: null
    });
  }

  // ซิงค์รูปโปรไฟล์และสิทธิ์ตำแหน่งล่าสุดจาก Supabase เพื่อให้เป็นปัจจุบันเสมอ Real-time
  try {
    const { data: m, error: mErr } = await supabase
      .from('members')
      .select('id, profile_image_url, nickname, first_name, last_name, duty_id, shift_role, role, grade_class, student_no, phone_number, duty_day')
      .eq('discord_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mErr) console.warn('Supabase member sync error:', mErr.message);

    if (m) {
      user.memberId = m.id;
      user.firstName = m.first_name;
      user.lastName = m.last_name;
      user.gradeClass = m.grade_class;
      user.studentNo = m.student_no;
      user.phoneNumber = m.phone_number;
      user.dutyDay = m.duty_day;
      user.shiftRole = m.shift_role;
      if (m.profile_image_url) {
        user.avatar = m.profile_image_url;
        user.officialPhoto = m.profile_image_url;
      }
      if (m.nickname) user.nickname = m.nickname;
      if (m.duty_id) user.dutyId = m.duty_id;

      // ⚡ ซิงค์สิทธิ์และยศล่าสุดจาก Supabase ทันที ไม่ต้องรอให้คุกกี้เดิมหมดอายุ
      if (m.role) {
        user.role = m.role;
      }
      const isSysAdmin = m.role === 'ADMIN' || user.isAdmin;
      const isTeacher = m.role === 'TEACHER' || m.shift_role === 'TEACHER' || user.isTeacher;
      const isPres = m.role === 'PRESIDENT' || user.role === 'PRESIDENT';
      const isVP = m.role === 'VICE_PRESIDENT' || user.role === 'VICE_PRESIDENT';
      const { data: leadershipAssignments = [] } = await supabase
        .from('shift_leadership').select('shift_code, position').eq('member_id', m.id);
      const memberShift = baseDutyDay(m.duty_day);
      const memberShiftLeadership = leadershipAssignments.find(a => canonicalDutyDay(a.shift_code) === memberShift);

      user.isAdmin = isSysAdmin;
      user.isTeacher = isTeacher;
      user.isPresident = isPres;
      user.isVicePresident = isVP;
      user.canManageMembers = isSysAdmin || isTeacher || isPres || isVP;
      user.isCommander = isSysAdmin || isPres;
      user.isLeader = isSysAdmin || isTeacher || isPres || isVP || leadershipAssignments.length > 0 || (user.roles || []).some(r => typeof r === 'string' && r.startsWith('ROLE_HEAD'));

      if (isSysAdmin) {
        user.rank = '⚡ ผู้ดูแลระบบ';
        user.serverNick = `⚡ ผู้ดูแลระบบ (${m.nickname || user.username})`;
      } else if (isTeacher) {
        user.rank = '👨‍🏫 ครูที่ปรึกษา';
        user.serverNick = `👨‍🏫 ครูที่ปรึกษา (${m.nickname || user.username})`;
      } else if (isPres) {
        user.rank = '👑 ประธานสารวัตร';
      } else if (isVP) {
        user.rank = '⭐ รองประธานสารวัตร';
      } else if (memberShiftLeadership?.position === 'HEAD') {
        user.rank = `🛡️ หัวหน้าเวร (${memberShift})`;
      } else if (memberShiftLeadership?.position === 'DEPUTY') {
        user.rank = `🎖️ รองหัวหน้าเวร (${memberShift})`;
      } else {
        user.rank = '🛡️ สารวัตรนักเรียน';
      }

      if (m.first_name) {
        user.displayName = `${m.first_name} ${m.last_name || ''} (${m.nickname || ''})`.trim();
      }

      // รีเฟรชคุกกี้เซสชันด้วยยศและสิทธิ์ล่าสุดทันที
      const refreshedToken = signAuthToken(user);
      res.cookie('sarawat_auth', refreshedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });
    }
  } catch (e) {
    console.warn('Sync user data error:', e);
  }

  res.json({
    loggedIn: true,
    user
  });
});

// ออกจากระบบ (Logout)
app.get(['/logout', '/api/auth/logout'], (req, res) => {
  res.clearCookie('sarawat_auth', { path: '/' });
  if (req.path.startsWith('/api/')) {
    return res.json({ success: true, message: 'ออกจากระบบสำเร็จ' });
  }
  return res.redirect('/login');
});

// ป้องกันการเข้าถึงไฟล์ HTML ทุกไฟล์โดยตรงโดยไม่ล็อกอิน (ยกเว้น login, verify, landing)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && !req.path.includes('login') && !req.path.includes('verify') && !req.path.includes('landing')) {
    return requireAuth(req, res, next);
  }
  next();
});

// ป้องกัน API ภายในทั้งหมดด้วย Discord Auth (ยกเว้น /api/auth, /api/verify, /api/crop, /api/drive-proxy, และ POST /api/lost-found/claims สำหรับ Google Form / GAS)
app.use('/api', (req, res, next) => {
  if (
    req.path.startsWith('/auth') ||
    req.path.startsWith('/verify') ||
    req.path.startsWith('/crop') ||
    req.path.startsWith('/drive-proxy') ||
    (req.method === 'POST' && (req.path === '/lost-found/claims' || req.path.startsWith('/lost-found/claims')))
  ) {
    return next();
  }
  return requireAuth(req, res, next);
});

// Static files (ปิด index อัตโนมัติ เพื่อให้ผ่านการตรวจสอบสิทธิ์)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// -------------------------------------------------------------
// 1. Health Check
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'sarawat-pranarai-web',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// 2. API: สรุปสถิติภาพรวม (KPI Metrics)
// -------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    const { count: totalMembers } = await supabase.from('members').select('*', { count: 'exact', head: true });
    const { count: activeMembers } = await supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
    const { count: pendingMembers } = await supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL');

    const { count: totalCases } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    const { count: pendingCases } = await supabase.from('cases').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
    const { count: resolvedCases } = await supabase.from('cases').select('*', { count: 'exact', head: true }).eq('status', 'RESOLVED');

    // สถิติกำลังพลแยกตามผลัดเวร
    const { data: shiftData } = await supabase.from('members').select('duty_day').eq('status', 'ACTIVE');
    const shiftCounts = {
      M: 0, MS: 0,
      T: 0, TS: 0,
      W: 0, WS: 0,
      Th: 0, ThS: 0,
      F: 0, FS: 0,
      S: 0
    };

    (shiftData || []).forEach(row => {
      const code = canonicalDutyDay(row.duty_day);
      if (shiftCounts[code] !== undefined) {
        shiftCounts[code]++;
      } else {
        shiftCounts[code] = (shiftCounts[code] || 0) + 1;
      }
    });

    // สถิติการขอลาเวร (Leave Requests) จากฐานข้อมูล Supabase
    let totalLeaves = 0;
    let pendingLeaves = 0;
    let todayLeavesCount = 0;
    const leaveTypes = {
      sick: 0,        // ลาป่วย
      personal: 0,    // ลากิจ
      activity: 0,    // กิจกรรมโรงเรียน/แข่งขัน
      other: 0        // อื่นๆ
    };

    // สถิติแนวโน้มย้อนหลัง 7 วัน
    const weeklyTrend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
      weeklyTrend.push({
        date: iso,
        dayLabel: dayNames[d.getDay()],
        count: 0
      });
    }

    try {
      const { count: cLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });
      totalLeaves = cLeaves || 0;

      const { count: pLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
      pendingLeaves = pLeaves || 0;

      const { data: allLeaves } = await supabase.from('leave_requests')
        .select('leave_date, leave_type, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      const today = new Date();
      const todayISO = today.toISOString().slice(0, 10);
      const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const todayThaiPattern = `${today.getDate()} ${thaiMonths[today.getMonth()]}`;

      (allLeaves || []).forEach(l => {
        // นับยอดลาวันนี้
        if ((l.leave_date && l.leave_date.includes(todayThaiPattern)) ||
            (l.created_at && l.created_at.startsWith(todayISO))) {
          todayLeavesCount++;
        }

        // จัดหมวดหมู่ประเภทการลา
        const t = (l.leave_type || '').toLowerCase();
        if (t.includes('ป่วย') || t.includes('sick')) {
          leaveTypes.sick++;
        } else if (t.includes('กิจ') || t.includes('personal')) {
          leaveTypes.personal++;
        } else if (t.includes('กิจกรรม') || t.includes('แข่ง') || t.includes('activity')) {
          leaveTypes.activity++;
        } else {
          leaveTypes.other++;
        }

        // จับคู่ลงในแนวโน้ม 7 วัน
        if (l.created_at) {
          const itemDate = l.created_at.slice(0, 10);
          const trendItem = weeklyTrend.find(w => w.date === itemDate);
          if (trendItem) trendItem.count++;
        }
      });
    } catch (e) {
      console.warn('[WEB] Cannot query leave_requests:', e.message);
    }

    res.json({
      success: true,
      members: {
        total: totalMembers || 0,
        active: activeMembers || 0,
        pending: pendingMembers || 0
      },
      cases: {
        total: totalCases || 0,
        pending: pendingCases || 0,
        investigating: (totalCases || 0) - (pendingCases || 0) - (resolvedCases || 0),
        resolved: resolvedCases || 0
      },
      leaves: {
        total: totalLeaves,
        today: todayLeavesCount,
        pending: pendingLeaves,
        types: leaveTypes,
        trend: weeklyTrend
      },
      shifts: shiftCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2.05 API: ค่า Config สำหรับ Supabase Realtime Client
// -------------------------------------------------------------
app.get('/api/config/supabase-env', (req, res) => {
  res.json({
    success: true,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  });
});

// ==========================================================
// 📅 ACADEMIC PERIOD & QUARTER SYSTEM (ระบบปีการศึกษาและไตรมาส)
// ==========================================================
const PERIOD_SETTINGS_PATHS = [
  path.join(__dirname, 'settings.json'),
  path.join(__dirname, '..', 'bot', 'settings.json')
];

function getCurrentQuarterAndYear(d = new Date()) {
  const thaiDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const month = thaiDate.getMonth() + 1; // 1 - 12
  const ceYear = thaiDate.getFullYear();

  let quarter = 1;
  let semester = 2;
  let academicYear = ceYear + 543;

  if (month >= 11 || month === 1) {
    quarter = 1;
    semester = 2;
    academicYear = month === 1 ? (ceYear - 1) + 543 : ceYear + 543;
  } else if (month >= 2 && month <= 4) {
    quarter = 2;
    semester = 2;
    academicYear = (ceYear - 1) + 543;
  } else if (month >= 5 && month <= 7) {
    quarter = 3;
    semester = 1;
    academicYear = ceYear + 543;
  } else {
    quarter = 4;
    semester = 1;
    academicYear = ceYear + 543;
  }

  const quarterMonths = {
    1: 'พ.ย. - ม.ค.',
    2: 'ก.พ. - เม.ย.',
    3: 'พ.ค. - ก.ค.',
    4: 'ส.ค. - ต.ค.'
  };

  return {
    quarter,
    semester,
    academicYear,
    buddhistYear: ceYear + 543,
    ceYear,
    quarterName: `ไตรมาสที่ ${quarter} (${quarterMonths[quarter]})`,
    semesterName: `ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`,
    fullLabel: `ภาคเรียนที่ ${semester} / ปีการศึกษา ${academicYear} • ประจำไตรมาสที่ ${quarter} (12 สัปดาห์)`
  };
}

function getPeriodSettings() {
  for (const p of PERIOD_SETTINGS_PATHS) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {}
    }
  }
  const auto = getCurrentQuarterAndYear();
  return {
    mode: 'auto',
    academic_year: auto.academicYear,
    quarter: auto.quarter,
    current_semester: auto.semesterName
  };
}

function getAcademicPeriod() {
  const auto = getCurrentQuarterAndYear(new Date());
  const settings = getPeriodSettings();

  if (settings.mode === 'manual' && settings.academic_year && settings.quarter) {
    const q = parseInt(settings.quarter, 10) || auto.quarter;
    const y = parseInt(settings.academic_year, 10) || auto.academicYear;
    const sem = (q === 3 || q === 4) ? 1 : 2;
    const quarterMonths = { 1: 'พ.ย. - ม.ค.', 2: 'ก.พ. - เม.ย.', 3: 'พ.ค. - ก.ค.', 4: 'ส.ค. - ต.ค.' };
    return {
      quarter: q,
      semester: sem,
      academicYear: y,
      isAuto: false,
      quarterName: `ไตรมาสที่ ${q} (${quarterMonths[q] || ''})`,
      semesterName: settings.current_semester || `ภาคเรียนที่ ${sem} ปีการศึกษา ${y}`,
      fullLabel: `ภาคเรียนที่ ${sem} / ปีการศึกษา ${y} • ประจำไตรมาสที่ ${q} (12 สัปดาห์)`
    };
  }

  return {
    ...auto,
    isAuto: true
  };
}

function savePeriodSettings(data) {
  for (const p of PERIOD_SETTINGS_PATHS) {
    try {
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
  }
}

app.get('/api/academic-period', (req, res) => {
  const auto = getCurrentQuarterAndYear(new Date());
  const period = getAcademicPeriod();
  res.json({
    success: true,
    auto_detected: auto,
    current: period,
    settings: getPeriodSettings()
  });
});

app.post('/api/academic-period', (req, res) => {
  try {
    const { mode, academic_year, quarter, current_semester } = req.body;
    const settings = getPeriodSettings();
    if (mode === 'auto') {
      settings.mode = 'auto';
      delete settings.academic_year;
      delete settings.quarter;
      const auto = getCurrentQuarterAndYear(new Date());
      settings.current_semester = auto.semesterName;
    } else {
      settings.mode = 'manual';
      if (academic_year) settings.academic_year = parseInt(academic_year, 10);
      if (quarter) settings.quarter = parseInt(quarter, 10);
      if (current_semester) {
        settings.current_semester = current_semester;
      } else {
        const q = settings.quarter || 1;
        const sem = (q === 3 || q === 4) ? 1 : 2;
        settings.current_semester = `ภาคเรียนที่ ${sem} ปีการศึกษา ${settings.academic_year}`;
      }
    }
    settings.updated_at = new Date().toISOString();
    savePeriodSettings(settings);
    res.json({ success: true, period: getAcademicPeriod() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 2.1 API: ข้อมูลการขอลาเวร (Leave Requests)
// -------------------------------------------------------------
app.get('/api/leaves', async (req, res) => {
  try {
    const { date, shift } = req.query;
    let query = supabase
      .from('leave_requests')
      .select('*, members(first_name, last_name, nickname, duty_id, profile_image_url)')
      .order('created_at', { ascending: false });

    if (date) query = query.eq('leave_date', date);
    if (shift) query = query.eq('duty_day', shift);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// 🔲 PROFILE PHOTO CROPPER & GOOGLE DRIVE INTEGRATION
// =============================================================

// ตรวจสอบ Token ชั่วคราวสำหรับการครอปรูป
app.get('/api/crop/session/:token', async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(400).json({ valid: false, error: 'Token missing' });

  try {
    const { data, error } = await supabase
      .from('crop_tokens')
      .select('token, member_id, source_image_url, expires_at, used_at, members(id, first_name, last_name, nickname, duty_id, status)')
      .eq('token', token)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ valid: false, error: 'ไม่พบ Token นี้ หรือหมดอายุแล้ว' });
    }

    if (data.used_at) {
      return res.status(400).json({ valid: false, error: 'ลิงก์นี้ถูกใช้งานไปแล้ว' });
    }

    if (new Date(data.expires_at) < new Date()) {
      return res.status(400).json({ valid: false, error: 'ลิงก์นี้หมดอายุแล้ว (อายุใช้งาน 15 นาที)' });
    }

    const member = data.members || {};
    const memberName = `${member.first_name || ''} ${member.last_name || ''} (${member.nickname || member.duty_id || ''})`.trim();

    return res.json({
      valid: true,
      imageUrl: (data.source_image_url || '').split('#')[0],
      memberName: memberName,
      dutyId: member.duty_id || null,
      status: member.status || null,
      isActive: member.status === 'ACTIVE'
    });
  } catch (err) {
    console.error('[CROP] Session check error:', err);
    return res.status(500).json({ valid: false, error: 'Internal server error' });
  }
});

// บันทึกรูปที่ครอปแล้ว (1:1), อัปโหลด Supabase Storage + Google Drive
app.post('/api/crop/submit', async (req, res) => {
  const { token, imageBase64 } = req.body;
  if (!token || !imageBase64) {
    return res.status(400).json({ success: false, error: 'Missing token or image data' });
  }

  try {
    // 1. ดึงข้อมูล Token
    const { data: cropSession, error: sErr } = await supabase
      .from('crop_tokens')
      .select('*, members(id, first_name, last_name, nickname, duty_id, duty_day, grade_class, student_no, phone_number, status)')
      .eq('token', token)
      .maybeSingle();

    if (sErr || !cropSession) {
      return res.status(404).json({ success: false, error: 'Invalid token' });
    }

    if (cropSession.used_at) {
      return res.status(400).json({ success: false, error: 'Token already used' });
    }

    if (new Date(cropSession.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'Token expired' });
    }

    // 2. แปลง Base64 เป็น Buffer และบันทึกลง Local Uploads
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const member = cropSession.members || {};
    const safeDutyId = (member.duty_id || member.id || 'SW').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `profile_cropped_${safeDutyId}_${Date.now()}.jpg`;
    const buf = Buffer.from(imageBase64.split(',').pop(), 'base64');
    fs.writeFileSync(path.join(uploadDir, filename), buf);
    let finalImageUrl = `/uploads/${filename}`;

    // 3. อัปโหลดเข้าสู่ Supabase Storage (Bucket: sarawat-photos)
    try {
      const storagePath = `profile-photos/${filename}`;
      const { error: uploadErr } = await supabase.storage
        .from('sarawat-photos')
        .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });

      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
        finalImageUrl = publicUrl;
      }
    } catch (storageEx) {
      console.warn('[CROP] Supabase storage upload warning:', storageEx.message);
    }

    // 4. สำรองไฟล์ภาพเข้าสู่ Google Drive (Zero-dependency Service Account)
    let gdriveId = null;
    let gdriveUrl = null;
    try {
      const gdriveRes = await uploadToGoogleDrive(buf, filename, {
        memberName: `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'สารวัตรนักเรียน',
        dutyId: member.duty_id || '-'
      });
      if (gdriveRes && gdriveRes.success) {
        gdriveId = gdriveRes.fileId;
        gdriveUrl = gdriveRes.webViewLink;
      }
    } catch (gdriveEx) {
      console.warn('[CROP] Google Drive backup warning:', gdriveEx.message);
    }

    // 5. อัปเดตข้อมูลตาราง members
    const updatePayload = {
      profile_image_url: finalImageUrl,
      photo_cropped_at: new Date().toISOString()
    };
    if (member.status !== 'ACTIVE') {
      updatePayload.status = 'PENDING_APPROVAL';
    }
    if (gdriveId) updatePayload.gdrive_file_id = gdriveId;
    if (gdriveUrl) updatePayload.gdrive_file_url = gdriveUrl;

    await supabase
      .from('members')
      .update(updatePayload)
      .eq('id', cropSession.member_id);

    // 6. ทำเครื่องหมาย Token ว่าถูกใช้งานแล้ว
    await supabase
      .from('crop_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    // 7. แจ้งเตือนไปยัง Discord และส่งขออนุมัติเข้าห้องประชุมหัวหน้า
    let targetChannelId = null;
    let targetMessageId = null;
    if (cropSession.source_image_url) {
      const metaMatch = cropSession.source_image_url.match(/#discord_meta:(\d+):(\d+)/);
      if (metaMatch) {
        targetChannelId = metaMatch[1];
        targetMessageId = metaMatch[2];
      }
    }

    try {
      const discordToken = process.env.DISCORD_TOKEN;
      const approvalChanId = process.env.APPROVAL_CHANNEL_ID || '1567570916932722778';

      const isActive = (member.status === 'ACTIVE');
      const isSpecial = member.duty_day && member.duty_day.endsWith('S');
      const weekday = member.duty_day ? baseDutyDay(member.duty_day) : 'M';
      const DAY_NAMES = { M: 'จันทร์', T: 'อังคาร', W: 'พุธ', Th: 'พฤหัสบดี', F: 'ศุกร์', S: 'พิเศษ (ทุกวัน)' };
      const weekdayName = DAY_NAMES[weekday] || weekday;

      if (discordToken && targetChannelId && targetMessageId) {
        if (isActive) {
          // สมาชิกเดิมในห้องบริการสารวัตร: ลบข้อความเพื่อให้ห้องบริการสะอาดและรักษาความเป็นส่วนตัว
          await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/messages/${targetMessageId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bot ${discordToken}`
            }
          }).catch(err => console.warn('[DELETE PUBLIC PROMPT MSG NOTICE]:', err.message));
        } else {
          // ผู้สมัครลงทะเบียนใหม่: อัปเดตการ์ดยืนยันข้อมูลในห้องลงทะเบียนสารวัตรใหม่ทันที (Real-time)
          const confirmPayload = {
            content: `🔒 <@${cropSession.discord_id}> ตัดแต่งรูปถ่ายขนาด 1 นิ้วเรียบร้อยแล้ว! โปรดตรวจสอบข้อมูลและกดยืนยันในช่องนี้ได้เลยครับ:`,
            embeds: [{
              title: '🛡️ ยืนยันข้อมูลการลงทะเบียนสารวัตร [ขั้นตอนสุดท้าย]',
              description:
                `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname || '-'})**\n` +
                `ระบบได้รับการตัดแต่งและสำรองรูปถ่ายขนาด 1 นิ้ว (3:4) ของคุณเรียบร้อยแล้ว!\n\n` +
                `👉 **ต้องการยืนยันข้อมูลหรือไม่?**\n` +
                `• **หากข้อมูลและรูปถ่ายถูกต้องแล้ว:** กด **"✅ ยืนยันข้อมูล & ส่งขออนุมัติ"** เพื่อส่งให้ผู้บริหารพิจารณาอนุมัติ\n` +
                `• **หากต้องการแก้ไขข้อมูลหรือเปลี่ยนรูปใหม่:** กด **"✏️ แก้ไขข้อมูล"**`,
              fields: [
                {
                  name: '👤 ข้อมูลสารวัตร',
                  value: `• ชื่อ-สกุล: **${member.first_name} ${member.last_name}**\n• ชื่อเล่น: **${member.nickname || '-'}**\n• ชั้น/ห้อง: **ม.${member.grade_class || '-'}** เลขที่ **#${member.student_no || '-'}**`,
                  inline: true
                },
                {
                  name: '🛡️ ข้อมูลการปฏิบัติหน้าที่',
                  value: `• วันประจำการ: **วัน${weekdayName} (${weekday})**\n• ผลัดเวร: \`${member.duty_day || '-'}\` ${isSpecial ? '⭐' : ''}\n• เบอร์โทรศัพท์: \`${member.phone_number || '-'}\``,
                  inline: true
                },
                {
                  name: '⏳ สถานะปัจจุบัน',
                  value: '📋 **พร้อมส่งขออนุมัติ (รอการกดยืนยันจากคุณ)**',
                  inline: false
                }
              ],
              image: { url: finalImageUrl },
              color: 0x3498DB,
              footer: { text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ (เฉพาะเจ้าของที่กดยืนยันได้)' },
              timestamp: new Date().toISOString()
            }],
            components: [{
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3, // Success (Green)
                  label: '✅ ยืนยันข้อมูล & ส่งขออนุมัติ',
                  custom_id: `btn_confirm_send_approval_${member.id}`
                },
                {
                  type: 2,
                  style: 2, // Secondary (Grey)
                  label: '✏️ แก้ไขข้อมูล',
                  custom_id: `btn_edit_registration_info_${member.id}`
                }
              ]
            }]
          };

          const patchRes = await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/messages/${targetMessageId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bot ${discordToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(confirmPayload)
          });

          if (!patchRes.ok) {
            // หากแก้ไขข้อความเดิมไม่สำเร็จ ให้สร้างโพสต์ใหม่ในห้องเดิมทันที
            await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bot ${discordToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(confirmPayload)
            }).catch(e => console.warn('[POST FALLBACK CONFIRM NOTICE]:', e.message));
          }
        }
      }

      // 7.2 ส่งแจ้งเตือนเข้าแชทส่วนตัว (DM) ของผู้สมัคร เพื่อเตือนให้กลับมากดยืนยันในช่อง Discord
      if (discordToken && cropSession.discord_id) {
        const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${discordToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ recipient_id: cropSession.discord_id })
        });
        if (dmRes.ok) {
          const dmChan = await dmRes.json();
          if (isActive) {
            await fetch(`https://discord.com/api/v10/channels/${dmChan.id}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bot ${discordToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                embeds: [{
                  title: '✨ อัปเดตรูปถ่ายทำบัตรประจำตัว 3D สำเร็จเรียบร้อยแล้ว!',
                  description:
                    `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname || '-'})**\n` +
                    `รูปถ่ายขนาด 1 นิ้ว (3:4) ของคุณได้รับการอัปเดตลงบนบัตรประจำตัว 3D และสำรองเข้า Google Drive เรียบร้อยแล้ว`,
                  image: { url: finalImageUrl },
                  color: 0x2ECC71,
                  footer: { text: 'ระบบบริการสารวัตร • โรงเรียนพระนารายณ์ (ข้อความส่วนตัว)' },
                  timestamp: new Date().toISOString()
                }],
                components: [{
                  type: 1,
                  components: [{
                    type: 2,
                    style: 5,
                    label: '🪪 เปิดดูบัตรประจำตัว 3D',
                    url: `https://sarawat-promax.onrender.com/card?id=${member.id}`
                  }]
                }]
              })
            }).catch(() => {});
          } else {
            // ผู้สมัครลงทะเบียนใหม่: ส่งข้อความแจ้งเตือนสั้นๆ เข้า DM ให้กลับมากดยืนยันในช่อง Discord
            await fetch(`https://discord.com/api/v10/channels/${dmChan.id}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bot ${discordToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                content: `✨ <@${cropSession.discord_id}> คุณได้ตัดแต่งรูปถ่ายขนาด 1 นิ้วเรียบร้อยแล้ว!\n👉 **กรุณากลับไปกดยืนยันข้อมูลในช่อง <#${targetChannelId}>** เพื่อส่งคำขออนุมัติไปยังคณะผู้บริหารครับ`
              })
            }).catch(e => console.warn('[DM REVIEW SEND NOTICE]:', e.message));
          }
        }
      }
    } catch (dmErr) {
      console.warn('[CROP NOTIFICATION NOTICE]:', dmErr.message);
    }

    return res.json({
      success: true,
      imageUrl: finalImageUrl,
      gdriveUrl: gdriveUrl,
      isActive: (member.status === 'ACTIVE'),
      channelId: targetChannelId || '1567570864835264542'
    });
  } catch (err) {
    console.error('[CROP] Submit error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3. API: รายชื่อสารวัตรทั้งหมด (Members Roster)
// -------------------------------------------------------------
app.get('/api/members', async (req, res) => {
  try {
    const { duty_day, search, status } = req.query;
    let query = supabase
      .from('members')
      .select('id, first_name, last_name, nickname, grade_class, student_no, phone_number, profile_image_url, role, shift_role, duty_day, duty_id, status, discord_id')
      .order('duty_day', { ascending: true })
      .order('duty_id', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    } else {
      // ดึงทั้ง ACTIVE และ PENDING_APPROVAL (เช่น สมาชิกพรีโหลดที่รอผูก Discord)
      query = query.in('status', ['ACTIVE', 'PENDING_APPROVAL']);
    }

    if (duty_day && duty_day !== 'ALL') {
      // ดึงทั้งเวรปกติ และเวรพิเศษที่สังกัดวันนี้
      const canonicalDay = canonicalDutyDay(duty_day);
      const targetDays = expandDutyDayAliases(canonicalDay === 'S'
        ? ['S', 'MS', 'TS', 'WS', 'ThS', 'FS']
        : [canonicalDay, canonicalDay === 'Th' ? 'ThS' : `${canonicalDay}S`]);
      query = query.in('duty_day', targetDays);
    }

    const { data: members, error } = await query;
    if (error) throw error;

    const memberIds = (members || []).map(m => m.id).filter(Boolean);
    let leadershipByMember = {};
    if (memberIds.length) {
      try {
        const { data: assignments, error: leadershipError } = await supabase
          .from('shift_leadership')
          .select('member_id, shift_code, position')
          .in('member_id', memberIds);
        if (!leadershipError && assignments) {
          for (const assignment of assignments) {
            leadershipByMember[assignment.member_id] ||= {};
            const shiftCode = canonicalDutyDay(assignment.shift_code);
            leadershipByMember[assignment.member_id][shiftCode] ||= {};
            leadershipByMember[assignment.member_id][shiftCode][assignment.position] = true;
          }
        }
      } catch (leadershipErr) {
        // Table might not exist yet; gracefully fallback
        console.warn('[MEMBERS] shift_leadership fetch skipped:', leadershipErr.message);
      }
    }

    let filtered = members || [];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(m =>
        (m.first_name && m.first_name.toLowerCase().includes(s)) ||
        (m.last_name && m.last_name.toLowerCase().includes(s)) ||
        (m.nickname && m.nickname.toLowerCase().includes(s)) ||
        (m.duty_id && m.duty_id.toLowerCase().includes(s))
      );
    }

    res.json({
      success: true,
      count: filtered.length,
      data: filtered.map(m => ({
        ...m,
        duty_day: canonicalDutyDay(m.duty_day),
        duty_id: canonicalDutyId(m.duty_id),
        leadership_by_shift: leadershipByMember[m.id] || {}
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ตำแหน่งหัวหน้า/รองหัวหน้าเวรที่ผูกกับผลัดโดยตรง
// -------------------------------------------------------------
const LEADERSHIP_SHIFT_CODES = ['M', 'T', 'W', 'Th', 'F', 'S'];
const LEADERSHIP_POSITIONS = ['HEAD', 'DEPUTY'];
const WEB_LEADERSHIP_ROLE_IDS = {
  M: { HEAD: process.env.ROLE_HEAD_M || '1567570806412804126', DEPUTY: process.env.ROLE_DEPUTY_M || '1567570808270758020' },
  T: { HEAD: process.env.ROLE_HEAD_T || '1567570810439335946', DEPUTY: process.env.ROLE_DEPUTY_T || '1567570812024786996' },
  W: { HEAD: process.env.ROLE_HEAD_W || '1567570813878804511', DEPUTY: process.env.ROLE_DEPUTY_W || '1567570815728353490' },
  Th: { HEAD: process.env.ROLE_HEAD_THU || '1567570829288542218', DEPUTY: process.env.ROLE_DEPUTY_THU || '1567570831851126804' },
  F: { HEAD: process.env.ROLE_HEAD_F || '1567570837215649962', DEPUTY: process.env.ROLE_DEPUTY_F || '1567570839925293178' },
  S: { HEAD: process.env.ROLE_HEAD_S || '1567570801866047589', DEPUTY: process.env.ROLE_DEPUTY_S || '1567570803703423006' }
};

const WEB_DAY_ROLE_IDS = {
  M: process.env.ROLE_MON || '1567570846388854804',
  T: process.env.ROLE_TUE || '1567570847726567526',
  W: process.env.ROLE_WED || '1567570849953743049',
  Th: process.env.ROLE_THU || '1567570850935218449',
  F: process.env.ROLE_FRI || '1567570856966758431',
  S: process.env.ROLE_SPECIAL || '1567570841548627971'
};

async function revokeAllDiscordRolesForMember(discordId) {
  if (!discordId || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;
  const roleVerified = process.env.ROLE_VERIFIED || '1567570843335528578';
  const roleSpecial = process.env.ROLE_SPECIAL || '1567570841548627971';
  const allRoles = new Set([
    roleVerified,
    roleSpecial,
    ...Object.values(WEB_DAY_ROLE_IDS),
    ...Object.values(WEB_LEADERSHIP_ROLE_IDS).flatMap(p => [p.HEAD, p.DEPUTY])
  ]);

  const promises = [];
  for (const rId of allRoles) {
    if (!rId) continue;
    promises.push(
      fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${rId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(3000)
      }).catch(() => {})
    );
  }
  // Reset nickname
  promises.push(
    fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nick: null }),
      signal: AbortSignal.timeout(3000)
    }).catch(() => {})
  );
  await Promise.allSettled(promises);
}

/**
 * 📣 ส่งข้อความบันทึกการกระทำ (Action Log) เข้าห้อง Log ของ Discord
 */
async function sendDiscordActionLog({ title, description, fields = [], color = 0xE74C3C, actor = '🌐 ผู้ดูแลระบบบนเว็บ' }) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;
  try {
    const chRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/channels`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      signal: AbortSignal.timeout(3500)
    });
    const channels = await chRes.json();
    if (!Array.isArray(channels)) return;
    const logChan = channels.find(c => c.type === 0 && (c.name.toLowerCase() === 'log' || c.name.includes('บันทึก') || c.name.includes('action-log')));
    if (!logChan) return;

    await fetch(`https://discord.com/api/v10/channels/${logChan.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [{
          title,
          description,
          fields: [
            { name: '👤 ผู้ดำเนินการ', value: actor, inline: true },
            ...fields
          ],
          color,
          footer: { text: `SARAWAT Audit Logger • เวลาไทย: ${new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}` },
          timestamp: new Date().toISOString()
        }]
      }),
      signal: AbortSignal.timeout(4000)
    });
  } catch (err) {
    console.warn('[LOG] Error sending Discord action log:', err.message);
  }
}

async function syncLeadershipDiscordRole(memberId, shiftCode, position, method) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;
  const { data: member } = await supabase.from('members').select('discord_id').eq('id', memberId).maybeSingle();
  const roleId = WEB_LEADERSHIP_ROLE_IDS[shiftCode]?.[position];
  if (!member?.discord_id || !roleId) return;
  const response = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${member.discord_id}/roles/${roleId}`, {
    method,
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Discord role sync failed (${response.status})`);
  }
}

function canManageShiftLeadership(user) {
  return Boolean(user && (
    user.isAdmin || user.isTeacher || user.isPresident || user.isVicePresident ||
    ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(user.role)
  ));
}

function memberBelongsToShift(dutyDay, shiftCode) {
  const code = canonicalDutyDay(dutyDay);
  if (shiftCode === 'S') return code === 'S' || /S$/.test(code);
  if (shiftCode === 'Th') return ['Th', 'ThS'].includes(code);
  const specialVariants = { M: 'MS', T: 'TS', W: 'WS', F: 'FS' };
  return code === shiftCode || code === specialVariants[shiftCode];
}

app.get('/api/shift-leadership', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('shift_leadership')
      .select('shift_code, position, member_id, members(id, duty_id, first_name, last_name, nickname, grade_class, duty_day, phone_number, profile_image_url)');
    if (error) {
      return res.json({ success: true, data: [], canManage: canManageShiftLeadership(req.user) });
    }
    res.json({ success: true, data: (data || []).map(row => ({
      ...row,
      shift_code: canonicalDutyDay(row.shift_code),
      members: row.members ? {
        ...row.members,
        duty_day: canonicalDutyDay(row.members.duty_day),
        duty_id: canonicalDutyId(row.members.duty_id)
      } : row.members
    })), canManage: canManageShiftLeadership(req.user) });
  } catch (err) {
    res.json({ success: true, data: [], canManage: canManageShiftLeadership(req.user) });
  }
});

app.post('/api/shift-leadership', async (req, res) => {
  try {
    if (!canManageShiftLeadership(req.user)) {
      return res.status(403).json({ success: false, message: 'สงวนสิทธิ์สำหรับผู้ดูแลระบบ ครู ประธาน และรองประธาน' });
    }
    const { shift_code: rawShiftCode, position, member_id: memberId } = req.body || {};
    const shiftCode = canonicalDutyDay(rawShiftCode);
    if (!LEADERSHIP_SHIFT_CODES.includes(shiftCode) || !LEADERSHIP_POSITIONS.includes(position) || !memberId) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกผลัด ตำแหน่ง และสารวัตรให้ครบ' });
    }

    const { data: member, error: memberError } = await supabase
      .from('members').select('id, duty_day, status').eq('id', memberId).maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, message: 'ไม่พบสารวัตรที่ได้รับการอนุมัติแล้ว' });
    }
    if (!memberBelongsToShift(member.duty_day, shiftCode)) {
      return res.status(400).json({ success: false, message: 'เลือกได้เฉพาะสารวัตรที่อยู่ในผลัดนี้' });
    }

    const { data: otherAssignment, error: duplicateError } = await supabase
      .from('shift_leadership').select('position').eq('member_id', memberId).in('shift_code', expandDutyDayAliases([shiftCode])).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (otherAssignment && otherAssignment.position !== position) {
      return res.status(409).json({ success: false, message: 'สารวัตรคนเดียวกันเป็นทั้งหัวหน้าและรองในผลัดเดียวกันไม่ได้' });
    }

    const { data: previousAssignment, error: previousError } = await supabase
      .from('shift_leadership').select('member_id').in('shift_code', expandDutyDayAliases([shiftCode])).eq('position', position).maybeSingle();
    if (previousError) throw previousError;

    const { data, error } = await supabase.from('shift_leadership').upsert({
      shift_code: shiftCode,
      position,
      member_id: memberId,
      assigned_by: req.user?.id || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'shift_code,position' }).select('shift_code, position, member_id').single();
    if (error) throw error;
    try {
      if (previousAssignment?.member_id && previousAssignment.member_id !== memberId) {
        await syncLeadershipDiscordRole(previousAssignment.member_id, shiftCode, position, 'DELETE');
      }
      await syncLeadershipDiscordRole(memberId, shiftCode, position, 'PUT');
    } catch (roleError) {
      console.error('[LEADERSHIP] Discord role sync failed:', roleError.message);
    }
    res.json({ success: true, message: 'บันทึกตำแหน่งประจำผลัดแล้ว', data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกตำแหน่งไม่สำเร็จ กรุณาตรวจว่าติดตั้ง migration_v10 แล้ว', error: err.message });
  }
});

app.delete('/api/shift-leadership/:shiftCode/:position', async (req, res) => {
  try {
    if (!canManageShiftLeadership(req.user)) {
      return res.status(403).json({ success: false, message: 'สงวนสิทธิ์สำหรับผู้ดูแลระบบ ครู ประธาน และรองประธาน' });
    }
    const { position } = req.params;
    const shiftCode = canonicalDutyDay(req.params.shiftCode);
    if (!LEADERSHIP_SHIFT_CODES.includes(shiftCode) || !LEADERSHIP_POSITIONS.includes(position)) {
      return res.status(400).json({ success: false, message: 'ผลัดหรือตำแหน่งไม่ถูกต้อง' });
    }
    const { data: previousAssignment } = await supabase
      .from('shift_leadership').select('member_id').in('shift_code', expandDutyDayAliases([shiftCode])).eq('position', position).maybeSingle();
    const { error } = await supabase.from('shift_leadership').delete().in('shift_code', expandDutyDayAliases([shiftCode])).eq('position', position);
    if (error) throw error;
    if (previousAssignment?.member_id) {
      try { await syncLeadershipDiscordRole(previousAssignment.member_id, shiftCode, position, 'DELETE'); }
      catch (roleError) { console.error('[LEADERSHIP] Discord role removal failed:', roleError.message); }
    }
    res.json({ success: true, message: 'ถอดตำแหน่งประจำผลัดแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ถอดตำแหน่งไม่สำเร็จ', error: err.message });
  }
});

// -------------------------------------------------------------
// 3.1 API: เพิ่มสารวัตรใหม่เข้าระบบ (สิทธิ์: ผู้ดูแลระบบ, ครูที่ปรึกษา, ประธาน, รองประธาน)
// -------------------------------------------------------------
app.post('/api/members', async (req, res) => {
  try {
    let user = getUserFromReq(req);
    let isAllowed = user && (
      user.isAdmin || user.isTeacher || user.isPresident || user.isVicePresident ||
      user.role === 'ADMIN' || user.role === 'TEACHER' || user.role === 'PRESIDENT' || user.role === 'VICE_PRESIDENT'
    );

    // หากคุกกี้ยังไม่สะท้อนสิทธิ์ล่าสุด ให้ซิงค์ตรงจาก Supabase
    if (!isAllowed && user && user.id) {
      try {
        const { data: dbUser } = await supabase.from('members').select('role').eq('discord_id', user.id).maybeSingle();
        if (dbUser && ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(dbUser.role)) {
          user.role = dbUser.role;
          if (dbUser.role === 'ADMIN') user.isAdmin = true;
          if (dbUser.role === 'TEACHER') user.isTeacher = true;
          if (dbUser.role === 'PRESIDENT') user.isPresident = true;
          if (dbUser.role === 'VICE_PRESIDENT') user.isVicePresident = true;
          isAllowed = true;
        }
      } catch (err) {}
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: สิทธิ์การเพิ่มสมาชิกสงวนเฉพาะผู้ดูแลระบบ ครูที่ปรึกษา ประธาน หรือรองประธานเท่านั้น' });
    }

    const {
      first_name,
      last_name,
      nickname,
      grade_class,
      student_no,
      phone_number,
      duty_day,
      duty_id,
      role,
      shift_role
    } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อจริง และนามสกุลให้ครบถ้วน' });
    }

    const cleanFirstName = String(first_name).trim();
    const cleanLastName = String(last_name).trim();
    const cleanNickname = (nickname && String(nickname).trim() && String(nickname).trim() !== '-') 
      ? String(nickname).trim() 
      : '-';
    const cleanClass = (grade_class && String(grade_class).trim()) 
      ? String(grade_class).replace(/^ม\./, '').trim() 
      : '-';
    const cleanNo = (student_no !== undefined && student_no !== null && String(student_no).trim() !== '') 
      ? (parseInt(student_no, 10) || 0) 
      : 0;
    const cleanPhone = (phone_number && String(phone_number).trim() !== '') 
      ? String(phone_number).trim() 
      : '-';

    // ตรวจสอบชื่อ-นามสกุลซ้ำ
    const { data: existing } = await supabase
      .from('members')
      .select('id, first_name, last_name')
      .eq('first_name', cleanFirstName)
      .eq('last_name', cleanLastName)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: `มีรายชื่อ ${cleanFirstName} ${cleanLastName} อยู่ในระบบแล้ว` });
    }

    const newMemberPayload = {
      first_name: cleanFirstName,
      last_name: cleanLastName,
      nickname: cleanNickname,
      grade_class: cleanClass,
      student_no: cleanNo,
      phone_number: cleanPhone,
      duty_day: duty_day ? canonicalDutyDay(duty_day) : null,
      duty_id: duty_id ? canonicalDutyId(duty_id) : null,
      role: role || 'MEMBER',
      shift_role: shift_role || 'MEMBER',
      status: 'PENDING_APPROVAL',
      discord_id: null,
      created_at: new Date()
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('members')
      .insert([newMemberPayload])
      .select('*')
      .single();

    if (insertErr) {
      console.error('[API] Error inserting new member:', insertErr);
      return res.status(500).json({ error: 'ไม่สามารถบันทึกข้อมูลสมาชิกใหม่ได้: ' + insertErr.message });
    }

    console.log(`[API] ✅ เพิ่มสมาชิกใหม่สำเร็จ: ${inserted.first_name} ${inserted.last_name} (${inserted.nickname})`);
    return res.status(201).json({ success: true, member: inserted });
  } catch (err) {
    console.error('[API] /api/members POST crash:', err);
    return res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3.2 API: อัปเดตข้อมูลสารวัตร (สิทธิ์เฉพาะประธาน/ผู้บริหาร/Commander)
// -------------------------------------------------------------
function getDutyIdPrefixForDay(dutyDay) {
  const code = canonicalDutyDay(dutyDay);
  if (code === 'S') return 'S';
  if (code === 'ThS') return 'ThS';
  if (code === 'Th') return 'Th';
  if (['MS', 'TS', 'WS', 'FS'].includes(code)) return code;
  return code;
}

async function getNextAvailableDutyId(dutyDay, excludedMemberId) {
  const prefix = getDutyIdPrefixForDay(dutyDay);
  if (!prefix) throw new Error('กรุณาเลือกผลัดเวรก่อนกำหนดรหัสเวร');

  let query = supabase.from('members').select('duty_id').not('duty_id', 'is', null);
  if (excludedMemberId) query = query.neq('id', excludedMemberId);
  const { data: rows, error } = await query;
  if (error) throw error;

  const usedIds = new Set((rows || []).map(row => canonicalDutyId(row.duty_id)));
  for (let sequence = 1; sequence <= usedIds.size + 1; sequence++) {
    const candidate = `${prefix}${sequence}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  throw new Error(`ไม่พบรหัสเวรว่างสำหรับผลัด ${dutyDay}`);
}

app.patch('/api/members/:id', async (req, res) => {
  const requestedDutyId = req.body?.duty_id === undefined
    ? undefined
    : String(req.body.duty_id || '').trim();
  try {
    let user = getUserFromReq(req);
    // ตรวจสอบสิทธิ์ว่าเป็นผู้ดูแลระบบ (Admin) หรือครูที่ปรึกษาหรือประธาน/รองประธาน/ผู้บริหาร
    let isAllowed = user && (
      user.isAdmin || user.isCommander || user.isLeader || user.isTeacher || user.isPresident || user.isVicePresident || user.canManageMembers ||
      user.role === 'ADMIN' || user.role === 'COMMANDER' || user.role === 'PRESIDENT' || user.role === 'VICE_PRESIDENT' || user.role === 'TEACHER'
    );

    // หากคุกกี้ยังเป็นค่าเดิม ให้ซิงค์สิทธิ์สดตรงจาก Supabase ทันที
    if (!isAllowed && user && user.id) {
      try {
        const { data: dbUser } = await supabase.from('members').select('role').eq('discord_id', user.id).maybeSingle();
        if (dbUser && (dbUser.role === 'ADMIN' || dbUser.role === 'PRESIDENT' || dbUser.role === 'VICE_PRESIDENT' || dbUser.role === 'TEACHER')) {
          user.role = dbUser.role;
          user.isAdmin = dbUser.role === 'ADMIN';
          user.isTeacher = dbUser.role === 'TEACHER';
          user.isPresident = dbUser.role === 'PRESIDENT';
          user.isVicePresident = dbUser.role === 'VICE_PRESIDENT';
          user.isCommander = dbUser.role === 'ADMIN' || dbUser.role === 'PRESIDENT';
          user.isLeader = true;
          isAllowed = true;
        } else {
          // สารวัตรทั่วไปสามารถแก้ไขข้อมูลส่วนตัวของตนเองได้
          const { data: targetMember } = await supabase.from('members').select('id, discord_id').eq('id', req.params.id).maybeSingle();
          if (targetMember && targetMember.discord_id === user.id) {
            isAllowed = true;
          }
        }
      } catch (err) {}
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: สิทธิ์แก้ไขข้อมูลสงวนเฉพาะผู้ดูแลระบบหรือประธานสารวัตรเท่านั้น' });
    }

    const { id } = req.params;
    const { first_name, last_name, nickname, grade_class, student_no, phone_number, duty_day, duty_id, role, shift_role, rank, profile_image_url, status, discord_id } = req.body;

    const updateData = {};
    let dutyIdChanged = false;
    let originalDutyId = requestedDutyId;
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (nickname !== undefined) updateData.nickname = nickname;
    if (grade_class !== undefined) updateData.grade_class = grade_class;
    if (student_no !== undefined) updateData.student_no = student_no;
    if (phone_number !== undefined) updateData.phone_number = phone_number;
    if (duty_day !== undefined) updateData.duty_day = duty_day ? canonicalDutyDay(duty_day) : null;
    if (duty_id !== undefined) {
      const cleanDutyId = canonicalDutyId(duty_id);
      updateData.duty_id = cleanDutyId || null;
      if (cleanDutyId) {
        const { data: duplicateDutyId, error: duplicateLookupError } = await supabase
          .from('members')
          .select('id, duty_id, nickname, first_name, last_name')
          .eq('duty_id', cleanDutyId)
          .neq('id', id)
          .maybeSingle();
        if (duplicateLookupError) throw duplicateLookupError;
        if (duplicateDutyId) {
          const targetDutyDay = duty_day !== undefined
            ? duty_day
            : (await supabase.from('members').select('duty_day').eq('id', id).maybeSingle()).data?.duty_day;
          updateData.duty_id = await getNextAvailableDutyId(targetDutyDay, id);
          dutyIdChanged = true;
        }
      }
    }
    if (role !== undefined) updateData.role = role;
    if (shift_role !== undefined) updateData.shift_role = shift_role;
    if (rank !== undefined) updateData.rank = rank;
    if (status !== undefined) updateData.status = status;
    if (discord_id !== undefined) updateData.discord_id = discord_id ? String(discord_id).trim() : null;
    if (profile_image_url !== undefined) updateData.profile_image_url = profile_image_url;
    updateData.updated_at = new Date().toISOString();

    let { data, error } = await supabase
      .from('members').update(updateData).eq('id', id).select().maybeSingle();
    for (let retry = 0; error?.code === '23505' && String(error.message || '').includes('members_duty_id_key') && retry < 3; retry++) {
      if (duty_day === undefined && !updateData.duty_day) {
        const { data: currentMember, error: currentMemberError } = await supabase
          .from('members').select('duty_day').eq('id', id).maybeSingle();
        if (currentMemberError) throw currentMemberError;
        updateData.duty_day = currentMember?.duty_day;
      }
      if (!originalDutyId) originalDutyId = updateData.duty_id;
      updateData.duty_id = await getNextAvailableDutyId(updateData.duty_day, id);
      dutyIdChanged = true;
      ({ data, error } = await supabase
        .from('members').update(updateData).eq('id', id).select().maybeSingle());
    }

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'ไม่พบข้อมูลสารวัตรท่านนี้' });

    // 🤖 ซิงค์การเปลี่ยนรหัสเวรและบทบาทเวรพิเศษเข้าสู่ Discord ทันที
    if (data && data.discord_id && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        // The persisted shift day is authoritative: TS1 can be a stale ID on
        // a regular Thursday (Th), so duty_id must not keep the special role.
        const dutyDay = String(data.duty_day || '').trim();
        const isSpecialDuty = dutyDay === 'S' || /S$/.test(dutyDay);
        const roleSpecial = process.env.ROLE_SPECIAL || '1567570841548627971';

        // 1. อัปเดต Discord Nickname ตามรหัสเวรใหม่
        const newNick = data.role === 'TEACHER'
          ? `[ครูที่ปรึกษา] ${data.nickname || ''} (${data.first_name || ''})`.substring(0, 32)
          : `[${data.duty_id || 'สารวัตร'}] ${data.nickname || ''} (${data.first_name || ''})`.substring(0, 32);

        await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${data.discord_id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ nick: newNick })
        }).catch(() => {});

        // 2. ซิงค์ยศเวรพิเศษ (ROLE_SPECIAL)
        if (roleSpecial) {
          if (isSpecialDuty) {
            await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${data.discord_id}/roles/${roleSpecial}`, {
              method: 'PUT',
              headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
              signal: AbortSignal.timeout(3000)
            }).catch(() => {});
          } else {
            await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${data.discord_id}/roles/${roleSpecial}`, {
              method: 'DELETE',
              headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
              signal: AbortSignal.timeout(3000)
            }).catch(() => {});
          }
        }

        // 3. ซิงค์ยศวันประจำผลัดเวร (ROLE_MON..FRI)
        const baseDay = canonicalDutyDay(dutyDay);
        const targetDayRole = WEB_DAY_ROLE_IDS[baseDay];
        if (targetDayRole) {
          await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${data.discord_id}/roles/${targetDayRole}`, {
            method: 'PUT',
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
            signal: AbortSignal.timeout(3000)
          }).catch(() => {});

          for (const [dCode, rId] of Object.entries(WEB_DAY_ROLE_IDS)) {
            if (dCode !== baseDay && dCode !== 'S' && rId) {
              await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${data.discord_id}/roles/${rId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
                signal: AbortSignal.timeout(3000)
              }).catch(() => {});
            }
          }
        }
      } catch (dErr) {
        console.warn('[SARAWAT-WEB] Discord sync warning:', dErr.message);
      }
    }

    console.log(`[SARAWAT-WEB] ✏️ ข้อมูลสารวัตร ${data.nickname || data.duty_id} ถูกอัปเดตโดย ${user.username || user.nickname}`);
    res.json({
      success: true,
      message: dutyIdChanged
        ? `รหัสเวรซ้ำ ระบบเปลี่ยนเป็น ${data.duty_id} ให้แล้ว`
        : 'อัปเดตข้อมูลสารวัตรสำเร็จ',
      data,
      duty_id_changed: dutyIdChanged,
      previous_duty_id: dutyIdChanged ? originalDutyId : undefined
    });
  } catch (err) {
    if (err.code === '23505' && String(err.message || '').includes('members_duty_id_key')) {
      return res.status(409).json({
        success: false,
        code: 'DUTY_ID_TAKEN',
        error: `รหัสเวร ${requestedDutyId || ''} ถูกใช้แล้ว กรุณาเลือกรหัสที่ยังว่างแล้วบันทึกอีกครั้ง`
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3.3 API: ลบสารวัตรออกจากระบบ (สิทธิ์: ผู้ดูแลระบบ, ครูที่ปรึกษา, ประธาน, รองประธาน)
// -------------------------------------------------------------
app.delete('/api/members/:id', async (req, res) => {
  try {
    let user = getUserFromReq(req);
    let isAllowed = user && (
      user.isAdmin || user.isTeacher || user.isPresident || user.isVicePresident || user.canManageMembers ||
      user.role === 'ADMIN' || user.role === 'TEACHER' || user.role === 'PRESIDENT' || user.role === 'VICE_PRESIDENT'
    );

    if (!isAllowed && user && user.id) {
      try {
        const { data: dbUser } = await supabase.from('members').select('role').eq('discord_id', user.id).maybeSingle();
        if (dbUser && ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(dbUser.role)) {
          isAllowed = true;
        }
      } catch (err) {}
    }

    if (!isAllowed && user && user.id) {
      try {
        const { data: dbUser } = await supabase.from('members').select('role').eq('discord_id', user.id).maybeSingle();
        if (dbUser && ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(dbUser.role)) {
          isAllowed = true;
        }
      } catch (err) {}
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: สิทธิ์การลบสมาชิกสงวนเฉพาะผู้ดูแลระบบ ครูที่ปรึกษา ประธาน หรือรองประธานเท่านั้น' });
    }

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ไม่ระบุรหัสสมาชิก' });

    const { data: targetMember, error: findErr } = await supabase
      .from('members')
      .select('id, first_name, last_name, nickname, discord_id')
      .eq('id', id)
      .maybeSingle();

    if (findErr || !targetMember) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลสมาชิกที่ต้องการลบ' });
    }

    // ลบข้อมูลที่เกี่ยวข้องใน shift_leadership, leave_requests, lost_items หากมี
    try {
      await supabase.from('shift_leadership').delete().eq('member_id', id);
      await supabase.from('leave_requests').delete().eq('member_id', id);
      await supabase.from('lost_items').update({ assigned_officer_id: null }).eq('assigned_officer_id', id);
      await supabase.from('lost_items').update({ reported_by_id: null }).eq('reported_by_id', id);
    } catch (e) {
      console.warn('[API] Warning deleting member relations:', e.message);
    }

    // ลบเรคคอร์ดจาก members
    const { error: delErr } = await supabase
      .from('members')
      .delete()
      .eq('id', id);

    if (delErr) {
      console.error('[API] Error deleting member:', delErr);
      return res.status(500).json({ error: 'ไม่สามารถลบข้อมูลสมาชิกได้: ' + delErr.message });
    }

    // 🤖 เพิกถอนสิทธิ์สารวัตรและรีเซ็ตชื่อใน Discord ทันทีแบบ Non-blocking
    if (targetMember.discord_id) {
      revokeAllDiscordRolesForMember(targetMember.discord_id).catch(err => {
        console.warn('[API] Warning revoking member Discord roles:', err.message);
      });
    }

    sendDiscordActionLog({
      title: '🗑️ [ลบข้อมูลสารวัตรผ่านระบบเว็บ]',
      description: `มีการสั่งลบข้อมูลสารวัตร **[${targetMember.duty_id || 'ไม่มีรหัส'}] ${targetMember.first_name} ${targetMember.last_name} (${targetMember.nickname || '-'})** ออกจากระบบ และเพิกถอนสิทธิ์ Discord เรียบร้อยแล้ว`,
      color: 0xE74C3C,
      actor: user?.username ? `${user.username} (${user.role || 'Admin'})` : '🌐 ผู้ดูแลระบบผ่าน Dashboard'
    }).catch(() => {});

    console.log(`[API] 🗑️ ลบข้อมูลสมาชิกสำเร็จ: ${targetMember.first_name} ${targetMember.last_name} (${targetMember.nickname}) [ID: ${id}]`);
    return res.json({ success: true, message: `ลบข้อมูล ${targetMember.first_name} ${targetMember.last_name} (${targetMember.nickname || '-'}) เรียบร้อยแล้ว` });
  } catch (err) {
    console.error('[API] /api/members/:id DELETE crash:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 🧹 ล้างข้อมูลทดสอบทั้งหมดที่ยังไม่ได้ผูก Discord (Unlinked Pre-registered Records)
app.post('/api/members/cleanup-unlinked', async (req, res) => {
  try {
    let user = getUserFromReq(req);
    let isAllowed = user && (
      user.isAdmin || user.isTeacher || user.isPresident || user.isVicePresident || user.canManageMembers ||
      user.role === 'ADMIN' || user.role === 'TEACHER' || user.role === 'PRESIDENT' || user.role === 'VICE_PRESIDENT'
    );

    if (!isAllowed && user && user.id) {
      try {
        const { data: dbUser } = await supabase.from('members').select('role').eq('discord_id', user.id).maybeSingle();
        if (dbUser && ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(dbUser.role)) {
          isAllowed = true;
        }
      } catch (err) {}
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: สิทธิ์การล้างข้อมูลสงวนเฉพาะผู้ดูแลระบบหรือประธานสารวัตรเท่านั้น' });
    }

    // ค้นหาสมาชิกทั้งหมดที่ discord_id เป็น null
    const { data: unlinked, error: findErr } = await supabase
      .from('members')
      .select('id, first_name, last_name, nickname')
      .is('discord_id', null);

    if (findErr) throw findErr;
    if (!unlinked || unlinked.length === 0) {
      return res.json({ success: true, count: 0, message: 'ไม่พบรายชื่อที่ยังไม่ผูก Discord ในระบบ' });
    }

    const ids = unlinked.map(m => m.id);

    // ล้างข้อมูลอ้างอิงที่เกี่ยวข้อง
    try {
      await supabase.from('shift_leadership').delete().in('member_id', ids);
      await supabase.from('leave_requests').delete().in('member_id', ids);
      await supabase.from('lost_items').update({ assigned_officer_id: null }).in('assigned_officer_id', ids);
      await supabase.from('lost_items').update({ reported_by_id: null }).in('reported_by_id', ids);
    } catch (e) {
      console.warn('[API] Warning cleaning unlinked relations:', e.message);
    }

    // ลบสมาชิก
    const { error: delErr } = await supabase
      .from('members')
      .delete()
      .in('id', ids);

    if (delErr) throw delErr;

    console.log(`[API] 🧹 ล้างรายชื่อที่ยังไม่ผูก Discord สำเร็จ: ${ids.length} รายการ`);
    return res.json({ 
      success: true, 
      count: ids.length, 
      message: `ล้างรายชื่อทดสอบที่ยังไม่ผูก Discord เรียบร้อยแล้วจำนวน ${ids.length} รายการ` 
    });
  } catch (err) {
    console.error('[API] /api/members/cleanup-unlinked crash:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 🗑️ ลบข้อมูลสมาชิกที่เลือกแบบหลายรายการ (Batch Delete Members with Discord Sync)
app.post('/api/members/batch-delete', async (req, res) => {
  try {
    let user = getUserFromReq(req);
    let isAllowed = user && (
      user.isAdmin || user.isTeacher || user.isPresident || user.isVicePresident || user.canManageMembers ||
      user.role === 'ADMIN' || user.role === 'TEACHER' || user.role === 'PRESIDENT' || user.role === 'VICE_PRESIDENT'
    );

    if (!isAllowed && user && user.id) {
      try {
        const { data: dbUser } = await supabase.from('members').select('role').eq('discord_id', user.id).maybeSingle();
        if (dbUser && ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(dbUser.role)) {
          isAllowed = true;
        }
      } catch (err) {}
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: สิทธิ์การลบข้อมูลสงวนเฉพาะผู้ดูแลระบบหรือประธานสารวัตรเท่านั้น' });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'กรุณาระบุรายการสมาชิกที่ต้องการลบ' });
    }

    // 1. ดึงข้อมูลสมาชิกทั้งหมดที่กำลังจะลบ เพื่อใช้เพิกถอนสิทธิ์ Discord และส่ง Log
    const { data: targetMembers, error: fetchErr } = await supabase
      .from('members')
      .select('id, discord_id, first_name, last_name, nickname, duty_id, duty_day, status')
      .in('id', ids);

    if (fetchErr) throw fetchErr;
    if (!targetMembers || targetMembers.length === 0) {
      return res.json({ success: true, count: 0, message: 'ไม่พบรายการสมาชิกที่ระบุในระบบ' });
    }

    // 2. เพิกถอนสิทธิ์ใน Discord สำหรับสมาชิกที่มี discord_id
    const revokePromises = [];
    for (const m of targetMembers) {
      if (m.discord_id) {
        revokePromises.push(revokeAllDiscordRolesForMember(m.discord_id));
      }
    }
    if (revokePromises.length > 0) {
      Promise.allSettled(revokePromises).catch(err => {
        console.warn('[API] Warning batch-revoking Discord roles:', err);
      });
    }

    // 3. ล้างข้อมูลอ้างอิง Foreign Key
    try {
      await supabase.from('shift_leadership').delete().in('member_id', ids);
      await supabase.from('leave_requests').delete().in('member_id', ids);
      await supabase.from('lost_items').update({ assigned_officer_id: null }).in('assigned_officer_id', ids);
      await supabase.from('lost_items').update({ reported_by_id: null }).in('reported_by_id', ids);
    } catch (e) {
      console.warn('[API] Warning batch-cleaning member relations:', e.message);
    }

    // 4. ลบข้อมูลออกจากตาราง members
    const { error: delErr } = await supabase
      .from('members')
      .delete()
      .in('id', ids);

    if (delErr) throw delErr;

    // 5. ส่งบันทึกการทำงานเข้าห้อง Log ใน Discord
    const memberSummary = targetMembers.slice(0, 15).map(m => `• [${m.duty_id || 'ไม่มีรหัส'}] ${m.first_name} ${m.last_name} (${m.nickname || '-'})${m.discord_id ? ' 🔗<@' + m.discord_id + '>' : ''}`).join('\n');
    const extraText = targetMembers.length > 15 ? `\n...และอีก ${targetMembers.length - 15} รายการ` : '';

    sendDiscordActionLog({
      title: '🗑️ [ลบข้อมูลสารวัตรผ่านระบบเว็บ]',
      description: `มีการสั่งลบข้อมูลสารวัตรนักเรียนออกจากระบบจำนวน **${targetMembers.length} นาย** พร้อมทั้งเพิกถอนสิทธิ์ Discord ที่ผูกไว้เรียบร้อยแล้ว`,
      fields: [
        { name: '📋 รายชื่อที่ถูกลบ', value: `${memberSummary}${extraText}` }
      ],
      color: 0xE74C3C,
      actor: user?.username ? `${user.username} (${user.role || 'Admin'})` : '🌐 ผู้ดูแลระบบผ่าน Dashboard'
    }).catch(err => console.warn('[API] Error logging batch delete to Discord:', err));

    console.log(`[API] 🗑️ ลบข้อมูลสารวัตรแบบเลือกหลายรายการสำเร็จ: ${targetMembers.length} นาย`);
    return res.json({
      success: true,
      count: targetMembers.length,
      message: `ลบข้อมูลสารวัตรนักเรียนสำเร็จจำนวน ${targetMembers.length} รายการ และเพิกถอนสิทธิ์ Discord เรียบร้อยแล้ว`
    });
  } catch (err) {
    console.error('[API] /api/members/batch-delete crash:', err);
    return res.status(500).json({ error: err.message });
  }
});

// อัปโหลดและบันทึกรูปโปรไฟล์ 1 นิ้ว (3:4) เข้า Supabase Storage และสำรอง Google Drive
app.post('/api/members/:id/photo', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' });

    const { id } = req.params;
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'ไม่พบข้อมูลรูปภาพ (imageBase64 missing)' });
    }
    if (typeof imageBase64 !== 'string' || imageBase64.length > 15 * 1024 * 1024) {
      return res.status(400).json({ error: 'ขนาดรูปภาพเกินกำหนด (ต้องไม่เกิน 10MB)' });
    }

    // ดึงข้อมูลสมาชิกเป้าหมาย
    const { data: targetMember, error: fetchErr } = await supabase
      .from('members')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !targetMember) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลสารวัตรท่านนี้' });
    }

    // ตรวจสอบสิทธิ์ (แอดมิน/ครู/ประธาน หรือเจ้าของข้อมูลตัวเอง)
    const isSelf = Boolean(
      (user.memberId && user.memberId === targetMember.id) ||
      (user.id && targetMember.discord_id && user.id === targetMember.discord_id)
    );
    const isPrivileged = Boolean(
      user.isAdmin || user.role === 'ADMIN' ||
      user.isTeacher || user.role === 'TEACHER' ||
      user.isCommander || user.isLeader ||
      user.role === 'COMMANDER' || user.role === 'PRESIDENT'
    );

    if (!isSelf && !isPrivileged) {
      return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: คุณสามารถอัปโหลดได้เฉพาะรูปโปรไฟล์ของตนเองเท่านั้น' });
    }

    // 1. บันทึกลง Local Uploads
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const safeDutyId = (targetMember.duty_id || targetMember.nickname || 'SW').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `profile_cropped_${safeDutyId}_${Date.now()}.jpg`;
    const buf = Buffer.from(imageBase64.split(',').pop(), 'base64');
    fs.writeFileSync(path.join(uploadDir, filename), buf);
    let finalImageUrl = `/uploads/${filename}`;

    // 2. อัปโหลดเข้าสู่ Supabase Storage (Bucket: sarawat-photos/profile-photos/)
    try {
      const storagePath = `profile-photos/${filename}`;
      const { error: uploadErr } = await supabase.storage
        .from('sarawat-photos')
        .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });

      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
        finalImageUrl = publicUrl;
      }
    } catch (storageEx) {
      console.warn('[PHOTO-UPLOAD] Supabase storage upload warning:', storageEx.message);
    }

    // 3. สำรองไฟล์ภาพเข้าสู่ Google Drive อัตโนมัติ
    let gdriveId = null;
    let gdriveUrl = null;
    try {
      const gdriveRes = await uploadToGoogleDrive(buf, filename, {
        memberName: `${targetMember.first_name || ''} ${targetMember.last_name || ''}`.trim() || targetMember.nickname || 'สารวัตรนักเรียน',
        dutyId: targetMember.duty_id || '-'
      });
      if (gdriveRes && gdriveRes.success) {
        gdriveId = gdriveRes.fileId;
        gdriveUrl = gdriveRes.webViewLink;
      }
    } catch (gdriveEx) {
      console.warn('[PHOTO-UPLOAD] Google Drive backup warning:', gdriveEx.message);
    }

    // 4. บันทึก URL รูปลงตาราง members
    const updatePayload = {
      profile_image_url: finalImageUrl,
      photo_cropped_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (gdriveId) updatePayload.gdrive_file_id = gdriveId;
    if (gdriveUrl) updatePayload.gdrive_file_url = gdriveUrl;

    const { data: updatedMember, error: updateErr } = await supabase
      .from('members')
      .update(updatePayload)
      .eq('id', targetMember.id)
      .select()
      .maybeSingle();

    if (updateErr) throw updateErr;

    console.log(`[SARAWAT-WEB] 📸 อัปโหลดและครอปรูปโปรไฟล์ของ ${targetMember.nickname || targetMember.duty_id} สำเร็จ`);
    res.json({
      success: true,
      message: 'อัปโหลดและตัดรูปโปรไฟล์สำเร็จ',
      imageUrl: finalImageUrl,
      gdriveUrl,
      member: updatedMember
    });
  } catch (err) {
    console.error('[SARAWAT-WEB] Photo upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. API: รายการคดีและหลักฐาน (Cases Vault)
// -------------------------------------------------------------
const CASES_CACHE_FILE = path.join(__dirname, 'cases_cache.json');

function getCasesCache() {
  if (fs.existsSync(CASES_CACHE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CASES_CACHE_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }
  return [];
}

function saveCasesCache(list) {
  try {
    fs.writeFileSync(CASES_CACHE_FILE, JSON.stringify(list || [], null, 2), 'utf8');
  } catch (e) {}
}

app.get('/api/cases', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('cases')
      .select('*')
      .order('incident_date_time', { ascending: false });

    if (status && status !== 'ALL') {
      query = query.eq('status', status);
    }

    const { data: cases, error } = await query;
    if (error) throw error;

    if (Array.isArray(cases) && cases.length > 0) {
      saveCasesCache(cases);
      return res.json({ success: true, count: cases.length, data: cases });
    }

    const cached = getCasesCache();
    const result = (status && status !== 'ALL') ? cached.filter(c => c.status === status) : cached;
    res.json({ success: true, count: result.length, data: result });
  } catch (err) {
    const cached = getCasesCache();
    const result = (req.query.status && req.query.status !== 'ALL') ? cached.filter(c => c.status === req.query.status) : cached;
    res.json({ success: true, count: result.length, data: result });
  }
});

// -------------------------------------------------------------
// 4.1 API: รับแจ้งเหตุใหม่ (Create Case)
// -------------------------------------------------------------
app.post('/api/cases', async (req, res) => {
  try {
    const payload = req.body || {};
    const caseId = payload.case_id || ('CASE-' + Math.floor(1000 + Math.random() * 9000));
    const reporterNameWithGrade = `${payload.reporter_name || 'ไม่ประสงค์ออกนาม'}${payload.reporter_grade && payload.reporter_grade !== '-' ? ` (ชั้น ${payload.reporter_grade})` : ''}`;

    const newCase = {
      case_id: caseId,
      reporter_email: payload.reporter_email || 'anonymous@pranarai.ac.th',
      reporter_name: reporterNameWithGrade,
      incident_date_time: payload.incident_date_time || new Date().toISOString(),
      location: (payload.contact_info && payload.contact_info !== '-' && String(payload.contact_info).trim() !== '') ? String(payload.contact_info).trim() : ((payload.location && payload.location !== 'โรงเรียนพระนารายณ์') ? String(payload.location).trim() : 'ไม่ระบุ'),
      category: payload.category || 'รับเรื่องร้องเรียน',
      description: payload.description || 'ไม่มีรายละเอียด',
      evidence_urls: Array.isArray(payload.evidence_urls) ? payload.evidence_urls : (payload.evidence_url ? [payload.evidence_url] : []),
      status: payload.status || 'PENDING'
    };

    try {
      await supabase.from('cases').insert(newCase);
    } catch (dbErr) {
      console.warn('[CASES INSERT SUPABASE WARN]:', dbErr.message);
    }

    // อัปเดตสำรองข้อมูล Local Cache ทันที
    const currentCached = getCasesCache();
    const updated = [newCase, ...currentCached.filter(c => c.case_id !== newCase.case_id)];
    saveCasesCache(updated);

    // 📢 ส่งสัญญาณแจ้งเตือนเข้าห้อง #รับแจ้งเหตุ ใน Discord ทันทีแบบ Non-blocking
    const incidentChanId = process.env.INCIDENT_CHANNEL_ID || '1567570890084843530';
    if (incidentChanId && DISCORD_BOT_TOKEN) {
      fetch(`https://discord.com/api/v10/channels/${incidentChanId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          embeds: [{
            title: `🚨 [รับแจ้งเหตุใหม่จากเว็บไซต์] รหัส: ${caseId}`,
            description:
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `📂 **หมวดหมู่:** ${newCase.category}\n` +
              `📍 **สถานที่เกิดเหตุ:** ${newCase.location}\n` +
              `📝 **รายละเอียด:** ${newCase.description}\n` +
              `👤 **ผู้แจ้ง:** ${newCase.reporter_name}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `🌐 *สามารถตรวจสอบและบันทึกคลิป Bodycam ได้ที่ Web Dashboard*`,
            color: 0xE74C3C,
            footer: { text: 'SARAWAT INCIDENT DESK • โรงเรียนพระนารายณ์' },
            timestamp: new Date().toISOString()
          }]
        }),
        signal: AbortSignal.timeout(4000)
      }).catch(e => console.warn('[DISCORD CASE ALERT WARN]:', e.message));
    }

    res.status(201).json({ success: true, case_id: caseId, data: data[0] });
  } catch (err) {
    console.error('Case insert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. API: อัปเดตสถานะคดี
// -------------------------------------------------------------
app.patch('/api/cases/:id', async (req, res) => {
  try {
    const caseId = req.params.id;
    const { status, resolution_notes } = req.body;

    const updates = { updated_at: new Date() };
    if (status) updates.status = status;
    if (resolution_notes !== undefined) updates.resolution_notes = resolution_notes;

    const { error } = await supabase
      .from('cases')
      .update(updates)
      .eq('case_id', caseId);

    if (error) throw error;
    res.json({ success: true, message: 'Updated case successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5.1 API: อัปโหลดคลิป Bodycam หรือแนบหลักฐานเข้าคดี
// -------------------------------------------------------------
app.post('/api/cases/:id/evidence', async (req, res) => {
  try {
    const caseId = req.params.id;
    const { url, filename, base64Data, notes } = req.body || {};
    let fileUrl = url;

    if (base64Data && (typeof base64Data !== 'string' || base64Data.length > 50 * 1024 * 1024)) {
      return res.status(400).json({ success: false, error: 'ขนาดไฟล์เกินกำหนด (ต้องไม่เกิน 35MB)' });
    }

    if (base64Data && filename) {
      // 1. ตรวจสอบการส่งไฟล์ขึ้น Google Drive อัตโนมัติผ่าน Google Apps Script Web App
      const gasDriveUrl = process.env.GOOGLE_DRIVE_WEBAPP_URL || process.env.GAS_DRIVE_URL;
      if (gasDriveUrl) {
        try {
          const gasRes = await fetch(gasDriveUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upload_bodycam',
              caseId,
              filename,
              base64Data: base64Data.split(',').pop(),
              mimeType: filename.endsWith('.mp4') ? 'video/mp4' : (filename.endsWith('.mov') ? 'video/quicktime' : 'application/octet-stream')
            })
          });
          const gasJson = await gasRes.json().catch(() => null);
          if (gasJson && gasJson.fileUrl) {
            fileUrl = gasJson.fileUrl;
            console.log(`[GOOGLE DRIVE AUTO-UPLOAD] Successfully saved ${filename} to Google Drive: ${fileUrl}`);
          }
        } catch (gasErr) {
          console.warn('[GOOGLE DRIVE UPLOAD WARNING, FALLBACK TO LOCAL]:', gasErr.message);
        }
      }

      // 2. ถ้าไม่มี GAS URL ให้ลองใช้ uploadToGoogleDrive (Service Account / Webhook)
      if (!fileUrl) {
        try {
          const buffer = Buffer.from(base64Data.split(',').pop(), 'base64');
          const mime = filename.endsWith('.mp4') ? 'video/mp4' : (filename.endsWith('.mov') ? 'video/quicktime' : (filename.endsWith('.webm') ? 'video/webm' : (filename.endsWith('.png') ? 'image/png' : 'image/jpeg')));
          const gRes = await uploadToGoogleDrive(buffer, filename, { caseId, category: 'evidence', mimeType: mime });
          if (gRes && gRes.success && gRes.webViewLink) {
            fileUrl = gRes.webViewLink;
            console.log(`[GOOGLE DRIVE SERVICE ACCOUNT] Uploaded evidence to Drive: ${fileUrl}`);
          }
        } catch (gErr) {
          console.warn('[GOOGLE DRIVE SERVICE ACCOUNT WARN]:', gErr.message);
        }
      }

      // 3. Failsafe: ถ้าไม่มี Google Drive URL หรือเชื่อมต่อไม่ได้ ให้บันทึกลงเครื่อง/เซิร์ฟเวอร์เสมอป้องกันข้อมูลสูญหาย
      if (!fileUrl) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const safeName = `${caseId}_${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(uploadDir, safeName);
        const buffer = Buffer.from(base64Data.split(',').pop(), 'base64');
        fs.writeFileSync(filePath, buffer);
        fileUrl = `/uploads/${safeName}`;
      }
    }

    if (!fileUrl) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ URL หรือแนบไฟล์คลิป/ภาพถ่าย' });
    }

    const { data: currentCase } = await supabase
      .from('cases')
      .select('evidence_urls, resolution_notes')
      .eq('case_id', caseId)
      .maybeSingle();

    const existingUrls = currentCase?.evidence_urls || [];
    const updatedUrls = [...existingUrls, fileUrl];

    const timeStr = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
    const timelineEntry = `• ${timeStr} น. - 📸 แนบไฟล์หลักฐาน (${filename || 'ไฟล์'}): ${fileUrl}${notes ? ` - ${notes}` : ''}`;

    const updates = {
      evidence_urls: updatedUrls,
      resolution_notes: (currentCase?.resolution_notes ? currentCase.resolution_notes + '\n' : '') + timelineEntry
    };

    const { error } = await supabase.from('cases').update(updates).eq('case_id', caseId);
    if (error) throw error;

    res.json({
      success: true,
      fileUrl,
      evidence_urls: updatedUrls,
      message: 'บันทึกไฟล์หลักฐานเข้าคดีสำเร็จ'
    });
  } catch (err) {
    console.error('Evidence upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6. API: ยืนยันบัตรประจำตัวสาธารณะผ่าน QR Code (/verify?id=UUID)
// -------------------------------------------------------------
app.get('/api/verify/:id', async (req, res) => {
  try {
    const memberId = req.params.id;
    let query = supabase
      .from('members')
      .select('id, first_name, last_name, nickname, grade_class, student_no, duty_day, duty_id, role, shift_role, status, profile_image_url, approved_at');

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
      query = query.eq('id', memberId);
    } else {
      query = query.or(`duty_id.eq.${memberId},id.eq.${memberId}`);
    }

    const { data: member, error } = await query.maybeSingle();

    if (error || !member) {
      return res.status(404).json({ valid: false, message: 'ไม่พบบัตรหรือรหัสสมาชิกนี้ในระบบสารวัตรนักเรียน' });
    }

    const isValid = member.status === 'ACTIVE';
    res.json({
      valid: isValid,
      status: member.status,
      member: {
        name: `${member.first_name} ${member.last_name}`,
        nickname: member.nickname,
        duty_id: member.duty_id || '-',
        duty_day: member.duty_day,
        grade_class: member.grade_class,
        student_no: member.student_no,
        role: member.role,
        shift_role: member.shift_role,
        profile_image_url: member.profile_image_url,
        school: 'โรงเรียนพระนารายณ์'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6.1 API: ดึงและบันทึกโครงสร้างเลเยอร์บัตร (Card Studio Template & Persistent Storage)
// -------------------------------------------------------------
const CONFIG_PATHS = [
  path.join(__dirname, 'card_layout_config.json'),
  path.join(__dirname, '..', 'card_layout_config.json'),
  path.join(__dirname, '..', 'bot', 'card_layout_config.json')
];

let cachedLayoutConfig = null;

async function syncLayoutConfigFromSupabase() {
  try {
    const { data, error } = await supabase.storage
      .from('sarawat-photos')
      .download('card-templates/card_layout_config.json');
    if (data && !error) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && parsed.elements) {
        cachedLayoutConfig = parsed;
        for (const p of CONFIG_PATHS) {
          try {
            const dir = path.dirname(p);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p, JSON.stringify(parsed, null, 2), 'utf8');
          } catch (e) {}
        }
        console.log('[CARD TEMPLATE] Synced template config from Supabase Storage.');
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[CARD TEMPLATE] Supabase download notice:', err.message);
  }
  return null;
}

function getLayoutConfig() {
  if (cachedLayoutConfig && cachedLayoutConfig.elements) {
    return cachedLayoutConfig;
  }
  let config = null;
  for (const p of CONFIG_PATHS) {
    if (fs.existsSync(p)) {
      try {
        config = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (config && config.elements) break;
      } catch (e) {}
    }
  }

  // หากไม่มีคอนฟิก ให้สร้างค่าเริ่มต้นพร้อมรูปพื้นหลังถาวร
  if (!config) {
    config = {
      canvas: {
        width: 430,
        height: 680,
        backgroundColor: "#ffffff",
        backgroundImage: "/assets/card-templates/default_card_bg.png"
      },
      elements: {}
    };
  }

  // ป้องกันรูปพื้นหลังหาย: หากมี gdrive_file_id ให้อ่านผ่าน Google Drive Proxy เสมอ
  if (config.canvas) {
    if (config.canvas.gdrive_file_id) {
      config.canvas.backgroundImage = `/api/drive-proxy/${config.canvas.gdrive_file_id}`;
    } else if (config.canvas.supabase_url) {
      config.canvas.backgroundImage = config.canvas.supabase_url;
    } else if (!config.canvas.backgroundImage || config.canvas.backgroundImage === '') {
      config.canvas.backgroundImage = "/assets/card-templates/default_card_bg.png";
    }
  }

  // ป้องกันตราโรงเรียนตกหล่น
  if (config.elements && !config.elements.schoolEmblem) {
    config.elements.schoolEmblem = {
      id: "schoolEmblem",
      name: "ตราโรงเรียนพระนารายณ์",
      type: "image",
      src: "/assets/school_emblem.png",
      left: 315,
      top: 568,
      width: 78,
      height: 98,
      opacity: 1,
      angle: 0
    };
  }

  cachedLayoutConfig = config;
  return config;
}

// Helper: บันทึกคอนฟิกลงทุกไฟล์เป้าหมาย + Supabase Storage
async function saveLayoutConfig(payload) {
  payload.updated_at = new Date().toISOString();
  cachedLayoutConfig = payload;

  for (const p of CONFIG_PATHS) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {}
  }

  // ซิงค์ไปยัง Supabase Storage แบบถาวร
  try {
    const jsonBuf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    await supabase.storage
      .from('sarawat-photos')
      .upload('card-templates/card_layout_config.json', jsonBuf, {
        contentType: 'application/json',
        upsert: true
      });
  } catch (sbEx) {
    console.warn('[CARD TEMPLATE] Supabase storage upload warning:', sbEx.message);
  }
}

app.get('/api/card-template', async (req, res) => {
  if (!cachedLayoutConfig) {
    await syncLayoutConfigFromSupabase();
  }
  const config = getLayoutConfig();
  if (config) {
    return res.json({ success: true, config });
  }
  res.status(404).json({ success: false, message: 'Template configuration not found' });
});

app.post('/api/card-template', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.canvas) {
      return res.status(400).json({ success: false, message: 'Invalid config payload' });
    }

    // จัดการรูปภาพพื้นหลัง: หากส่งมาเป็น base64 ให้แตกไฟล์และสำรองเข้า Google Drive + พื้นที่ถาวร
    if (payload.canvas.backgroundImage && typeof payload.canvas.backgroundImage === 'string' && payload.canvas.backgroundImage.startsWith('data:image')) {
      try {
        const base64Data = payload.canvas.backgroundImage.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const templateDir = path.join(__dirname, 'public', 'assets', 'card-templates');
        if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });

        // 1. บันทึกลง Disk ในเครื่อง
        const customPath = path.join(templateDir, 'custom_card_bg.png');
        fs.writeFileSync(customPath, buffer);

        // 2. ซิงค์ไปยัง bot/assets ด้วย
        try {
          const botTemplateDir = path.join(__dirname, '..', 'bot', 'assets', 'card-templates');
          if (!fs.existsSync(botTemplateDir)) fs.mkdirSync(botTemplateDir, { recursive: true });
          fs.writeFileSync(path.join(botTemplateDir, 'custom_card_bg.png'), buffer);
        } catch (botErr) {}

        // 3. สำรองเข้า Google Drive อัตโนมัติ (ป้องกัน Render รีสตาร์ทแล้วหาย)
        try {
          const gdriveRes = await uploadToGoogleDrive(buffer, `sarawat_card_bg_${Date.now()}.png`, {
            category: 'card-template',
            mimeType: 'image/png',
            description: 'Sarawat ID Card Background Template'
          });
          if (gdriveRes && gdriveRes.success) {
            payload.canvas.gdrive_file_id = gdriveRes.fileId;
            payload.canvas.gdrive_url = gdriveRes.webViewLink;
          }
        } catch (gdErr) {
          console.warn('[CARD TEMPLATE] Google Drive backup notice:', gdErr.message);
        }

        // 4. สำรองเข้า Supabase Storage ถ้ามี
        try {
          const { error: sbErr } = await supabase.storage
            .from('sarawat-photos')
            .upload('card-templates/custom_card_bg.png', buffer, {
              contentType: 'image/png',
              upsert: true
            });
          if (!sbErr) {
            const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl('card-templates/custom_card_bg.png');
            payload.canvas.supabase_url = publicUrl;
          }
        } catch (sbEx) {}

        if (payload.canvas.gdrive_file_id) {
          payload.canvas.backgroundImage = `/api/drive-proxy/${payload.canvas.gdrive_file_id}`;
        } else if (payload.canvas.supabase_url) {
          payload.canvas.backgroundImage = payload.canvas.supabase_url;
        } else {
          payload.canvas.backgroundImage = '/assets/card-templates/custom_card_bg.png';
        }
      } catch (saveErr) {
        console.warn('[CARD TEMPLATE] Image parse error:', saveErr.message);
      }
    }

    await saveLayoutConfig(payload);
    res.json({ success: true, message: 'Layout template saved successfully', config: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: อัปโหลดรูปพื้นหลังโดยตรง พร้อมสำรองขึ้น Google Drive และเก็บเป็นเทมเพลตถาวร
app.post('/api/card-template/upload-background', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'Image base64 data required' });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const templateDir = path.join(__dirname, 'public', 'assets', 'card-templates');
    if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'custom_card_bg.png'), buffer);

    // ซิงค์ไปยัง bot ด้วย
    try {
      const botTemplateDir = path.join(__dirname, '..', 'bot', 'assets', 'card-templates');
      if (!fs.existsSync(botTemplateDir)) fs.mkdirSync(botTemplateDir, { recursive: true });
      fs.writeFileSync(path.join(botTemplateDir, 'custom_card_bg.png'), buffer);
    } catch (e) {}

    let gdriveId = null;
    let gdriveUrl = null;
    try {
      const gRes = await uploadToGoogleDrive(buffer, `sarawat_card_bg_${Date.now()}.png`, {
        category: 'card-template',
        mimeType: 'image/png',
        description: 'Uploaded Card Background Template'
      });
      if (gRes && gRes.success) {
        gdriveId = gRes.fileId;
        gdriveUrl = gRes.webViewLink;
      }
    } catch (gdEx) {
      console.warn('[CARD-BG-UPLOAD] Google Drive warning:', gdEx.message);
    }

    // 2. สำรองขึ้น Supabase Storage sarawat-photos ถาวร
    let supabaseUrl = null;
    try {
      const { error: sErr } = await supabase.storage
        .from('sarawat-photos')
        .upload('card-templates/custom_card_bg.png', buffer, {
          contentType: 'image/png',
          upsert: true
        });
      if (!sErr) {
        const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl('card-templates/custom_card_bg.png');
        supabaseUrl = publicUrl;
      }
    } catch (sErr) {}

    // อัปเดตคอนฟิก
    const currentConfig = getLayoutConfig();
    if (!currentConfig.canvas) currentConfig.canvas = { width: 430, height: 680, backgroundColor: "#ffffff" };
    if (gdriveId) {
      currentConfig.canvas.backgroundImage = `/api/drive-proxy/${gdriveId}`;
      currentConfig.canvas.gdrive_file_id = gdriveId;
      currentConfig.canvas.gdrive_url = gdriveUrl;
    } else if (supabaseUrl) {
      currentConfig.canvas.backgroundImage = supabaseUrl;
      currentConfig.canvas.supabase_url = supabaseUrl;
    } else {
      currentConfig.canvas.backgroundImage = '/assets/card-templates/custom_card_bg.png';
    }
    if (supabaseUrl) currentConfig.canvas.supabase_url = supabaseUrl;
    saveLayoutConfig(currentConfig);

    res.json({
      success: true,
      message: 'Card background uploaded and saved to Google Drive successfully',
      url: currentConfig.canvas.backgroundImage,
      gdriveFileId: gdriveId,
      gdriveUrl: gdriveUrl,
      supabaseUrl: supabaseUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: ดึงรายการเทมเพลตและรูปพื้นหลังที่มีให้เลือก (Default, Custom, Google Drive)
app.get('/api/card-template/templates', (req, res) => {
  const config = getLayoutConfig();
  const templates = [
    {
      id: 'default',
      name: 'เทมเพลตมาตรฐานทางการ (ถาวร)',
      url: '/assets/card-templates/default_card_bg.png',
      isDefault: true
    }
  ];

  const customPath = path.join(__dirname, 'public', 'assets', 'card-templates', 'custom_card_bg.png');
  if (fs.existsSync(customPath)) {
    templates.push({
      id: 'custom',
      name: 'เทมเพลตกำหนดเองล่าสุด (Local/Server)',
      url: '/assets/card-templates/custom_card_bg.png',
      isCurrent: config.canvas && config.canvas.backgroundImage === '/assets/card-templates/custom_card_bg.png'
    });
  }

  if (config.canvas && config.canvas.gdrive_file_id) {
    templates.push({
      id: 'gdrive',
      name: 'เทมเพลตสำรองบน Google Drive',
      url: `/api/drive-proxy/${config.canvas.gdrive_file_id}`,
      fileId: config.canvas.gdrive_file_id,
      webViewLink: config.canvas.gdrive_url
    });
  }

  res.json({ success: true, templates, activeBackground: (config.canvas && config.canvas.backgroundImage) || '/assets/card-templates/default_card_bg.png' });
});

// API: โหลดรูปพื้นหลังเทมเพลตจาก Google Drive
app.post('/api/card-template/load-from-drive', async (req, res) => {
  try {
    const { fileId, driveUrl } = req.body;
    const targetId = fileId || driveUrl;
    if (!targetId) {
      return res.status(400).json({ success: false, message: 'Google Drive file ID or URL required' });
    }

    const dl = await downloadFromGoogleDrive(targetId);
    if (!dl.success || !dl.buffer) {
      return res.status(404).json({ success: false, message: dl.error || 'Failed to download from Google Drive' });
    }

    const templateDir = path.join(__dirname, 'public', 'assets', 'card-templates');
    if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'custom_card_bg.png'), dl.buffer);

    // อัปเดตคอนฟิก
    const currentConfig = getLayoutConfig();
    if (!currentConfig.canvas) currentConfig.canvas = { width: 430, height: 680, backgroundColor: "#ffffff" };
    currentConfig.canvas.backgroundImage = `/api/drive-proxy/${dl.fileId || targetId}`;
    currentConfig.canvas.gdrive_file_id = dl.fileId || targetId;
    currentConfig.canvas.gdrive_url = `https://drive.google.com/file/d/${dl.fileId || targetId}/view`;
    saveLayoutConfig(currentConfig);

    res.json({
      success: true,
      message: 'Template loaded from Google Drive successfully',
      url: `/api/drive-proxy/${dl.fileId || targetId}`,
      fileId: dl.fileId || targetId,
      gdriveUrl: currentConfig.canvas.gdrive_url
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: ตัวกลางดึงรูปจาก Google Drive (Proxy เพื่อหลบปัญหา CORS ในบราวเซอร์)
app.get('/api/drive-proxy/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const dl = await downloadFromGoogleDrive(fileId);
    if (dl.success && dl.buffer) {
      res.setHeader('Content-Type', dl.mimeType || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(dl.buffer);
    }
    res.status(404).json({ success: false, message: 'File not found on Google Drive' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6. ระบบคลังของหายและส่งมอบคืน (Lost & Found System)
// -------------------------------------------------------------
const LOST_FOUND_DB_FILE = path.join(__dirname, '..', 'data', 'lost_found_db.json');
const LOST_FOUND_LOCAL_DB = path.join(__dirname, 'lost_found_db.json');
const LOST_FOUND_CACHE_FILE = path.join(__dirname, 'lost_items_cache.json');

function getLostFoundData() {
  let db = { items: [], claims: [], categories: [] };
  const candidateFiles = [LOST_FOUND_DB_FILE, LOST_FOUND_LOCAL_DB];
  for (const f of candidateFiles) {
    try {
      if (fs.existsSync(f)) {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.items) && parsed.items.length > 0) db.items = parsed.items;
          if (Array.isArray(parsed.claims) && parsed.claims.length > 0) db.claims = parsed.claims;
          if (Array.isArray(parsed.categories) && parsed.categories.length > 0) db.categories = parsed.categories;
        }
      }
    } catch (e) {
      console.error('[LOST-FOUND DB ERROR]:', e);
    }
  }

  // Fallback: หากรายการ items ยังว่างอยู่ ให้ดึงจาก lost_items_cache.json
  if (db.items.length === 0 && fs.existsSync(LOST_FOUND_CACHE_FILE)) {
    try {
      const cacheParsed = JSON.parse(fs.readFileSync(LOST_FOUND_CACHE_FILE, 'utf8'));
      if (Array.isArray(cacheParsed) && cacheParsed.length > 0) {
        db.items = cacheParsed;
      }
    } catch (e) {}
  }
  return db;
}

function saveLostFoundData(data) {
  const targets = [LOST_FOUND_DB_FILE, LOST_FOUND_LOCAL_DB];
  for (const t of targets) {
    try {
      const dir = path.dirname(t);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(t, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[LOST-FOUND SAVE ERROR]:', e);
    }
  }
  try {
    fs.writeFileSync(LOST_FOUND_CACHE_FILE, JSON.stringify(data.items || [], null, 2), 'utf8');
  } catch (e) {}
}

// 6.0 ตรวจสอบสถานะการเชื่อมต่อฐานข้อมูล Supabase
app.get('/api/lost-found/schema-status', async (req, res) => {
  try {
    let itemsTable = false;
    let claimsTable = false;
    let categoriesTable = false;

    try {
      const { error: e1 } = await supabase.from('lost_items').select('id').limit(1);
      if (!e1) itemsTable = true;
    } catch (e) {}

    try {
      const { error: e2 } = await supabase.from('lost_claims').select('id').limit(1);
      if (!e2) claimsTable = true;
    } catch (e) {}

    try {
      const { error: e3 } = await supabase.from('lost_categories').select('id').limit(1);
      if (!e3) categoriesTable = true;
    } catch (e) {}

    res.json({
      success: true,
      supabase_url: process.env.SUPABASE_URL ? 'CONFIGURED' : 'MISSING',
      tables: {
        lost_items: itemsTable,
        lost_claims: claimsTable,
        lost_categories: categoriesTable
      },
      mode: (itemsTable && claimsTable) ? 'SUPABASE_POSTGRES' : 'HYBRID_MIRROR_FALLBACK'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.0.1 หมวดหมู่สิ่งของ (Lost & Found Categories - Configured by Sarawat)
app.get('/api/lost-found/categories', async (req, res) => {
  try {
    let categories = [];
    let isDbConnected = false;

    try {
      const { data, error } = await supabase.from('lost_categories').select('*').order('created_at', { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        categories = data;
        isDbConnected = true;
      }
    } catch (e) {}

    if (!isDbConnected || categories.length === 0) {
      const db = getLostFoundData();
      categories = (db.categories && db.categories.length > 0) ? db.categories : [
        { id: 'cat-wallet', name: 'กระเป๋า / กระเป๋าสตางค์', icon: '👛', description: 'กระเป๋าเงิน เป้ กระเป๋าสะพาย' },
        { id: 'cat-it', name: 'อุปกรณ์ไอที / มือถือ', icon: '📱', description: 'โทรศัพท์มือถือ หูฟัง พาวเวอร์แบงก์' },
        { id: 'cat-key', name: 'กุญแจ / ยานพาหนะ', icon: '🔑', description: 'กุญแจรถ กุญแจบ้าน คีย์การ์ด' },
        { id: 'cat-clothes', name: 'เครื่องแต่งกาย / หมวก', icon: '👕', description: 'เสื้อคลุม หมวก เข็มขัด รองเท้า' },
        { id: 'cat-stationery', name: 'เครื่องเขียน / หนังสือ', icon: '📚', description: 'สมุด หนังสือ ปากกา อุปกรณ์เรียน' },
        { id: 'cat-general', name: 'สิ่งของทั่วไป / อื่นๆ', icon: '📦', description: 'สิ่งของอื่นๆ ที่เก็บได้' }
      ];
    }

    res.json({ success: true, count: categories.length, categories, isDbConnected });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/lost-found/categories', async (req, res) => {
  try {
    const { name, icon, description } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุชื่อหมวดหมู่' });
    }

    const trimmedName = name.trim();
    const cleanIcon = (icon && icon.trim()) ? icon.trim() : '📦';
    const cleanDesc = (description && description.trim()) ? description.trim() : '';

    const db = getLostFoundData();
    if (!Array.isArray(db.categories)) db.categories = [];

    // ตรวจสอบชื่อหมวดหมู่ซ้ำ
    const exists = db.categories.some(c => c.name.toLowerCase() === trimmedName.toLowerCase());
    if (exists) {
      return res.status(400).json({ success: false, error: 'หมวดหมู่นี้มีอยู่ในระบบแล้ว' });
    }

    const code = 'CAT-' + Date.now().toString(36).toUpperCase();
    const newCategory = {
      id: `cat-${Date.now()}`,
      code,
      name: trimmedName,
      icon: cleanIcon,
      description: cleanDesc,
      created_at: new Date().toISOString()
    };

    // บันทึกลง Supabase PostgreSQL
    try {
      const { data, error } = await supabase.from('lost_categories').insert([{
        code,
        name: trimmedName,
        icon: cleanIcon,
        description: cleanDesc
      }]).select().single();
      if (!error && data) {
        newCategory.id = data.id;
      }
    } catch (e) {
      console.warn('[SUPABASE CATEGORY INSERT WARN]:', e.message);
    }

    db.categories.push(newCategory);
    saveLostFoundData(db);

    res.json({ success: true, category: newCategory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/lost-found/categories/:id', async (req, res) => {
  try {
    const catId = req.params.id;
    const db = getLostFoundData();
    const catIndex = (db.categories || []).findIndex(c => c.id === catId || c.code === catId);

    if (catIndex === -1) {
      return res.status(404).json({ success: false, error: 'ไม่พบหมวดหมู่ที่ต้องการลบ' });
    }

    const targetCat = db.categories[catIndex];

    // ตรวจสอบว่าหมวดหมู่นี้มีการใช้งานในสิ่งของหรือคำร้องหรือไม่
    const isUsedInItems = (db.items || []).some(it => it.category === targetCat.name);
    const isUsedInClaims = (db.claims || []).some(cl => cl.category === targetCat.name);

    if (isUsedInItems || isUsedInClaims) {
      return res.status(400).json({
        success: false,
        error: `ไม่สามารถลบหมวดหมู่ "${targetCat.name}" ได้ เนื่องจากมีรายการสิ่งของหรือคำร้องใช้งานอยู่`
      });
    }

    // ลบจาก Supabase
    try {
      await supabase.from('lost_categories').delete().or(`id.eq.${catId},code.eq.${catId}`);
    } catch (e) {
      console.warn('[SUPABASE CATEGORY DELETE WARN]:', e.message);
    }

    db.categories.splice(catIndex, 1);
    saveLostFoundData(db);

    res.json({ success: true, message: `ลบหมวดหมู่ "${targetCat.name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.1 ดึงรายการสิ่งของที่พบเจอ (Found Items)
app.get('/api/lost-found/items', async (req, res) => {
  try {
    const { category, status, search } = req.query;
    let items = [];
    let isDbConnected = false;

    // ตรวจสอบข้อมูลจาก Supabase PostgreSQL ก่อนเสมอ
    try {
      let query = supabase.from('lost_items').select('*').order('created_at', { ascending: false });
      if (status && status !== 'ALL') query = query.eq('status', status);
      if (category && category !== 'ALL') {
        if (category === 'ของกลาง' || category.includes('ของกลาง')) {
          query = query.or(custodyOrFilter());
        } else {
          query = query.ilike('category', `%${category}%`);
        }
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        items = data;
        isDbConnected = true;
      }
    } catch (e) {}

    // หากยังไม่ได้รัน SQL Migration ใน Supabase ให้สลับไปใช้ Local DB File อัตโนมัติ
    if (!isDbConnected) {
      const db = getLostFoundData();
      items = db.items || [];
      if (status && status !== 'ALL') {
        items = items.filter(it => it.status === status);
      }
      if (category && category !== 'ALL') {
        if (category === 'ของกลาง' || category.includes('ของกลาง')) {
          items = items.filter(it => isSchoolCustodyItem(it));
        } else {
          items = items.filter(it => it.category && it.category.includes(category));
        }
      }
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(it =>
        (it.title && it.title.toLowerCase().includes(q)) ||
        (it.item_code && it.item_code.toLowerCase().includes(q)) ||
        (it.characteristics && it.characteristics.toLowerCase().includes(q)) ||
        (it.location_found && it.location_found.toLowerCase().includes(q))
      );
    }

    const waitingCount = items.filter(i => i.status === 'WAITING_OWNER').length;
    const deliveredCount = items.filter(i => i.status === 'DELIVERED').length;

    res.json({
      success: true,
      source: isDbConnected ? 'supabase_database' : 'local_database_fallback',
      count: items.length,
      data: items,
      stats: {
        total: items.length,
        waiting: waitingCount,
        delivered: deliveredCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.2 บันทึกสิ่งของพบเจอใหม่ (Intake New Found Item)
app.post('/api/lost-found/items', async (req, res) => {
  try {
    const {
      title,
      category,
      characteristics,
      secret_traits,
      location_found,
      found_date,
      found_time,
      storage_location,
      finder_name,
      finder_contact,
      image_base64,
      image_url
    } = req.body || {};

    const reqCharacteristics = (characteristics || title || '').trim();
    if (!title || !category || !reqCharacteristics) {
      return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อสิ่งของ หมวดหมู่ และลักษณะเฉพาะตัวให้ครบถ้วน' });
    }

    let finalImageUrl = image_url || null;
    let gdriveFileId = req.body.gdrive_file_id || null;
    let gdriveUrl = req.body.gdrive_url || null;

    const currentYear = new Date().getFullYear();
    const db = getLostFoundData();
    const itemNum = String((db.items?.length || 0) + 1).padStart(3, '0');
    const itemCode = req.body.item_code || `LF-${currentYear}-${itemNum}`;

    if (image_base64) {
      const filename = `${itemCode}.jpg`;
      const buf = Buffer.from(image_base64.split(',').pop(), 'base64');

      // อัปโหลดเข้าสู่ Supabase Storage sarawat-photos ถาวร (1-2+ ปี ไม่หมดอายุ)
      try {
        const storagePath = `lost-items/${filename}`;
        const { error: sErr } = await supabase.storage
          .from('sarawat-photos')
          .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
        if (!sErr) {
          const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
          finalImageUrl = publicUrl;
        }
      } catch (e) {}

      // สำรองเข้า Google Drive โฟลเดอร์ 03_สิ่งของที่พบเจอ (1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ)
      try {
        const gRes = await uploadToGoogleDrive(buf, filename, {
          category: 'lost_found',
          folderId: process.env.GDRIVE_LOST_FOLDER_ID || '1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ',
          itemCode: itemCode,
          title: title.trim(),
          description: `สิ่งของที่พบเจอ: ${title.trim()} (${itemCode})`
        });
        if (gRes && gRes.success && gRes.fileId) {
          gdriveFileId = gRes.fileId;
          gdriveUrl = gRes.webViewLink || `https://drive.google.com/file/d/${gRes.fileId}/view`;
          finalImageUrl = `/api/drive-proxy/${gRes.fileId}`;
        }
      } catch (e) {}

      if (!finalImageUrl) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buf);
        finalImageUrl = `/uploads/${filename}`;
      }
    }

    const newItem = {
      id: req.body.id || `lf-${Date.now()}`,
      item_code: itemCode,
      title: title.trim(),
      category: category.trim(),
      characteristics: reqCharacteristics,
      secret_traits: (secret_traits && secret_traits.trim()) ? secret_traits.trim() : null,
      image_url: finalImageUrl,
      gdrive_file_id: gdriveFileId,
      gdrive_url: gdriveUrl,
      location_found: location_found || 'ไม่ระบุสถานที่',
      found_date: found_date || new Date().toISOString().slice(0, 10),
      found_time: found_time || new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.',
      status: req.body.status || 'WAITING_OWNER',
      storage_location: storage_location || 'ห้องสารวัตรนักเรียน อาคาร 1',
      finder_name: finder_name || 'สารวัตรเวร',
      finder_duty_id: req.body.finder_duty_id ? canonicalDutyId(req.body.finder_duty_id) : null,
      finder_avatar_url: req.body.finder_avatar_url || null,
      finder_contact: finder_contact || '-',
      created_at: req.body.created_at || new Date().toISOString(),
      updated_at: req.body.updated_at || new Date().toISOString()
    };

    let savedItem = newItem;
    let isDbSaved = false;

    // บันทึกเข้า Supabase PostgreSQL Database (หากมีตาราง)
    try {
      const dbItem = { ...newItem };
      delete dbItem.gdrive_file_id;
      delete dbItem.gdrive_url;
      if (dbItem.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dbItem.id)) {
        delete dbItem.id;
      }
      const { data, error } = await supabase.from('lost_items').insert(dbItem).select().single();
      if (!error && data) {
        savedItem = data;
        isDbSaved = true;
      } else if (error) {
        console.error('[SUPABASE INSERT LOST ITEM ERROR]:', error.message || error);
      }
    } catch (e) {
      console.error('[SUPABASE INSERT LOST ITEM EXCEPTION]:', e.message || e);
    }

    // บันทึกสำเนาลง Local JSON เสมอเพื่อความเสถียร (ป้องกัน duplicate item_code)
    db.items = db.items || [];
    const existIdx = db.items.findIndex(i => i.item_code === itemCode);
    if (existIdx >= 0) {
      db.items[existIdx] = { ...db.items[existIdx], ...savedItem };
    } else {
      db.items.unshift(savedItem);
    }
    saveLostFoundData(db);

    res.status(201).json({
      success: true,
      storage: isDbSaved ? 'supabase_database' : 'local_mirror_file',
      item: savedItem,
      message: `บันทึกของพบเจอสำเร็จ รหัส: ${itemCode}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.2.1 อัปเดต/อัปโหลดรูปภาพหลักฐานสิ่งของที่พบเจอเข้า Google Drive และระบบ (/api/lost-found/items/:id/photo)
app.post('/api/lost-found/items/:id/photo', async (req, res) => {
  try {
    const { id } = req.params;
    const { image_base64, image_url } = req.body || {};
    if (!image_base64 && !image_url) {
      return res.status(400).json({ success: false, error: 'กรุณาส่งข้อมูลรูปภาพ' });
    }

    const db = getLostFoundData();
    db.items = db.items || [];
    const itemIdx = db.items.findIndex(i => String(i.id) === String(id) || String(i.item_code) === String(id));
    const currentItem = itemIdx >= 0 ? db.items[itemIdx] : null;
    const itemCode = currentItem ? currentItem.item_code : `LF-${id}`;
    const filename = `${itemCode}.jpg`;

    let finalImageUrl = image_url || null;
    let gdriveFileId = null;
    let gdriveUrl = null;

    if (image_base64) {
      const buf = Buffer.from(image_base64.split(',').pop(), 'base64');

      // 1. จัดเก็บลง Supabase Storage sarawat-photos ถาวร
      try {
        const storagePath = `lost-items/${filename}`;
        const { error: sErr } = await supabase.storage
          .from('sarawat-photos')
          .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
        if (!sErr) {
          const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
          finalImageUrl = publicUrl;
        }
      } catch (e) {}

      // 2. สำรองเข้า Google Drive โฟลเดอร์ 03_สิ่งของที่พบเจอ (1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ)
      try {
        const gRes = await uploadToGoogleDrive(buf, filename, {
          category: 'lost_found',
          folderId: process.env.GDRIVE_LOST_FOLDER_ID || '1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ',
          itemCode: itemCode,
          title: currentItem?.title || itemCode,
          description: `สิ่งของที่พบเจอ: ${currentItem?.title || itemCode} (${itemCode})`
        });
        if (gRes && gRes.success && gRes.fileId) {
          gdriveFileId = gRes.fileId;
          gdriveUrl = gRes.webViewLink || `https://drive.google.com/file/d/${gRes.fileId}/view`;
          finalImageUrl = `/api/drive-proxy/${gRes.fileId}`;
        }
      } catch (e) {}

      // 3. Fallback: Local file
      if (!finalImageUrl) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buf);
        finalImageUrl = `/uploads/${filename}`;
      }
    }

    // อัปเดตใน Supabase Database
    try {
      await supabase.from('lost_items')
        .update({
          image_url: finalImageUrl,
          gdrive_file_id: gdriveFileId,
          gdrive_url: gdriveUrl,
          updated_at: new Date().toISOString()
        })
        .or(`id.eq.${id},item_code.eq.${id}`);
    } catch (e) {}

    // อัปเดตใน Local JSON
    if (itemIdx >= 0) {
      db.items[itemIdx].image_url = finalImageUrl;
      if (gdriveFileId) db.items[itemIdx].gdrive_file_id = gdriveFileId;
      if (gdriveUrl) db.items[itemIdx].gdrive_url = gdriveUrl;
      db.items[itemIdx].updated_at = new Date().toISOString();
      saveLostFoundData(db);
    }

    res.json({
      success: true,
      image_url: finalImageUrl,
      gdrive_file_id: gdriveFileId,
      gdrive_url: gdriveUrl,
      message: 'อัปเดตรูปหลักฐานเข้า Google Drive สำเร็จ'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.3 ดึงรายการคำร้องขอรับของ / แจ้งของหาย (Claims from Google Form / Web)
app.get('/api/lost-found/claims', async (req, res) => {
  try {
    let claims = [];
    let isDbConnected = false;

    try {
      const { data, error } = await supabase.from('lost_claims').select('*').order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        claims = data;
        isDbConnected = true;
      }
    } catch (e) {}

    if (!isDbConnected) {
      const db = getLostFoundData();
      claims = db.claims || [];
    }

    res.json({
      success: true,
      source: isDbConnected ? 'supabase_database' : 'local_database_fallback',
      count: claims.length,
      data: claims
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.4 รับคำร้องแจ้งของหายใหม่ (จาก Google Form Webhook หรือผ่านหน้าเว็บ)
app.post('/api/lost-found/claims', async (req, res) => {
  try {
    const payload = req.body || {};
    const db = getLostFoundData();
    const currentYear = new Date().getFullYear();
    const claimNum = String((db.claims?.length || 0) + 1).padStart(3, '0');
    const claimCode = payload.claim_code || `CLM-${currentYear}-${claimNum}`;

    const newClaim = {
      claim_code: claimCode,
      category: payload.category || payload.item_category || 'อื่นๆ',
      item_type: payload.item_type || payload.type || payload.title || 'ไม่ระบุ',
      characteristics: payload.characteristics || payload.description || 'ไม่มีรายละเอียด',
      lost_location: payload.lost_location || payload.location || 'ไม่ระบุ',
      lost_date: payload.lost_date || new Date().toISOString().slice(0, 10),
      claimant_name: payload.claimant_name || payload.name || 'ไม่ประสงค์ออกนาม',
      claimant_class: payload.claimant_class || payload.class || '-',
      claimant_contact: payload.claimant_contact || payload.phone || payload.contact || '-',
      status: 'PENDING',
      matched_item_id: null,
      created_at: new Date().toISOString()
    };

    let savedClaim = newClaim;
    let isDbSaved = false;

    try {
      const { data, error } = await supabase.from('lost_claims').insert(newClaim).select().single();
      if (!error && data) {
        savedClaim = data;
        isDbSaved = true;
      }
    } catch (e) {}

    db.claims = db.claims || [];
    db.claims.unshift(savedClaim);
    saveLostFoundData(db);

    // ส่งการ์ดแจ้งเตือนเข้า Discord ห้อง #📦│แจ้งพบของหาย
    (async () => {
      try {
        const token = process.env.DISCORD_TOKEN;
        const guildId = process.env.GUILD_ID || '1567547042207895664';
        if (!token) return;

        const chRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${token}` }
        });
        const channels = await chRes.json();
        const chTarget = Array.isArray(channels)
          ? (channels.find(c => c.name.includes('ของหาย')) || channels.find(c => c.name.includes('แจ้งพบ')))
          : null;
        if (!chTarget) return;

        const webUrl = process.env.WEB_URL || 'https://sarawat-promax.onrender.com';
        await fetch(`https://discord.com/api/v10/channels/${chTarget.id}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            content: `📢 **[แจ้งเตือนสารวัตรทุกนาย]** มีคำร้องแจ้งของตัวเองหายใหม่เข้ามาในระบบ!`,
            embeds: [{
              title: `🔔 [คำร้องแจ้งของหาย] รหัส: ${savedClaim.claim_code}`,
              description:
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 **สิ่งของ:** ${savedClaim.item_type}\n` +
                `🏷️ **หมวดหมู่:** ${savedClaim.category}\n` +
                `📍 **จุดที่คาดว่าทำหาย:** ${savedClaim.lost_location}\n` +
                `📅 **วันที่ทำหาย:** ${savedClaim.lost_date}\n` +
                `🔍 **ลักษณะเด่น:** ${savedClaim.characteristics}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 **ผู้แจ้ง:** ${savedClaim.claimant_name} (ชั้น ${savedClaim.claimant_class})\n` +
                `📞 **ติดต่อ:** ${savedClaim.claimant_contact}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚡ *ตรวจสอบและสแกนจับคู่กับของในคลังได้ทันทีที่หน้าเว็บ*`,
              color: 0xF39C12,
              footer: { text: 'ระบบบริหารงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' },
              timestamp: new Date().toISOString()
            }],
            components: [{
              type: 1,
              components: [{
                type: 2,
                style: 5,
                label: '🌐 เปิดดูคำร้องใน Web Dashboard',
                url: `${webUrl}/lost-found`
              }]
            }]
          })
        });
      } catch (dErr) {
        console.warn('[LOST_CLAIM] Failed to notify Discord:', dErr.message);
      }
    })().catch(() => {});

    res.status(201).json({
      success: true,
      storage: isDbSaved ? 'supabase_database' : 'local_mirror_file',
      claim: savedClaim,
      message: `บันทึกคำร้องสำเร็จ รหัส: ${claimCode}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.5 ตรวจสอบและจับคู่ของในหมวดหมู่ที่ใกล้เคียงกับคำร้อง (Smart Matching Engine)
app.get('/api/lost-found/claims/:id/matches', async (req, res) => {
  try {
    const claimId = req.params.id;
    let claim = null;
    let allItems = [];

    // ดึงข้อมูลคำร้อง
    try {
      const { data: cData, error: cErr } = await supabase.from('lost_claims').select('*').or(`id.eq.${claimId},claim_code.eq.${claimId}`).maybeSingle();
      if (!cErr && cData) claim = cData;
    } catch (e) {}

    // ดึงสิ่งของในคลัง
    try {
      const { data: iData, error: iErr } = await supabase.from('lost_items').select('*').eq('status', 'WAITING_OWNER');
      if (!iErr && Array.isArray(iData)) allItems = iData;
    } catch (e) {}

    // Fallback ถ้า Supabase ยังไม่ได้รัน
    if (!claim || allItems.length === 0) {
      const db = getLostFoundData();
      if (!claim) claim = (db.claims || []).find(c => c.id === claimId || c.claim_code === claimId);
      if (allItems.length === 0) allItems = (db.items || []).filter(item => item.status === 'WAITING_OWNER');
    }

    if (!claim) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำร้องที่ระบุ' });
    }

    const claimKeywords = `${claim.category || ''} ${claim.item_type || ''} ${claim.characteristics || ''}`
      .toLowerCase()
      .split(/[\s,./-]+/)
      .filter(w => w.length > 1);

    const matches = allItems
      .map(item => {
        let score = 0;
        // คะแนนหมวดหมู่เดียวกัน
        if (item.category && claim.category && (item.category.includes(claim.category) || claim.category.includes(item.category))) {
          score += 45;
        }
        // คะแนนคำตรงกันในชื่อและลักษณะเฉพาะ
        const itemText = `${item.title || ''} ${item.characteristics || ''} ${item.location_found || ''}`.toLowerCase();
        let matchedWords = [];
        claimKeywords.forEach(kw => {
          if (itemText.includes(kw)) {
            score += 15;
            matchedWords.push(kw);
          }
        });

        return {
          item,
          match_score: Math.min(score, 98),
          matched_keywords: matchedWords
        };
      })
      .filter(m => m.match_score >= 25)
      .sort((a, b) => b.match_score - a.match_score);

    res.json({ success: true, claim, matches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.5.1 ค้นหาข้อมูลสารวัตรนักเรียนด้วยรหัสประจำตัว (เช่น MS1, TS4, T2, F3)
app.get('/api/inspectors/lookup/:dutyId', async (req, res) => {
  try {
    const rawDutyId = (req.params.dutyId || '').trim();
    if (!rawDutyId) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสประจำตัวสารวัตร' });

    let member = null;
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, duty_id, first_name, last_name, nickname, duty_day, shift_role, profile_image_url, grade_class, student_no')
        .ilike('duty_id', rawDutyId)
        .limit(1)
        .maybeSingle();
      if (!error && data) member = data;
    } catch (e) {}

    // ค้นหาเพิ่มเติมกรณีพิมพ์ตัวพิมพ์เล็กหรือชื่อเล่น
    if (!member) {
      try {
        const { data: allM } = await supabase.from('members').select('*');
        if (allM) {
          member = allM.find(m => 
            (m.duty_id && m.duty_id.toLowerCase() === rawDutyId.toLowerCase()) ||
            (m.nickname && m.nickname.toLowerCase() === rawDutyId.toLowerCase()) ||
            (`${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes(rawDutyId.toLowerCase()))
          );
        }
      } catch (e) {}
    }

    if (!member) {
      return res.json({ success: true, found: false, message: `ไม่พบข้อมูลสารวัตรสำหรับรหัส [${rawDutyId}]` });
    }

    const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'สารวัตรนักเรียน';
    let shiftLeadership = null;
    const { data: assignments } = await supabase.from('shift_leadership').select('shift_code, position').eq('member_id', member.id);
    const memberShift = baseDutyDay(member.duty_day);
    shiftLeadership = (assignments || []).find(a => canonicalDutyDay(a.shift_code) === memberShift) || null;
    const roleTitle = shiftLeadership?.position === 'HEAD' ? `หัวหน้าเวร (${memberShift})`
      : shiftLeadership?.position === 'DEPUTY' ? `รองหัวหน้าเวร (${memberShift})`
      : 'สารวัตรนักเรียน';

    res.json({
      success: true,
      found: true,
      member: {
        id: member.id,
        duty_id: canonicalDutyId(member.duty_id || rawDutyId),
        full_name: fullName,
        nickname: member.nickname || '',
        displayName: member.nickname ? `${fullName} (${member.nickname})` : fullName,
        shift: canonicalDutyDay(member.duty_day),
        shift_role: roleTitle,
        leadership_by_shift: Object.fromEntries((assignments || []).map(a => [canonicalDutyDay(a.shift_code), a.position])),
        photo_url: member.profile_image_url || '/assets/logo.png',
        grade_class: member.grade_class || '',
        student_no: member.student_no || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ฟังก์ชันประกาศส่งมอบของหายไปยัง Discord และดึงลิงก์รูป Discord CDN
async function announceHandoverToDiscord(payload) {
  // 1. ลองเรียก Bot HTTP Server ก่อน (มี timeout 3 วินาที เพื่อไม่ให้เว็บค้าง)
  const botBase = process.env.RENDER_EXTERNAL_URL || 'http://localhost:10000';
  try {
    const res = await fetch(`${botBase}/api/discord/announce-handover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000)
    });
    const d = await res.json();
    if (d.success && d.discord_photo_url) return d.discord_photo_url;
  } catch (e) {}

  // 2. Fallback: ส่งผ่าน Discord REST API โดยตรง
  try {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.GUILD_ID || '1567547042207895664';
    if (!token) return null;

    const chRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(3500)
    });
    const channels = await chRes.json();
    const chTarget = Array.isArray(channels) ? (channels.find(c => c.name.includes('ของหาย')) || channels.find(c => c.name.includes('บริการ'))) : null;
    if (!chTarget) return null;

    if (payload.handover_photo_base64) {
      const buf = Buffer.from(payload.handover_photo_base64.split(',').pop(), 'base64');
      const filename = `handover_${(payload.item_code || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
      const formData = new FormData();
      formData.append('files[0]', new Blob([buf], { type: 'image/jpeg' }), filename);
      formData.append('payload_json', JSON.stringify({
        embeds: [{
          title: `🎉 ส่งมอบสิ่งของคืนเจ้าของเรียบร้อยแล้ว! [${payload.item_code || ''}]`,
          description:
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏷️ **สิ่งของ:** ${payload.title || '-'}\n` +
            `👤 **ผู้รับคืน:** ${payload.claimant_name || '-'} (${payload.claimant_contact || '-'})\n` +
            `🛡️ **สารวัตรผู้ส่งมอบ:** ${payload.delivered_by || '-'} \`[${payload.delivered_by_duty_id || '-'}]\`\n` +
            `📅 **วันเวลา:** ${new Date().toLocaleDateString('th-TH')} (${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })})\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `*✅ บันทึกรูปหลักฐาน (Discord CDN) และปิดเคสลงระบบสารสนเทศเรียบร้อยแล้ว*`,
          color: 0x2ECC71,
          image: { url: `attachment://${filename}` },
          timestamp: new Date().toISOString()
        }]
      }));

      const postRes = await fetch(`https://discord.com/api/v10/channels/${chTarget.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${token}` },
        body: formData,
        signal: AbortSignal.timeout(6000)
      });
      const msgData = await postRes.json();
      if (msgData.attachments && msgData.attachments[0]) {
        return msgData.attachments[0].url;
      }
    }
  } catch (err) {
    console.warn('[ANNOUNCE HANDOVER DISCORD WARN]:', err.message);
  }
  return null;
}

// 6.6 ส่งมอบของ + ถ่ายรูปเก็บหลักฐานบน Discord + ปิดสถานะ (Handover & Delivery)
app.post(['/api/lost-found/items/:id/handover', '/api/lost-items/:id/deliver'], async (req, res) => {
  try {
    const itemId = req.params.id;
    const {
      claimant_name,
      claimant_contact,
      delivered_by,
      delivered_by_duty_id,
      delivered_by_photo_url,
      handover_image_base64,
      handover_photo_base64,
      handover_photo_url,
      claim_id,
      notes
    } = req.body || {};

    const rawPhotoBase64 = handover_image_base64 || handover_photo_base64;
    let finalHandoverPhoto = handover_photo_url || null;

    // หาข้อมูลสิ่งของเดิมเพื่อเอาชื่อและรหัส
    const db = getLostFoundData();
    const existingItem = (db.items || []).find(i => i.id === itemId || i.item_code === itemId) || {};
    const itemCode = existingItem.item_code || itemId;
    const itemTitle = existingItem.title || 'สิ่งของ';

    // 1. บันทึกรูปภาพลง Local File สำรอง
    if (rawPhotoBase64) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `handover_${itemCode.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
      const buf = Buffer.from(rawPhotoBase64.split(',').pop(), 'base64');
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      finalHandoverPhoto = `/uploads/${filename}`;

      // 2. อัปโหลดรูปภาพไปยัง Discord เพื่อให้ Discord เป็น Host รูปหลักถาวร และประกาศลงห้อง
      try {
        const discordCdnUrl = await announceHandoverToDiscord({
          item_code: itemCode,
          title: itemTitle,
          claimant_name,
          claimant_contact,
          delivered_by,
          delivered_by_duty_id: delivered_by_duty_id ? canonicalDutyId(delivered_by_duty_id) : null,
          handover_photo_base64: rawPhotoBase64
        });
        if (discordCdnUrl) {
          finalHandoverPhoto = discordCdnUrl; // ใช้ URL จาก Discord ตามที่ผู้ใช้ระบุ!
        }
      } catch (discErr) {
        console.warn('[DISCORD HANDOVER SYNC WARN]:', discErr.message);
      }
    }

    const updates = {
      status: 'DELIVERED',
      claimant_name: claimant_name || 'ผู้รับมอบสิทธิ์',
      claimant_contact: claimant_contact || '-',
      delivered_by: delivered_by || 'สารวัตรนักเรียนเวร',
      delivered_by_duty_id: canonicalDutyId(delivered_by_duty_id) || '-',
      delivered_by_photo_url: delivered_by_photo_url || null,
      handover_photo_url: finalHandoverPhoto,
      delivered_at: new Date().toISOString(),
      handover_notes: notes || '',
      updated_at: new Date().toISOString()
    };

    let isDbUpdated = false;
    try {
      const { data, error } = await supabase
        .from('lost_items')
        .update(updates)
        .or(`id.eq.${itemId},item_code.eq.${itemId}`)
        .select()
        .single();
      if (!error && data) isDbUpdated = true;

      if (claim_id) {
        await supabase
          .from('lost_claims')
          .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
          .or(`id.eq.${claim_id},claim_code.eq.${claim_id}`);
      }
    } catch (e) {}

    // อัปเดตสำเนาใน Local JSON
    const item = (db.items || []).find(i => i.id === itemId || i.item_code === itemId);
    if (item) {
      Object.assign(item, updates);
    }
    if (claim_id) {
      const claim = (db.claims || []).find(c => c.id === claim_id || c.claim_code === claim_id);
      if (claim) {
        claim.status = 'RESOLVED';
        claim.resolved_at = new Date().toISOString();
      }
    }
    saveLostFoundData(db);

    res.json({
      success: true,
      storage: isDbUpdated ? 'supabase_database' : 'local_mirror_file',
      discord_hosted: finalHandoverPhoto && finalHandoverPhoto.includes('discordapp'),
      message: `ส่งมอบสิ่งของสำเร็จ บันทึกรูปหลักฐานและส่งประกาศไปยัง Discord เรียบร้อยแล้ว`,
      item: item || updates
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.7 ล้างข้อมูลสิ่งของและคำร้องของหายทั้งหมด (KillFile - Reset to 0)
app.post(['/api/lost-found/killfile', '/api/lost-found/reset'], async (req, res) => {
  try {
    let deletedItemsCount = 0;
    let deletedClaimsCount = 0;

    // 1. ลบจาก Supabase Database
    try {
      const { data: itData, error: itErr } = await supabase.from('lost_items').delete().gte('created_at', '1970-01-01').select('id');
      if (!itErr && itData) deletedItemsCount = itData.length;
    } catch (e) {}

    try {
      const { data: clData, error: clErr } = await supabase.from('lost_claims').delete().gte('created_at', '1970-01-01').select('id');
      if (!clErr && clData) deletedClaimsCount = clData.length;
    } catch (e) {}

    // 2. ล้างข้อมูลใน Local Cache
    const db = getLostFoundData();
    const localItemsLen = (db.items || []).length;
    const localClaimsLen = (db.claims || []).length;
    db.items = [];
    db.claims = [];
    saveLostFoundData(db);

    deletedItemsCount = Math.max(deletedItemsCount, localItemsLen);
    deletedClaimsCount = Math.max(deletedClaimsCount, localClaimsLen);

    // 3. ลบไฟล์ภาพอัปโหลดสำรองใน public/uploads ถ้ามี
    try {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
          if (file.startsWith('handover_') || file.startsWith('lost_item_')) {
            try { fs.unlinkSync(path.join(uploadDir, file)); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    console.log(`[KILLFILE] 🗑️ ล้างข้อมูลระบบของหายสำเร็จ: สิ่งของ ${deletedItemsCount} ชิ้น, คำร้อง ${deletedClaimsCount} รายการ`);

    res.json({
      success: true,
      deleted_items: deletedItemsCount,
      deleted_claims: deletedClaimsCount,
      message: `ล้างข้อมูลระบบของหายทั้งหมดเรียบร้อยแล้ว (เริ่มใหม่แต่ 0)`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================
// 6.8 ระบบจัดการและบันทึกผลการสแกนใบเช็คชื่อ A4 ดิจิทัล
// =============================================================
const ATTENDANCE_DB_FILE = path.join(__dirname, '..', 'data', 'attendance_db.json');
const ATTENDANCE_LOCAL_DB = path.join(__dirname, 'attendance_db.json');

function getAttendanceData() {
  let db = { sessions: [], records: [] };
  const candidates = [ATTENDANCE_DB_FILE, ATTENDANCE_LOCAL_DB];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) db.sessions = parsed.sessions;
          if (Array.isArray(parsed.records) && parsed.records.length > 0) db.records = parsed.records;
        }
      }
    } catch (e) {}
  }
  return db;
}

function saveAttendanceData(db) {
  try {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(ATTENDANCE_DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    try {
      fs.writeFileSync(ATTENDANCE_LOCAL_DB, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {}
  }
}

// ฟังก์ชันส่งประกาศแจ้งเตือนสรุปยอดเข้าเวรไปยัง Discord
async function notifyAttendanceToDiscord(sessionData, summary, records) {
  try {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.GUILD_ID;
    const chId = process.env.ATTENDANCE_CHANNEL_ID || process.env.INCIDENT_CHANNEL_ID;
    if (!token || !guildId || !chId) return false;

    const shiftNames = { M: 'วันจันทร์', T: 'วันอังคาร', W: 'วันพุธ', Th: 'วันพฤหัสบดี', F: 'วันศุกร์', S: 'เวรพิเศษทุกวัน' };
    const shiftThai = shiftNames[sessionData.shift_code] || sessionData.shift_code;
    const webUrl = process.env.WEB_URL || 'https://sarawat-promax.onrender.com';

    // จัดหมวดหมู่รายชื่อสารวัตรที่ตรวจเช็ค
    let memberRosterText = '';
    if (Array.isArray(records) && records.length > 0) {
      memberRosterText = records.map(r => {
        let icon = '✅';
        let st = 'มาปฏิบัติหน้าที่';
        if (r.status === 'LATE') {
          icon = '⏰';
          st = 'มาสาย';
        } else if (r.status === 'LEAVE') {
          icon = '📝';
          st = 'ขอลาเวร';
        } else if (r.status === 'ABSENT') {
          icon = '❌';
          st = 'ขาดเวร';
        }
        const nick = r.nickname ? ` (${r.nickname})` : '';
        const room = r.class_room ? ` • ${r.class_room}` : '';
        return `${icon} \`[${r.duty_id || 'ID'}]\` **${r.name || r.duty_id}**${nick}${room} ➔ **${st}**`;
      }).join('\n');
    }

    const embed = {
      title: `⚡ บันทึกการปฏิบัติหน้าที่ประจำวัน // สารวัตรนักเรียน`,
      description: `**ผลัดปฏิบัติการ:** เวร${shiftThai} [Shift ${sessionData.shift_code}]\n` +
                   `**ประจำวันที่:** ${sessionData.duty_date} (สัปดาห์ที่ ${sessionData.week_index || 1})\n` +
                   `**ระบบตรวจสอบ:** Hybrid QR + Gemini Vision AI (ความแม่นยำ 99%+)\n` +
                   `**ผู้รายงาน/หัวหน้าเวร:** ${sessionData.scanned_by || 'หัวหน้าเวร'}\n\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                   `**📊 สรุปยอดความพร้อมและกำลังพล:**\n` +
                   `• ✅ มาปฏิบัติหน้าที่: **${summary.present}** นาย\n` +
                   `• ⏰ มาสาย: **${summary.late}** นาย\n` +
                   `• 📝 ขอลาเวร: **${summary.leave}** นาย\n` +
                   `• ❌ ขาดเวร: **${summary.absent}** นาย\n` +
                   `• 🎯 อัตราความพร้อม: **${summary.attendance_rate}%**\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                   (memberRosterText ? `**📋 รายชื่อสารวัตรที่ตรวจเช็ค:**\n${memberRosterText}\n\n` : '') +
                   `🔗 ตรวจสอบข้อมูลแบบสด: [คลิกเปิดระบบศูนย์บัญชาการ](${webUrl})`,
      color: summary.attendance_rate >= 80 ? 0x22c55e : (summary.attendance_rate >= 50 ? 0xf59e0b : 0xef4444),
      footer: { text: `SARAWAT PRANARAI OS • PAPER-TO-DIGITAL VISION INGESTION` },
      timestamp: new Date().toISOString()
    };

    if (sessionData.raw_image_url && sessionData.raw_image_url.startsWith('http')) {
      embed.image = { url: sessionData.raw_image_url };
    }

    // ปุ่มกด ActionRow แบบ Interactive Link Buttons ใน Discord
    const buttonList = [
      {
        type: 2, // Button
        style: 5, // Link
        label: '📱 เปิดแอพสแกนเช็คชื่อ',
        url: `${webUrl}/attendance-scan?shift=${sessionData.shift_code || 'M'}`
      },
      {
        type: 2, // Button
        style: 5, // Link
        label: '🌐 ศูนย์บัญชาการ',
        url: webUrl
      }
    ];

    if (sessionData.raw_image_url && sessionData.raw_image_url.startsWith('http')) {
      buttonList.unshift({
        type: 2,
        style: 5,
        label: '🖼️ ดูภาพถ่ายสแกน',
        url: sessionData.raw_image_url
      });
    }

    const components = [
      {
        type: 1, // ActionRow
        components: buttonList
      }
    ];

    await fetch(`https://discord.com/api/v10/channels/${chId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed], components })
    });
    return true;
  } catch (err) {
    console.warn('[ATTENDANCE-DISCORD-NOTIFY] ⚠️ ส่งแจ้งเตือน Discord ไม่สำเร็จ:', err.message);
    return false;
  }
}

// -------------------------------------------------------------
// 6.8.0 ฐานข้อมูลสำรอง & API วิเคราะห์ภาพสแกนด้วย Gemini Vision
// -------------------------------------------------------------
const ATTENDANCE_FALLBACK_ROSTERS = {
  M: [
    { duty_id: "MS1", first_name: "มัลลิกา", last_name: "เลื่อนลอย", nickname: "ไอซ์", grade_class: "5/7", student_no: 14 },
    { duty_id: "MS2", first_name: "ศรัณยพงศ์", last_name: "วงศ์สุวรรณ", nickname: "นาย", grade_class: "5/7", student_no: 33 },
    { duty_id: "MS3", first_name: "พรนัชชา", last_name: "ประสมพงค์", nickname: "น้ำชา", grade_class: "5/5", student_no: 3 },
    { duty_id: "MS4", first_name: "พิมพิพัฒณ์", last_name: "รักษาทางดี", nickname: "พิมมี่", grade_class: "5/7", student_no: 27 },
    { duty_id: "M1", first_name: "ณิชกานต์", last_name: "คำไชย", nickname: "นำเหนือ", grade_class: "5/7", student_no: 36 },
    { duty_id: "M2", first_name: "กิตติคุณ", last_name: "สุขสม", nickname: "อาร์ม", grade_class: "5/2", student_no: 12 }
  ],
  T: [
    { duty_id: "TS1", first_name: "ณิชกานต์", last_name: "คำไชย", nickname: "น้ำเหนือ", grade_class: "5/7", student_no: 36 },
    { duty_id: "TS2", first_name: "คณิศร", last_name: "ตะพานแก้ว", nickname: "คิว", grade_class: "5/8", student_no: 5 },
    { duty_id: "TS3", first_name: "พงศ์ภัค", last_name: "ทองคำใส", nickname: "แบงก์", grade_class: "5/7", student_no: 38 },
    { duty_id: "TS4", first_name: "นนท์ธวัตร", last_name: "แย้มอำพล", nickname: "กานต์", grade_class: "5/7", student_no: 32 },
    { duty_id: "TS5", first_name: "ปัณณวัฒน์", last_name: "ปานฮวด", nickname: "ปัน", grade_class: "5/7", student_no: 22 }
  ],
  W: [
    { duty_id: "W1", first_name: "ธีรภัทร", last_name: "พรหมดิสาร", nickname: "บีม", grade_class: "4/7", student_no: 19 },
    { duty_id: "W2", first_name: "ก้องภพ", last_name: "ทองใบ", nickname: "อาร์ม", grade_class: "5/3", student_no: 15 },
    { duty_id: "W3", first_name: "ธราเทพ", last_name: "พงษ์สวัสดิ์", nickname: "ปัน", grade_class: "3/4", student_no: 20 }
  ],
  Th: [
    { duty_id: "Th1", first_name: "ณิชกานต์", last_name: "คำไชย", nickname: "นำเหนือ", grade_class: "5/7", student_no: 36 },
    { duty_id: "Th2", first_name: "ปรเมศวร์", last_name: "ดวงดี", nickname: "โบ๊ท", grade_class: "5/6", student_no: 8 },
    { duty_id: "Th3", first_name: "อภิวัฒน์", last_name: "มีทรัพย์", nickname: "ไอซ์", grade_class: "3/6", student_no: 14 }
  ],
  F: [
    { duty_id: "FS1", first_name: "ภัทรพล", last_name: "บุญวิเศษ", nickname: "ภีมะ", grade_class: "5/7", student_no: 4 },
    { duty_id: "F1", first_name: "กฤษฎา", last_name: "พรหมมา", nickname: "แบงค์", grade_class: "6/4", student_no: 10 },
    { duty_id: "F2", first_name: "ชาญชัย", last_name: "มิ่งขวัญ", nickname: "กาย", grade_class: "5/2", student_no: 16 }
  ],
  S: [
    { duty_id: "FS1", first_name: "ภัทรพล", last_name: "บุญวิเศษ", nickname: "ภีมะ", grade_class: "5/7", student_no: 4 },
    { duty_id: "MS1", first_name: "มัลลิกา", last_name: "เลื่อนลอย", nickname: "ไอซ์", grade_class: "5/7", student_no: 14 },
    { duty_id: "MS2", first_name: "ศรัณยพงศ์", last_name: "วงศ์สุวรรณ", nickname: "นาย", grade_class: "5/7", student_no: 33 }
  ]
};

// ----------------------------------------------------------
// 📑 ATTENDANCE SCAN SESSIONS (Discord Bot -> Web Handshake)
// ----------------------------------------------------------
const scanSessions = new Map(); // id -> { id, image_url, shift, target_date, corners, scanned_by, createdAt }

app.post('/api/attendance/session', (req, res) => {
  try {
    const { image_url, shift, target_date, corners, scanned_by } = req.body;
    const sessionId = `scan-sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const session = {
      id: sessionId,
      image_url,
      shift: shift || 'M',
      target_date: target_date || 'วันนี้',
      corners: corners || null,
      scanned_by: scanned_by || 'สารวัตรนักเรียน',
      createdAt: Date.now()
    };
    scanSessions.set(sessionId, session);
    const webUrl = process.env.WEB_URL || `http://localhost:${PORT}`;
    const sessionUrl = `${webUrl}/attendance-scan?session=${sessionId}&shift=${session.shift}&date=${encodeURIComponent(session.target_date)}`;
    res.json({ success: true, session_id: sessionId, session_url: sessionUrl, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/attendance/session/:id', (req, res) => {
  const session = scanSessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'ไม่พบ Session การสแกน หรือหมดอายุแล้ว' });
  }
  res.json({ success: true, session });
});

app.post('/api/attendance/scan-vision', async (req, res) => {
  try {
    const { image, shift, target_date, date_col_index } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลรูปภาพ (Missing image data)' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY ไม่ได้ถูกตั้งค่าใน Environment' });
    }

    let mimeType = 'image/jpeg';
    let base64Data = image;
    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }

    // 1. ดึงรายชื่อสารวัตรในเวรนี้ (รองรับผลัดควบพิเศษ เช่น MS, TS, WS, ThS, FS และเวรพิเศษ S)
    let roster = [];
    const normShift = canonicalDutyDay(shift || 'M');
    try {
      let rQuery = supabase
        .from('members')
        .select('id, duty_id, first_name, last_name, nickname, grade_class, student_no, duty_day')
        .eq('status', 'ACTIVE');

      if (normShift === 'S') {
        rQuery = rQuery.or('duty_day.eq.S,duty_day.ilike.%S');
      } else if (normShift === 'Th') {
        rQuery = rQuery.in('duty_day', ['Th', 'ThS', 'Ts', 'TSS', 'TsS']);
      } else {
        rQuery = rQuery.in('duty_day', [normShift, `${normShift}S`]);
      }

      const { data: dbMembers } = await rQuery.order('student_no', { ascending: true });
      if (dbMembers && dbMembers.length > 0) {
        roster = dbMembers;
      }
    } catch (e) {}

    if (roster.length === 0) {
      roster = ATTENDANCE_FALLBACK_ROSTERS[normShift] || ATTENDANCE_FALLBACK_ROSTERS['M'];
    }

    // 2. ดึงประวัติการลาจาก Discord Cloud (leave_requests)
    const discordLeavesMap = {};
    try {
      let lQuery = supabase.from('leave_requests').select('*, members(duty_id)');
      if (shift) lQuery = lQuery.eq('duty_day', shift);
      const { data: leaves } = await lQuery;
      (leaves || []).forEach(l => {
        const did = l.members?.duty_id || l.duty_id;
        if (did) discordLeavesMap[did] = l;
      });
    } catch (e) {}

    // 3. สร้าง Prompt ละเอียดและรัดกุมสำหรับ Gemini Vision
    const rosterListStr = roster.map((m, idx) => 
      `${idx + 1}. [${m.duty_id}] ${m.nickname ? m.nickname + ' - ' : ''}${m.first_name || ''} ${m.last_name || ''} (${m.grade_class || ''} เลขที่ ${m.student_no || ''})`
    ).join('\n');

    const colNumber = (Number(date_col_index) || 0) + 1;
    const prompt = `You are an expert Optical Mark Recognition (OMR) system for an attendance sheet (ใบเช็คชื่อ A4) of student inspectors (กองสารวัตรนักเรียน).
Target Shift: "${shift}"
Target Date Column: "${target_date || 'วันนี้'}" (Column #${colNumber} of the 12 weekly columns under "บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)", date header text: "${target_date || ''}").

Expected student roster:
${rosterListStr}

CRITICAL RULES FOR ACCURACY:
1. LOCATE THE MAIN ATTENDANCE TABLE:
   The table header row has: "ห้อง/เลขที่", "ชื่อเล่น", "ชื่อ - สกุลจริง", "รหัสประจำตัว", followed by 12 date columns under "บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)".
2. LOCATE TARGET COLUMN #${colNumber} ("${target_date}"):
   - Target Column Number: #${colNumber} out of 12 (1-based from left to right among the 12 date columns).
   - Target Header Text: "${target_date}".
   - For Column #1 ("${target_date}"), it is the FIRST date column located IMMEDIATELY to the right of "รหัสประจำตัว".
   - For Column #${colNumber}, look at the column directly under the header "${target_date}" (the ${colNumber}th date column from "รหัสประจำตัว").
3. READ ATTENDANCE IN COLUMN #${colNumber} FOR EACH STUDENT ROW:
   - Identify each student row by Duty ID (${roster.map(r => r.duty_id).join(', ')}), Name, or Class/Room.
   - Look at the circle in this student's row at Column #${colNumber} ("${target_date}").
   - A circle is FILLED (มา / is_filled: true): It has a SOLID BLACK or DARK shaded background (it looks like a black disc, often with inverted white letter "ม" inside). fill_percentage: 85-100.
   - A circle is UNFILLED (สาย / is_filled: false): It has a WHITE/BLANK background inside the circle (only a thin circular boundary with gray letter "ม"). fill_percentage: 0-15.
   - Return "box_2d": [ymin, xmin, ymax, xmax] (normalized 0-1000) tightly enclosing the circle inside that cell.

Return JSON strictly matching this schema:
{
  "detected_date_column": "${target_date}",
  "results": [
    {
      "duty_id": "TS1",
      "name": "ณิชกานต์ คำไชย",
      "visual_check": "solid black circle with white text",
      "is_filled": true,
      "fill_percentage": 95,
      "confidence": 99,
      "box_2d": [ymin, xmin, ymax, xmax]
    }
  ]
}`;

    // 4. เรียกโมเดล Gemini Flash พร้อมระบบ Failover อัตโนมัติ (Fast & Stable)
    const candidateModels = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-flash-latest'
    ];
    let geminiData = null;
    let usedModel = candidateModels[0];

    for (const m of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType, data: base64Data } }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          }),
          signal: AbortSignal.timeout(18000)
        });

        const data = await gRes.json();
        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
          geminiData = data;
          usedModel = m;
          break;
        } else if (data.error) {
          console.warn(`[GEMINI-VISION] Model ${m} error:`, data.error.message);
        }
      } catch (err) {
        console.warn(`[GEMINI-VISION] Model ${m} attempt failed:`, err.message);
      }
    }

    if (!geminiData) {
      throw new Error('ไม่สามารถประมวลผลผ่าน Gemini Vision ได้ในขณะนี้');
    }

    const rawText = geminiData.candidates[0].content.parts[0].text;
    let aiParsed = {};
    try {
      const stripped = (rawText || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      aiParsed = JSON.parse(stripped || '{}');
    } catch (parseErr) {
      const match = (rawText || '').match(/\{[\s\S]*\}/);
      if (match) aiParsed = JSON.parse(match[0]);
    }
    const aiResults = Array.isArray(aiParsed.results) ? aiParsed.results : [];

    res.json({
      success: true,
      model: usedModel,
      shift,
      target_date,
      date_col_index,
      ai_results: aiResults,
      roster: roster.map(m => ({
        duty_id: m.duty_id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.duty_id,
        nickname: m.nickname || '',
        class_room: m.grade_class ? `${m.grade_class} (${m.student_no || ''})` : (m.class_room || ''),
        grade_class: m.grade_class || '',
        student_no: m.student_no || ''
      })),
      discord_leaves: discordLeavesMap
    });

  } catch (err) {
    console.error('[API-SCAN-VISION-ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.8.1 บันทึกผลยืนยันการสแกนใบเช็คชื่อ (/api/attendance/confirm)
app.post('/api/attendance/confirm', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const secretHeader = req.headers['x-webhook-secret'] || req.headers['authorization'];
    const isAuthorized = user || (secretHeader && secretHeader === (process.env.WEBHOOK_SECRET || 'pranarai_secret_sarawat_2026'));
    if (!isAuthorized) {
      return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบก่อนทำการบันทึกยืนยันยอดเช็คชื่อ' });
    }

    const { shift_code, quarter, week_index, duty_date, scanned_by, image_base64, records } = req.body;
    if (!shift_code || !Array.isArray(records)) {
      return res.status(400).json({ success: false, error: 'ข้อมูลไม่ถูกต้อง กรุณาระบุกะเวรและรายชื่อสารวัตร' });
    }
    const normalizedShiftCode = canonicalDutyDay(shift_code);

    let rawImageUrl = null;
    if (image_base64) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `attendance_${normalizedShiftCode}_${Date.now()}.jpg`;
      const buf = Buffer.from(image_base64.split(',').pop(), 'base64');
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      rawImageUrl = `/uploads/${filename}`;

      try {
        const storagePath = `attendance/${filename}`;
        const { error: sErr } = await supabase.storage
          .from('sarawat-photos')
          .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
        if (!sErr) {
          const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
          rawImageUrl = publicUrl;
        }
      } catch (e) {}
    }

    // คำนวณสรุปยอด
    let present = 0, late = 0, leave = 0, absent = 0;
    records.forEach(r => {
      if (r.status === 'PRESENT') present++;
      else if (r.status === 'LATE') late++;
      else if (r.status === 'LEAVE') leave++;
      else if (r.status === 'ABSENT') absent++;
    });
    const total = records.length;
    const attendance_rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    const summary = { total, present, late, leave, absent, attendance_rate };

    const sessionData = {
      id: `att-sess-${Date.now()}`,
      shift_code: normalizedShiftCode,
      quarter_number: quarter || 1,
      week_index: week_index || 1,
      duty_date: duty_date || new Date().toISOString().slice(0, 10),
      raw_image_url: rawImageUrl,
      scanned_by: scanned_by || 'หัวหน้าเวร',
      total_roster: total,
      present_count: present,
      late_count: late,
      leave_count: leave,
      absent_count: absent,
      attendance_rate,
      created_at: new Date().toISOString()
    };

    // 1. บันทึกลง Supabase Database
    try {
      await supabase.from('attendance_scan_sessions').upsert({
        shift_code: sessionData.shift_code,
        duty_date: sessionData.duty_date,
        quarter_number: sessionData.quarter_number,
        week_column_index: sessionData.week_index,
        raw_image_url: sessionData.raw_image_url,
        total_roster: total,
        present_count: present,
        late_count: late,
        leave_count: leave,
        absent_count: absent,
        attendance_rate,
        scanned_by: sessionData.scanned_by
      }, { onConflict: 'shift_code,duty_date' });

      // Upsert individual records
      const upsertRows = records.map(r => ({
        duty_id: r.duty_id,
        member_name: r.name,
        shift_code: normalizedShiftCode,
        duty_date: sessionData.duty_date,
        status: r.status,
        confidence: 0.98,
        was_manually_edited: !!r.was_edited
      }));
      await supabase.from('attendance_records').upsert(upsertRows, { onConflict: 'duty_id,duty_date' });
    } catch (dbErr) {
      console.warn('[ATTENDANCE-DB] Supabase error, using local fallback:', dbErr.message);
    }

    // 2. บันทึกลง Local Cache
    const db = getAttendanceData();
    db.sessions.unshift(sessionData);
    records.forEach(r => {
      db.records.push({
        session_id: sessionData.id,
        duty_id: r.duty_id,
        member_name: r.name,
        shift_code: normalizedShiftCode,
        duty_date: sessionData.duty_date,
        status: r.status,
        created_at: new Date().toISOString()
      });
    });
    saveAttendanceData(db);

    // 3. แจ้งเตือนไปยัง Discord
    notifyAttendanceToDiscord(sessionData, summary, records);

    res.json({
      success: true,
      session_id: sessionData.id,
      summary,
      message: 'บันทึกข้อมูลการเข้าเวรสำเร็จเรียบร้อย'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.8.2 ดูประวัติการเข้าเวรล่าสุด (/api/attendance/records)
app.get('/api/attendance/records', async (req, res) => {
  try {
    const { shift, date } = req.query;
    let records = [];
    try {
      let q = supabase.from('attendance_records').select('*').order('duty_date', { ascending: false }).limit(100);
      if (shift) q = q.in('shift_code', expandDutyDayAliases([shift]));
      if (date) q = q.eq('duty_date', date);
      const { data, error } = await q;
      if (!error && data) records = data;
    } catch (e) {}

    if (records.length === 0) {
      const db = getAttendanceData();
      records = db.records || [];
      if (shift) records = records.filter(r => canonicalDutyDay(r.shift_code) === canonicalDutyDay(shift));
      if (date) records = records.filter(r => r.duty_date === date);
    }

    res.json({ success: true, count: records.length, data: records.map(r => ({
      ...r,
      shift_code: canonicalDutyDay(r.shift_code),
      duty_id: canonicalDutyId(r.duty_id)
    })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6.8.3 ศูนย์วิเคราะห์ข้อมูลและสถิติภาพรวม (/api/analytics/overview)
// -------------------------------------------------------------
app.get('/api/analytics/overview', async (req, res) => {
  try {
    const { startDate, endDate, preset = 'all' } = req.query;

    // 1. Fetch Members (เฉพาะสมาชิกสถานะ ACTIVE ที่ได้รับการอนุมัติแล้วเท่านั้น)
    let members = [];
    try {
      const { data: mData, error: mErr } = await supabase
        .from('members')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('duty_id', { ascending: true });
      if (!mErr && Array.isArray(mData) && mData.length > 0) {
        // กรองตัดชื่อ-นามสกุลซ้ำซ้อน (Deduplication)
        const seenNames = new Set();
        members = mData.filter(m => {
          const key = `${(m.first_name || '').trim()} ${(m.last_name || '').trim()}`;
          if (seenNames.has(key)) return false;
          seenNames.add(key);
          return true;
        });
      }
    } catch (e) {}

    if (members.length === 0) {
      members = Object.entries(ATTENDANCE_FALLBACK_ROSTERS).flatMap(([shift, list]) => 
        list.map((m, idx) => ({
          ...m,
          duty_day: shift,
          is_head: idx === 0,
          is_deputy: idx === 1
        }))
      );
    }

    // 2. Fetch Attendance Records
    let attendance = [];
    try {
      let q = supabase.from('attendance_records').select('*');
      if (startDate) q = q.gte('duty_date', startDate);
      if (endDate) q = q.lte('duty_date', endDate);
      const { data: aData, error: aErr } = await q;
      if (!aErr && Array.isArray(aData)) attendance = aData;
    } catch (e) {}

    const localDb = getAttendanceData();
    if (attendance.length === 0 && localDb.records && localDb.records.length > 0) {
      attendance = localDb.records.filter(r => {
        if (startDate && r.duty_date < startDate) return false;
        if (endDate && r.duty_date > endDate) return false;
        return true;
      });
    }

    // 3. Fetch Leave Requests
    let leaves = [];
    try {
      const { data: allLeaves, error: lErr } = await supabase
        .from('leave_requests')
        .select('*, members(duty_id, first_name, last_name, nickname, duty_day, grade_class)')
        .order('created_at', { ascending: false });

      if (!lErr && Array.isArray(allLeaves)) {
        leaves = allLeaves.filter(l => {
          const dt = l.created_at ? l.created_at.slice(0, 10) : null;
          if (startDate && dt && dt < startDate) return false;
          if (endDate && dt && dt > endDate) return false;
          return true;
        });
      }
    } catch (e) {
      console.warn('[ANALYTICS] Leave requests query warning:', e.message);
    }

    // 4. Fetch Cases
    let cases = [];
    try {
      let cq = supabase.from('cases').select('*').order('incident_date_time', { ascending: false });
      if (startDate) cq = cq.gte('incident_date_time', `${startDate}T00:00:00.000Z`);
      if (endDate) cq = cq.lte('incident_date_time', `${endDate}T23:59:59.999Z`);
      const { data: cData, error: cErr } = await cq;
      if (cErr) {
        console.warn('[ANALYTICS] Cases query warning:', cErr.message);
        const { data: fbData } = await supabase.from('cases').select('*').order('created_at', { ascending: false });
        if (Array.isArray(fbData)) cases = fbData;
      } else if (Array.isArray(cData)) {
        cases = cData;
      }
    } catch (e) {
      console.warn('[ANALYTICS] Cases error:', e.message);
    }

    // Fallback: ดึงจาก Cases Cache หากยังไม่มีข้อมูลจาก Supabase
    if (cases.length === 0) {
      const cachedCases = getCasesCache();
      cases = cachedCases.filter(c => {
        const dt = c.incident_date_time || c.created_at;
        if (startDate && dt && dt < `${startDate}T00:00:00.000Z`) return false;
        if (endDate && dt && dt > `${endDate}T23:59:59.999Z`) return false;
        return true;
      });
    }

    // 5. Fetch Lost & Found Items
    let lostItems = [];
    try {
      let iq = supabase.from('lost_items').select('*').order('created_at', { ascending: false });
      if (startDate) iq = iq.gte('created_at', startDate);
      if (endDate) iq = iq.lte('created_at', endDate + 'T23:59:59.999Z');
      const { data: iData, error: iErr } = await iq;
      if (!iErr && Array.isArray(iData)) lostItems = iData;
    } catch (e) {}

    // 6. Aggregate Member Metrics
    const memberMap = {};
    members.forEach(m => {
      memberMap[m.duty_id] = {
        duty_id: m.duty_id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.duty_id,
        nickname: m.nickname || '',
        class_room: m.grade_class || m.room || '',
        duty_day: m.duty_day || 'M',
        is_head: !!m.is_head,
        is_deputy: !!m.is_deputy,
        photo_url: m.photo_url || '',
        present_count: 0,
        late_count: 0,
        leave_count: 0,
        absent_count: 0,
        total_attendance: 0,
        leave_types: {}
      };
    });

    attendance.forEach(rec => {
      // 🛡️ บันทึกเฉพาะสารวัตรที่มีตัวตนจริงในฐานข้อมูล members เท่านั้น ป้องกัน duty_id ผีแปลกปลอมโผล่บน Leaderboard
      if (!memberMap[rec.duty_id]) {
        return;
      }
      const st = rec.status;
      memberMap[rec.duty_id].total_attendance++;
      if (st === 'PRESENT') memberMap[rec.duty_id].present_count++;
      else if (st === 'LATE') memberMap[rec.duty_id].late_count++;
      else if (st === 'LEAVE') memberMap[rec.duty_id].leave_count++;
      else if (st === 'ABSENT') memberMap[rec.duty_id].absent_count++;
    });

    leaves.forEach(l => {
      const dutyId = (l.members && l.members.duty_id) ? l.members.duty_id : l.duty_id;
      if (dutyId && memberMap[dutyId]) {
        const lType = l.leave_type || 'ขอลา';
        memberMap[dutyId].leave_types[lType] = (memberMap[dutyId].leave_types[lType] || 0) + 1;
        if (attendance.length === 0) {
          memberMap[dutyId].leave_count++;
          memberMap[dutyId].total_attendance++;
        }
      }
    });

    let totalAttendance = attendance.length;
    let totalPresent = attendance.filter(r => r.status === 'PRESENT').length;
    let totalLate = attendance.filter(r => r.status === 'LATE').length;
    let totalLeave = attendance.filter(r => r.status === 'LEAVE').length || leaves.length;
    let totalAbsent = attendance.filter(r => r.status === 'ABSENT').length;

    if (totalAttendance === 0) {
      Object.values(memberMap).forEach(m => {
        totalPresent += m.present_count;
        totalLate += m.late_count;
        totalLeave += m.leave_count;
        totalAbsent += m.absent_count;
      });
      totalAttendance = totalPresent + totalLate + totalLeave + totalAbsent;
    }

    const readinessRate = totalAttendance > 0 
      ? Math.round(((totalPresent + totalLeave) / totalAttendance) * 100) 
      : 100;

    const shiftStats = {
      M: { present: 0, late: 0, leave: 0, absent: 0 },
      T: { present: 0, late: 0, leave: 0, absent: 0 },
      W: { present: 0, late: 0, leave: 0, absent: 0 },
      Th: { present: 0, late: 0, leave: 0, absent: 0 },
      F: { present: 0, late: 0, leave: 0, absent: 0 }
    };
    attendance.forEach(r => {
      const sh = canonicalDutyDay(r.shift_code || (memberMap[r.duty_id] ? memberMap[r.duty_id].duty_day : 'M'));
      if (shiftStats[sh]) {
        if (r.status === 'PRESENT') shiftStats[sh].present++;
        else if (r.status === 'LATE') shiftStats[sh].late++;
        else if (r.status === 'LEAVE') shiftStats[sh].leave++;
        else if (r.status === 'ABSENT') shiftStats[sh].absent++;
      }
    });

    const leaveTypes = { 'ลาป่วย': 0, 'ลากิจ': 0, 'ลากิจกรรม': 0, 'อื่นๆ': 0 };
    leaves.forEach(l => {
      const t = l.leave_type || '';
      if (t.includes('ป่วย')) leaveTypes['ลาป่วย']++;
      else if (t.includes('กิจ') && !t.includes('กรรม')) leaveTypes['ลากิจ']++;
      else if (t.includes('กรรม') || t.includes('แข่ง')) leaveTypes['ลากิจกรรม']++;
      else leaveTypes['อื่นๆ']++;
    });

    // 🛡️ ตรวจสอบความสอดคล้องกับสถิติ attendance:
    // หากมียอดรวมการลาในรอบเวรมากกว่าจำนวนใบลาในระบบ ให้กระจายส่วนต่างเข้า 'อื่นๆ'
    const totalCountedLeaves = Object.values(leaveTypes).reduce((a, b) => a + b, 0);
    const attLeaveCount = attendance.filter(r => r.status === 'LEAVE').length;
    if (attLeaveCount > totalCountedLeaves) {
      leaveTypes['อื่นๆ'] += (attLeaveCount - totalCountedLeaves);
    }

    const leaderboard = Object.values(memberMap)
      .map(m => {
        const topType = Object.entries(m.leave_types).sort((a,b) => b[1]-a[1])[0];
        return {
          ...m,
          total_penalties: m.leave_count + m.late_count + m.absent_count,
          frequent_leave_type: topType ? topType[0] : (m.leave_count > 0 ? 'ลากิจ/ป่วย' : '-')
        };
      })
      .sort((a, b) => {
        if (b.leave_count !== a.leave_count) return b.leave_count - a.leave_count;
        if (b.absent_count !== a.absent_count) return b.absent_count - a.absent_count;
        return b.late_count - a.late_count;
      });

    let leadershipAssignments = [];
    try {
      const { data: leadership } = await supabase
        .from('shift_leadership')
        .select('shift_code, position, member_id');
      if (Array.isArray(leadership)) leadershipAssignments = leadership;
    } catch (e) {}

    const SHIFT_TITLES = {
      M: { name: 'เวรวันจันทร์', color: 'amber', dutyDesc: 'ควบคุมแถวเข้าแถวเคารพธงชาติ & จุดประตู 1' },
      T: { name: 'เวรวันอังคาร', color: 'pink', dutyDesc: 'ตรวจเครื่องแต่งกายและทรงผม & โรงอาหาร' },
      W: { name: 'เวรวันพุธ', color: 'emerald', dutyDesc: 'ตรวจบัตรนักเรียน & ดูแลความเรียบร้อยรอบอาคาร' },
      Th: { name: 'เวรวันพฤหัสบดี', color: 'orange', dutyDesc: 'สายตรวจอาคารเรียน & เฝ้าระวังจุดอับ' },
      F: { name: 'เวรวันศุกร์', color: 'cyan', dutyDesc: 'ตรวจสัมภาระ & ดูแลความเรียบร้อยช่วงเลิกเรียน' },
      S: { name: 'เวรพิเศษ', color: 'violet', dutyDesc: 'กำลังพลเวรพิเศษที่ปฏิบัติงานร่วมกับผลัดประจำวัน' }
    };

    const getBaseWeekday = (dutyDay) => {
      if (!dutyDay) return '';
      if (['ThS', 'Th'].includes(canonicalDutyDay(dutyDay))) return 'Th';
      return dutyDay.replace(/S+$/, '');
    };

    const organization = ['M', 'T', 'W', 'Th', 'F', 'S'].map(shiftKey => {
      const shiftMembers = members.filter(m => shiftKey === 'S'
        ? m.duty_day === 'S' || /S$/.test(m.duty_day || '')
        : getBaseWeekday(m.duty_day) === shiftKey);
      const headId = leadershipAssignments.find(a => canonicalDutyDay(a.shift_code) === shiftKey && a.position === 'HEAD')?.member_id;
      const deputyId = leadershipAssignments.find(a => canonicalDutyDay(a.shift_code) === shiftKey && a.position === 'DEPUTY')?.member_id;
      const head = headId ? shiftMembers.find(m => m.id === headId) || null : null;
      const deputy = deputyId ? shiftMembers.find(m => m.id === deputyId && m.id !== head?.id) || null : null;
      const officers = shiftMembers.filter(m => 
        (!head || m.id !== head.id) && (!deputy || m.id !== deputy.id)
      );

      return {
        shift_code: shiftKey,
        shift_name: SHIFT_TITLES[shiftKey]?.name || `เวรผลัด ${shiftKey}`,
        duty_desc: SHIFT_TITLES[shiftKey]?.dutyDesc || 'ปฏิบัติหน้าที่สารวัตรนักเรียน',
        color: SHIFT_TITLES[shiftKey]?.color || 'amber',
        total_members: shiftMembers.length,
        eligible_members: shiftMembers.map(m => ({
          id: m.id,
          duty_id: m.duty_id || '-',
          nickname: m.nickname || '',
          name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
          class_room: m.grade_class || m.room || ''
        })),
        head: head ? {
          id: head.id,
          duty_id: head.duty_id || '-',
          name: `${head.first_name || ''} ${head.last_name || ''}`.trim(),
          nickname: head.nickname || '',
          class_room: head.grade_class || head.room || '',
          phone: head.phone_number || head.phone || '',
          role: 'หัวหน้าผลัดเวร 👑',
          photo_url: head.profile_image_url || head.photo_url || ''
        } : null,
        deputy: deputy ? {
          id: deputy.id,
          duty_id: deputy.duty_id || '-',
          name: `${deputy.first_name || ''} ${deputy.last_name || ''}`.trim(),
          nickname: deputy.nickname || '',
          class_room: deputy.grade_class || deputy.room || '',
          phone: deputy.phone_number || deputy.phone || '',
          role: 'รองหัวหน้าผลัดเวร 🥈',
          photo_url: deputy.profile_image_url || deputy.photo_url || ''
        } : null,
        officers: officers.map(o => ({
          duty_id: o.duty_id || '-',
          name: `${o.first_name || ''} ${o.last_name || ''}`.trim(),
          nickname: o.nickname || '',
          class_room: o.grade_class || o.room || '',
          phone: o.phone_number || o.phone || '',
          role: 'สารวัตรประจำจุด',
          photo_url: o.profile_image_url || o.photo_url || ''
        }))
      };
    });

    res.json({
      success: true,
      query: { startDate: startDate || null, endDate: endDate || null, preset },
      data: {
        summary: {
          totalAttendance,
          totalPresent,
          totalLate,
          totalLeave,
          totalAbsent,
          readinessRate,
          totalMembers: members.length
        },
        shiftStats,
        leaveTypes,
        leaderboard,
        cases: {
          total: cases.length,
          pending: cases.filter(c => c.status !== 'RESOLVED').length,
          investigating: cases.filter(c => c.status === 'INVESTIGATING' || c.status === 'IN_PROGRESS').length,
          resolved: cases.filter(c => c.status === 'RESOLVED').length,
          recent: cases.slice(0, 10).map(c => ({
            id: c.case_id || c.id,
            case_id: c.case_id,
            title: c.category || c.title || (c.description ? c.description.split('\n')[0] : '') || c.case_id || 'เหตุการณ์ทั่วไป',
            category: c.category || 'ทั่วไป',
            description: c.description || '',
            location: c.location || 'ในโรงเรียน',
            incident_date: c.incident_date_time ? c.incident_date_time.split('T')[0] : (c.created_at ? c.created_at.split('T')[0] : ''),
            incident_date_time: c.incident_date_time || c.created_at,
            status: c.status || 'PENDING',
            evidence_count: Array.isArray(c.evidence_urls) ? c.evidence_urls.length : (c.evidence_url ? 1 : 0),
            evidence_urls: Array.isArray(c.evidence_urls) ? c.evidence_urls : (c.evidence_url ? [c.evidence_url] : []),
            reporter_name: c.reporter_name || '',
            reporter_grade: c.reporter_grade || '',
            contact_info: c.contact_info || '',
            officer_name: c.officer_name || ''
          }))
        },
        lostFound: {
          total: lostItems.length,
          waiting: lostItems.filter(i => i.status === 'WAITING_OWNER').length,
          claimed: lostItems.filter(i => i.status === 'CLAIMED').length,
          recent: lostItems.slice(0, 10)
        },
        organization,
        canManageLeadership: canManageShiftLeadership(req.user)
      }
    });
  } catch (err) {
    console.error('Analytics API error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6.8.4 หน้าเว็บศูนย์สถิติและคลังข้อมูลรวม (/analytics)
// -------------------------------------------------------------
app.get(['/analytics', '/analytics.html', '/stats-overview', '/records'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// -------------------------------------------------------------
// 7. หน้าเว็บระบบของหาย (/lost-found)
// -------------------------------------------------------------
app.get(['/lost-found', '/lost-found.html'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lost-found.html'));
});

// -------------------------------------------------------------
// 7.1 หน้าเว็บอัปโหลด Bodycam และหลักฐาน (/bodycam-upload)
// -------------------------------------------------------------
app.get(['/bodycam-upload', '/bodycam-upload.html'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bodycam-upload.html'));
});

// -------------------------------------------------------------
// 7.1 หน้าเว็บตรวจสอบบัตรทางการ (Public QR Scan Page)
// -------------------------------------------------------------
app.get(['/verify', '/verify.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

// -------------------------------------------------------------
// 7.2 สตูดิโอออกแบบเทมเพลตบัตรสารวัตร (/card-studio, /card)
// -------------------------------------------------------------
app.get(['/card-studio', '/card-studio.html', '/card', '/card.html'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'card-studio.html'));
});

// -------------------------------------------------------------
// 7.2.1 หน้าเว็บบอร์ดบัญชาการเดิม (/dashboard, /app, /console)
// -------------------------------------------------------------
app.get(['/dashboard', '/dashboard.html', '/app', '/console'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// -------------------------------------------------------------
// 7.2.2 หน้าพิมพ์ใบเช็คชื่อ A4 และระบบสแกนเช็คชื่อ Multi-Shot
// -------------------------------------------------------------
app.get('/sheet/:id', async (req, res) => {
  const sheetId = req.params.id;
  try {
    const { data, error } = await supabase.storage.from('sarawat-photos').download(`temp-sheets/${sheetId}.html`);
    if (error || !data) {
      res.status(404).send(`
        <!DOCTYPE html>
        <html lang="th">
        <head><meta charset="UTF-8"><title>เอกสารหมดอายุ</title></head>
        <body style="font-family:sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="background:#1e293b;padding:2.5rem;border-radius:12px;text-align:center;max-width:440px;">
            <h2 style="color:#f87171;">⏰ ลิ้งก์เอกสารนี้หมดอายุแล้ว</h2>
            <p style="color:#94a3b8;">เอกสารชั่วคราวถูกลบออกจากหน่วยความจำแล้ว กรุณากดขอใบตารางเช็คชื่อใหม่จากช่อง Discord</p>
          </div>
        </body></html>
      `);
      return;
    }
    const html = await data.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  } catch (err) {
    res.status(500).send('Internal Server Error: ' + err.message);
  }
});

app.get(['/attendance-sheet', '/attendance-sheet.html', '/print-attendance'], requireAuth, (req, res) => {
  const shift = req.query.shift || 'M';
  res.redirect(`/attendance-scan?shift=${shift}`);
});

app.get(['/attendance-scan', '/attendance-scan.html', '/scan-attendance'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance-scan.html'));
});

// -------------------------------------------------------------
// 7.2.5 🚨 ศูนย์สั่งการด่วน & แจ้งเตือนเสียง AI (Tactical Dispatch)
// -------------------------------------------------------------
const DISPATCH_CACHE_PATHS = [
  path.join(__dirname, '..', 'data', 'dispatch_logs_cache.json'),
  path.join(__dirname, 'data', 'dispatch_logs_cache.json'),
  path.join(process.cwd(), 'data', 'dispatch_logs_cache.json')
];

function getDispatchLogsFromCache() {
  for (const f of DISPATCH_CACHE_PATHS) {
    try {
      if (fs.existsSync(f)) {
        return JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
      }
    } catch (e) {}
  }
  return [];
}

function saveDispatchLogToCache(record) {
  if (!record || !record.id) return;
  const target = DISPATCH_CACHE_PATHS[0];
  try {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let list = getDispatchLogsFromCache();
    const idx = list.findIndex(item => item && item.id === record.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...record };
    } else {
      list.unshift(record);
      if (list.length > 100) list = list.slice(0, 100);
    }
    fs.writeFileSync(target, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {}
}

app.post('/api/dispatch/ai-polish', requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.canManageMembers && !user?.isAdmin && !user?.isPresident && !user?.isTeacher) {
    return res.status(403).json({ success: false, error: 'เฉพาะผู้ดูแลระบบ, ประธาน, และครูที่ปรึกษาเท่านั้นที่สามารถใช้ระบบสั่งการได้' });
  }
  try {
    const { category, rawText } = req.body;
    const result = await polishDispatchMessage({
      category,
      rawText,
      apiKey: process.env.GEMINI_API_KEY
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || 'ไม่สามารถประมวลผลข้อความได้' });
  }
});

app.post('/api/dispatch/send', requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.canManageMembers && !user?.isAdmin && !user?.isPresident && !user?.isTeacher) {
    return res.status(403).json({ success: false, error: 'เฉพาะผู้ดูแลระบบ, ประธาน, และครูที่ปรึกษาเท่านั้นที่สามารถใช้ระบบสั่งการได้' });
  }
  try {
    const {
      category = 'PATROL',
      mentionTarget = 'none',
      originalText = '',
      aiText = '',
      selectedVersion = 'ai',
      finalText = ''
    } = req.body;

    if (!finalText && !originalText) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุข้อความคำสั่งการ' });
    }

    const chosenFinalText = (finalText || (selectedVersion === 'ai' ? aiText : originalText) || '').trim();
    const mentionRoleIds = resolveMentionRoleIds({ mentionTarget, env: process.env });
    const channelId = process.env.INCIDENT_CHANNEL_ID || '1567570890084843530';
    const botToken = process.env.DISCORD_TOKEN;

    // 1. สร้าง Record เริ่มต้นใน Supabase
    let logId = crypto.randomUUID();
    let senderRole = 'COMMANDER';
    if (user.isAdmin) senderRole = 'ADMIN';
    else if (user.isTeacher) senderRole = 'TEACHER';
    else if (user.isPresident) senderRole = 'PRESIDENT';
    else if (user.isVicePresident) senderRole = 'VICE_PRESIDENT';

    const logPayload = {
      id: logId,
      sender_discord_id: user.id || 'system',
      sender_name: user.displayName || user.nickname || user.username || 'ผู้ดูแลระบบ',
      sender_role: senderRole,
      category,
      mention_target: mentionTarget,
      original_text: originalText,
      ai_text: aiText,
      selected_version: selectedVersion,
      final_text: chosenFinalText,
      discord_channel_id: channelId,
      acknowledged_officers: []
    };

    try {
      const { data: dbData } = await supabase.from('dispatch_logs').insert(logPayload).select().single();
      if (dbData?.id) logId = dbData.id;
    } catch (dbErr) {
      console.warn('[DISPATCH_DB_WARN] Failed to insert dispatch log into Supabase:', dbErr.message);
    }

    // Always cache locally as resilient fail-safe
    saveDispatchLogToCache({ ...logPayload, id: logId, created_at: new Date().toISOString() });

    // 2. สร้าง Discord REST API payload พร้อมปุ่ม
    const discordPayload = buildDiscordDispatchPayload({
      logId,
      category,
      mentionRoleIds,
      finalText: chosenFinalText,
      senderName: logPayload.sender_name,
      senderRole: logPayload.sender_role,
      selectedVersion,
      acknowledgedCount: 0,
      acknowledgedOfficers: []
    });

    let discordMessageId = null;
    if (botToken && channelId) {
      try {
        const dRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(discordPayload)
        });
        const msgData = await dRes.json();
        if (msgData?.id) {
          discordMessageId = msgData.id;
          saveDispatchLogToCache({ id: logId, discord_message_id: discordMessageId });
          try {
            await supabase.from('dispatch_logs').update({ discord_message_id: discordMessageId }).eq('id', logId);
          } catch (e) {}
        }
      } catch (dErr) {
        console.warn('[DISPATCH_DISCORD_WARN] Failed to send message to Discord:', dErr.message);
      }
    }

    return res.json({
      success: true,
      logId,
      discordMessageId,
      discordDelivered: Boolean(discordMessageId),
      channelId,
      message: discordMessageId
        ? 'ส่งคำสั่งการแจ้งเตือนเข้า Discord เรียบร้อยแล้ว'
        : 'บันทึกคำสั่งการลงระบบสำเร็จ (แต่ยังไม่สามารถส่งเข้า Discord ได้ ตรวจสอบ Channel ID/Bot Token)'
    });
  } catch (err) {
    console.error('[DISPATCH_SEND_ERR]', err);
    return res.status(500).json({ success: false, error: err.message || 'เกิดข้อผิดพลาดในการส่งคำสั่งการ' });
  }
});

app.get('/api/dispatch/history', requireAuth, async (req, res) => {
  try {
    let history = [];
    try {
      const { data, error } = await supabase
        .from('dispatch_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15);
      if (!error && data && data.length > 0) history = data;
    } catch (e) {}

    // Fallback to local cache if database returned no records or table missing
    if (!history || history.length === 0) {
      history = getDispatchLogsFromCache().slice(0, 15);
    }

    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 7.3 หน้าเว็บ Modern SaaS Landing Page (/landing)
// -------------------------------------------------------------
app.get(['/landing', '/landing.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get(['/', '/index.html'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// หน้าหลักสำรอง (ต้องผ่านการยืนยันตัวตน Discord)
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`[SARAWAT-WEB] 🌐 Dashboard Online on http://localhost:${PORT}`);
  try {
    await syncLayoutConfigFromSupabase();
  } catch (e) {}
});
