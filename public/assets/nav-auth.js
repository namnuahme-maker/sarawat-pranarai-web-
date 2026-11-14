/**
 * 🛡️ SARAWAT PRANARAI - NAV AUTHENTICATION CONTROLLER
 * จัดการสถานะการเข้าสู่ระบบผ่าน Discord และแสดงแถบโปรไฟล์บน Header
 */

(function () {
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

      // แทรกแถบโปรไฟล์ใน Header
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
                          document.querySelector('header .flex.items-center.gap-3');
    if (!headerActions) return;

    // ถ้ามีอยู่แล้วให้ข้าม
    if (document.getElementById('nav-user-profile-badge')) return;

    const rankBadgeClass = user.isLeader 
      ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' 
      : 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60';

    const rankTitle = user.rank || (user.isLeader ? '👑 ผู้บริหาร/หัวหน้า' : '🛡️ สารวัตรนักเรียน');

    const profileWrapper = document.createElement('div');
    profileWrapper.id = 'nav-user-profile-badge';
    profileWrapper.className = 'flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-700/60 flex-shrink-0';

    profileWrapper.innerHTML = `
      <div class="flex items-center gap-2" title="เข้าสู่ระบบในชื่อ: ${user.displayName} (${user.username})">
        <img src="${user.avatar}" alt="${user.displayName}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-indigo-500/60 shadow-md object-cover flex-shrink-0">
        <div class="hidden md:flex flex-col text-left leading-tight">
          <span class="text-xs font-semibold text-slate-100 truncate max-w-[110px]">${user.displayName}</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded border ${rankBadgeClass} font-medium inline-block truncate max-w-[95px]">${rankTitle}</span>
        </div>
      </div>
      <a href="/logout" title="ออกจากระบบ (Logout)" class="p-1.5 sm:px-2 sm:py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-800/40 text-xs flex items-center gap-1 transition active:scale-95" onclick="return confirm('ยืนยันออกจากระบบศูนย์บัญชาการสารวัตรหรือไม่?')">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        <span class="hidden xl:inline">ออก</span>
      </a>
    `;

    // แทรกก่อนปุ่มเมนูดรอปดาวน์มือถือ (ถ้ามี) หรือต่อท้าย
    const mobileBtn = headerActions.querySelector('button[onclick*="toggleMobileNav"]');
    if (mobileBtn) {
      headerActions.insertBefore(profileWrapper, mobileBtn);
    } else {
      headerActions.appendChild(profileWrapper);
    }
  }

  // เรียกทำงานทันทีที่ DOM พร้อม
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkUserAuth);
  } else {
    checkUserAuth();
  }
})();
