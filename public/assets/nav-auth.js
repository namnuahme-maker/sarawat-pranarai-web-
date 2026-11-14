/**
 * 🛡️ SARAWAT PRANARAI - NAV AUTHENTICATION & RESPONSIVE CONTROLLER
 * จัดการสถานะการเข้าสู่ระบบผ่าน Discord และแสดงแถบโปรไฟล์บน Header & Mobile Drawer
 * ป้องกันปัญหา Horizontal Overflow บนอุปกรณ์มือถือ (100% Mobile Responsive)
 */

(function () {
  // ป้องกันหน้าจอล้นแนวนอนบนมือถือทุกหน้า (Global Overflow Protection)
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    html, body {
      overflow-x: hidden !important;
      max-width: 100vw !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
  `;
  document.head.appendChild(styleEl);

  async function checkUserAuth() {
    const pathname = window.location.pathname;
    const isPublicPage = pathname.includes('login') || pathname.includes('verify') || pathname.includes('landing');

    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();

      if (!data || !data.loggedIn) {
        if (!isPublicPage) {
          // ไม่ได้ล็อกอิน -> พาไปหน้า Login พร้อม Return URL
          const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?redirect=${returnUrl}`;
        }
        return;
      }

      // บันทึก User Profile ใน Window
      window.currentUser = data.user;

      // แทรกแถบโปรไฟล์ใน Header (Desktop & Mobile)
      injectUserProfileHeader(data.user);

    } catch (err) {
      console.warn('[NAV-AUTH] Auth check failed:', err);
      if (!isPublicPage) {
        window.location.href = '/login';
      }
    }
  }

  function injectUserProfileHeader(user) {
    // หาตำแหน่งแทรกใน Header
    const headerActions = document.querySelector('header .flex.items-center.gap-2') ||
                          document.querySelector('header .flex.items-center.gap-1\\.5') ||
                          document.querySelector('header .flex.items-center.gap-3');
    if (!headerActions) return;

    // ถ้ามีอยู่แล้วให้ข้าม
    if (document.getElementById('nav-user-profile-badge')) return;

    const rankBadgeClass = user.isLeader 
      ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' 
      : 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60';

    const rankTitle = user.rank || (user.isLeader ? '👑 ผู้บริหาร/หัวหน้า' : '🛡️ สารวัตรนักเรียน');

    // 1. แถบโปรไฟล์บน Top Bar (กะทัดรัด ไม่ดันปุ่ม Hamburger ตกขอบจอมือถือ)
    const profileWrapper = document.createElement('div');
    profileWrapper.id = 'nav-user-profile-badge';
    profileWrapper.className = 'flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2.5 border-l border-slate-800/80 flex-shrink-0';

    profileWrapper.innerHTML = `
      <div class="flex items-center gap-1.5 sm:gap-2 cursor-pointer group" title="สารวัตร: ${user.displayName} (${user.username})" onclick="typeof toggleMobileNav === 'function' ? toggleMobileNav() : null">
        <div class="relative flex-shrink-0">
          <img src="${user.avatar}" alt="${user.displayName}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-indigo-500/70 shadow-md object-cover flex-shrink-0 group-hover:border-amber-400 transition" onerror="this.src='/assets/logo.png'">
          <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-black"></span>
        </div>
        <div class="hidden md:flex flex-col text-left leading-tight">
          <span class="text-xs font-semibold text-slate-100 truncate max-w-[110px]">${user.displayName}</span>
          <span class="text-[9px] px-1.5 py-0.2 rounded border ${rankBadgeClass} font-mono font-medium inline-block truncate max-w-[95px]">${rankTitle}</span>
        </div>
      </div>
      <a href="/logout" title="ออกจากระบบ (Logout)" class="hidden md:inline-flex p-1.5 sm:px-2 sm:py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-800/40 text-xs items-center gap-1 transition active:scale-95" onclick="return confirm('ยืนยันออกจากระบบศูนย์บัญชาการสารวัตรหรือไม่?')">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        <span class="hidden xl:inline">ออก</span>
      </a>
    `;

    // แทรกก่อนปุ่มเมนูดรอปดาวน์มือถือ (ถ้ามี) หรือต่อท้าย
    const mobileBtn = headerActions.querySelector('button[onclick*="toggleMobileNav"]') ||
                      headerActions.querySelector('button[aria-label="Toggle navigation"]');
    if (mobileBtn) {
      headerActions.insertBefore(profileWrapper, mobileBtn);
    } else {
      headerActions.appendChild(profileWrapper);
    }

    // 2. แทรกการ์ดโปรไฟล์ฉบับเต็มและปุ่มออกจากระบบไว้ที่หัวแถวของ Mobile Drawer
    injectMobileDrawerUserCard(user, rankTitle, rankBadgeClass);
  }

  function injectMobileDrawerUserCard(user, rankTitle, rankBadgeClass) {
    const mobileDrawer = document.getElementById('mobile-nav-drawer') || 
                         document.getElementById('mobile-bodycam-nav') ||
                         document.getElementById('mobile-menu') ||
                         document.querySelector('.mobile-nav-menu');
    if (!mobileDrawer) return;
    if (document.getElementById('mobile-drawer-user-card')) return;

    const userCard = document.createElement('div');
    userCard.id = 'mobile-drawer-user-card';
    userCard.className = 'col-span-2 p-2.5 rounded-xl bg-tactical-950/90 border border-indigo-500/30 flex items-center justify-between mb-1 shadow-inner';
    userCard.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0">
        <img src="${user.avatar}" alt="${user.displayName}" class="w-9 h-9 rounded-full border border-indigo-500/70 object-cover flex-shrink-0 shadow" onerror="this.src='/assets/logo.png'">
        <div class="min-w-0">
          <div class="text-xs font-bold text-white truncate">${user.displayName}</div>
          <span class="text-[9px] px-1.5 py-0.2 rounded border ${rankBadgeClass} font-mono font-medium inline-block truncate max-w-[150px]">${rankTitle}</span>
        </div>
      </div>
      <a href="/logout" class="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/50 text-xs font-semibold flex items-center gap-1 transition flex-shrink-0 active:scale-95 shadow" onclick="return confirm('ยืนยันออกจากระบบศูนย์บัญชาการสารวัตรหรือไม่?')">
        <span>🚪</span> ออก
      </a>
    `;

    mobileDrawer.insertBefore(userCard, mobileDrawer.firstChild);
  }

  // เรียกทำงานทันทีที่ DOM พร้อม
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkUserAuth);
  } else {
    checkUserAuth();
  }
})();
