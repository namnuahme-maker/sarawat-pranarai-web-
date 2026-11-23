/**
 * 🛡️ SARAWAT PRANARAI - UNIVERSAL GLOBAL LAYOUT & COMPONENT CONTROLLER
 * ควบคุม Header, Navigation Bar, Mobile Drawer, Auth Profile และ Shared Components
 * เพื่อให้ทุก Route ในระบบดึงโครงสร้างมาจากจุดเดียว (Strict UI Sync Standard)
 */

(function () {
  'use strict';

  // Shared navigation items used in the all-screen menu drawer.
  const NAV_ITEMS = [
    { id: 'home', label: 'หน้าหลัก', icon: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', href: '/' },
    { id: 'dispatch', label: '🚨 ศูนย์สั่งการด่วน & AI', icon: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>', href: 'javascript:window.openDispatchModal()', highlight: 'rose' },
    { id: 'roster', label: 'ทำเนียบสารวัตรทั้งหมด', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', href: '/?tab=roster' },
    { id: 'attendance-scan', label: 'สแกนเช็คชื่อ', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', href: '/attendance-scan', highlight: 'emerald' },
    { id: 'analytics', label: 'สถิติ & คลังข้อมูล', icon: '<path d="M4 19V5m0 14h16M8 15v-4m4 4V7m4 8V9m4 6v-6"/>', href: '/analytics', highlight: 'cyan' },
    { id: 'card-studio', label: 'ทำบัตร', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M6 16c.6-1.3 1.3-2 2-2s1.4.7 2 2m3-4h5m-5 3h5"/>', href: '/card-studio' },
    { id: 'lost-found', label: 'ของหาย', icon: '<path d="m4 7 8-4 8 4v10l-8 4-8-4z"/><path d="m4 7 8 4 8-4m-8 4v10"/>', href: '/lost-found' }
  ];

  // Detect Current Active Route
  function getActiveNavId() {
    const path = window.location.pathname.toLowerCase();
    if ((path === '/' || path === '/index.html') && new URLSearchParams(window.location.search).get('tab') === 'roster') {
      return 'roster';
    }
    if (path === '/' || path === '/index.html' || path === '/dashboard' || path === '/dashboard.html' || path === '/app' || path === '/console') {
      return 'home';
    }
    for (const item of NAV_ITEMS) {
      if (item.href !== '/' && path.startsWith(item.href)) {
        return item.id;
      }
    }
    return '';
  }

  // Create Header HTML
  function renderHeaderHTML() {
    const activeId = getActiveNavId();
    const navLinks = NAV_ITEMS.map(item => `
      <a href="${item.href}" class="global-nav-link${item.id === activeId ? ' is-active' : ''}"${item.id === activeId ? ' aria-current="page"' : ''}>
        <svg class="global-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>
        <span>${item.label}</span>
        <svg class="global-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </a>
    `).join('');

    return `
      <header id="sarawat-global-header" class="sarawat-global-header sticky top-0 z-50 border-b border-tactical-border px-3 sm:px-4 py-2 sm:py-2.5 w-full max-w-full">
        <div class="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-3 w-full flex-nowrap">
          <div class="flex items-center gap-2 sm:gap-3 min-w-0">
            <button id="global-nav-toggle" type="button" onclick="window.toggleSarawatNav()" class="global-nav-toggle" aria-label="เปิดเมนูหลัก" aria-expanded="false" aria-controls="mobile-nav-drawer" title="เมนูหลัก">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <a href="/" class="flex items-center gap-2 sm:gap-2.5 min-w-0 group flex-shrink-0">
              <div class="relative flex-shrink-0">
                <img src="/assets/logo.png" alt="ตราสารวัตรนักเรียน โรงเรียนพระนารายณ์" class="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 object-contain" onerror="this.src='/assets/school_emblem.png'">
                <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-emerald-500 rounded-full border-2 border-black live-dot"></span>
              </div>
              <div class="leading-tight min-w-0">
                <div class="flex items-center gap-1 sm:gap-1.5 flex-nowrap">
                  <span class="font-bold text-xs sm:text-sm tracking-wide text-slate-100 uppercase font-tactical truncate">SARAWAT PRANARAI</span>
                  <span class="hidden sm:inline-flex text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 font-semibold">TACTICAL-OS</span>
                </div>
                <p class="text-[10px] sm:text-[11px] text-slate-400 hidden md:block truncate">ศูนย์บัญชาการสารวัตรนักเรียน • โรงเรียนพระนารายณ์</p>
              </div>
            </a>
          </div>

          <!-- Page actions and account controls remain available beside the menu. -->
          <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-nowrap" id="header-action-container">
            <!-- Optional Page-Specific Action Slot -->
            <div id="header-page-action-slot" class="flex items-center gap-1.5"></div>

          </div>
        </div>

        <dialog id="mobile-nav-drawer" class="global-nav-drawer" aria-labelledby="global-nav-heading">
          <div id="mobile-nav-drawer-content" class="global-nav-drawer-content">
            <div class="global-nav-drawer-heading">
              <div>
                <h2 id="global-nav-heading">เมนูหลัก</h2>
                <p>SARAWAT PRANARAI</p>
              </div>
              <button type="button" class="global-nav-close" onclick="closeGlobalNav()" aria-label="ปิดเมนู" autofocus>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </div>
            <nav id="main-nav-bar" class="global-nav-list" aria-label="เมนูระบบ">
              ${navLinks}
            </nav>
            <div class="global-nav-secondary">
              <button type="button" onclick="window.openFeatureGuideFromNav()" class="global-nav-secondary-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.1 1-1.8 1.3-1.8 2.7m0 3h.01"/></svg>
                <span>คู่มือการใช้งาน</span>
              </button>
              <a href="https://discord.com/app" target="_blank" rel="noopener noreferrer" class="global-nav-secondary-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7.5a13 13 0 0 1 8 0m-9 1.2a11 11 0 0 1 10 0M6 18c3.8 2 8.2 2 12 0l1.5-8.5A14 14 0 0 0 16 7l-1 1.5a10 10 0 0 0-6 0L8 7a14 14 0 0 0-3.5 2.5L6 18Z"/><circle cx="9" cy="13" r=".8"/><circle cx="15" cy="13" r=".8"/></svg>
                <span>เปิด Discord</span>
                <span class="global-nav-external" aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </dialog>
      </header>
    `;
  }

  function finishClosingNav(drawer) {
    if (!drawer || !drawer.open || !drawer.classList.contains('is-closing')) return;
    drawer.close();
    drawer.classList.remove('is-closing');
  }

  window.closeGlobalNav = function () {
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!drawer || !drawer.open || drawer.classList.contains('is-closing')) return;
    drawer.classList.add('is-closing');
    window.setTimeout(() => finishClosingNav(drawer), 220);
  };

  window.openFeatureGuideFromNav = function () {
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!drawer || !drawer.open) {
      window.SarawatUI?.openFeatureGuideModal();
      return;
    }
    drawer.addEventListener('close', () => window.SarawatUI?.openFeatureGuideModal(), { once: true });
    window.closeGlobalNav();
  };

  // Kept as a compatibility name for page scripts that already call this function.
  window.toggleSarawatNav = function () {
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!drawer) return;
    if (drawer.open) {
      window.closeGlobalNav();
      return;
    }

    drawer.classList.remove('is-closing');
    drawer.showModal();
    window.requestAnimationFrame(() => {
      if (drawer.open && !drawer.classList.contains('is-closing')) {
        drawer.classList.add('is-visible');
      }
    });
    const toggle = document.getElementById('global-nav-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'ปิดเมนูหลัก');
    }
  };

  window.toggleMobileNav = window.toggleSarawatNav;

  document.addEventListener('click', (event) => {
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!drawer || !drawer.open || event.target !== drawer) return;
    const bounds = drawer.getBoundingClientRect();
    const clickedInside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!clickedInside) window.closeGlobalNav();
  });

  document.addEventListener('cancel', (event) => {
    if (event.target?.id === 'mobile-nav-drawer') {
      event.preventDefault();
      window.closeGlobalNav();
    }
  }, true);

  document.addEventListener('transitionend', (event) => {
    if (event.target?.id === 'mobile-nav-drawer' && event.propertyName === 'transform') {
      finishClosingNav(event.target);
    }
  });

  document.addEventListener('close', (event) => {
    if (event.target?.id !== 'mobile-nav-drawer') return;
    const toggle = document.getElementById('global-nav-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'เปิดเมนูหลัก');
    }
    event.target.classList.remove('is-visible');
  }, true);

  // Left Quick Menu Toggle (Annotation 6)
  window.toggleLeftQuickMenu = function (e) {
    if (e) e.stopPropagation();
    const popover = document.getElementById('left-quick-menu-popover');
    if (popover) {
      popover.classList.toggle('hidden');
    }
  };

  // Close Left Quick Menu when clicking outside
  document.addEventListener('click', (e) => {
    const popover = document.getElementById('left-quick-menu-popover');
    if (popover && !popover.classList.contains('hidden')) {
      if (!popover.contains(e.target)) {
        popover.classList.add('hidden');
      }
    }
  });

  // Mount Header to Document
  function mountGlobalHeader() {
    const existingHeader = document.querySelector('header');
    const headerHTML = renderHeaderHTML();

    if (existingHeader) {
      existingHeader.outerHTML = headerHTML;
    } else {
      document.body.insertAdjacentHTML('afterbegin', headerHTML);
    }

    // Attach Toast Container if missing
    if (!document.getElementById('sarawat-toast-container')) {
      const toastContainer = document.createElement('div');
      toastContainer.id = 'sarawat-toast-container';
      document.body.appendChild(toastContainer);
    }

    // Inject Motion Engine if not already present
    if (!document.getElementById('sarawat-motion-script')) {
      const motionScript = document.createElement('script');
      motionScript.id = 'sarawat-motion-script';
      motionScript.src = '/assets/js/motion.js';
      motionScript.defer = true;
      document.head.appendChild(motionScript);
    }
  }

  // User Profile Loader via /api/auth/me
  async function loadUserProfile() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.loggedIn || !data.user) return;

      const user = data.user;
      window.currentUser = user;
      document.dispatchEvent(new CustomEvent('sarawat:user_loaded', { detail: user }));

      // Do not inject badge on attendance-scan to preserve camera viewport
      if (window.location.pathname.includes('attendance-scan')) return;
      if (document.getElementById('nav-user-profile-badge')) return;

      const headerActions = document.getElementById('header-action-container');
      if (!headerActions) return;

      const avatarUrl = user.avatar || '/assets/logo.png';
      const displayName = user.displayName || user.username || 'สารวัตร';
      const isSysAdmin = Boolean(user.isAdmin || user.role === 'ADMIN' || (user.rank && user.rank.includes('ดูแล')));
      const isTeacher = Boolean(user.isTeacher || user.role === 'TEACHER' || (user.rank && user.rank.includes('ครู')));
      let rankTitle = user.rank;
      if (!rankTitle || isSysAdmin || isTeacher) {
        if (isSysAdmin) {
          rankTitle = '⚡ ผู้ดูแลระบบ';
        } else if (isTeacher) {
          rankTitle = '👨‍🏫 ครูที่ปรึกษา';
        } else if (user.isLeader) {
          rankTitle = '👑 ผู้บริหาร/หัวหน้า';
        } else {
          rankTitle = '🛡️ สารวัตรนักเรียน';
        }
      }

      let badgeRoleColor = 'text-amber-400/90';
      let badgeBorderColor = 'border-indigo-500/70';
      let dotColor = 'bg-emerald-500';

      if (isSysAdmin) {
        badgeRoleColor = 'text-rose-400 font-bold';
        badgeBorderColor = 'border-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]';
        dotColor = 'bg-rose-500 shadow-[0_0_6px_#f43f5e]';
      } else if (isTeacher) {
        badgeRoleColor = 'text-amber-300 font-bold';
        badgeBorderColor = 'border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
        dotColor = 'bg-amber-400 shadow-[0_0_6px_#f59e0b]';
      }

      // 🚨 Inject Tactical Dispatch Button in Global Header
      const canManage = Boolean(user.canManageMembers || user.isAdmin || user.isTeacher || user.isPresident || user.isVicePresident || isSysAdmin || isTeacher || ['ADMIN', 'TEACHER', 'PRESIDENT', 'VICE_PRESIDENT'].includes(user.role));
      
      if (canManage && !document.getElementById('global-dispatch-header-btn')) {
        const dispatchBtn = document.createElement('button');
        dispatchBtn.id = 'global-dispatch-header-btn';
        dispatchBtn.type = 'button';
        dispatchBtn.className = 'px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white text-[11px] sm:text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-lg shadow-red-500/25 active:scale-95 animate-pulse flex-shrink-0';
        dispatchBtn.title = 'ศูนย์สั่งการด่วน & แจ้งเตือนเสียง AI';
        dispatchBtn.innerHTML = `<span>🚨</span><span class="hidden sm:inline tracking-wider uppercase">สั่งการด่วน</span>`;
        dispatchBtn.onclick = () => {
          if (typeof window.openDispatchModal === 'function') {
            window.openDispatchModal();
          } else {
            window.location.href = '/?openDispatch=1';
          }
        };
        headerActions.insertBefore(dispatchBtn, headerActions.firstChild);
      }

      const profileBadge = document.createElement('div');
      profileBadge.id = 'nav-user-profile-badge';
      profileBadge.className = 'relative flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2.5 border-l border-slate-800/80 flex-shrink-0';
      profileBadge.innerHTML = `
        <div role="button" tabindex="0" class="flex items-center gap-1.5 sm:gap-2 cursor-pointer group select-none" title="คลิกเพื่อดูโปรไฟล์และจัดการข้อมูลส่วนตัว" onclick="window.toggleUserProfileDropdown(event)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.toggleUserProfileDropdown(event);}">
          <div class="relative flex-shrink-0">
            <img src="${avatarUrl}" alt="${displayName}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-full border ${badgeBorderColor} shadow-md object-cover flex-shrink-0 group-hover:border-amber-400 group-hover:scale-105 transition" onerror="this.src='/assets/logo.png'">
            <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${dotColor} border border-black live-dot"></span>
          </div>
          <div class="hidden md:flex flex-col text-left leading-tight">
            <div class="flex items-center gap-1">
              <span class="text-xs font-semibold text-slate-100 truncate max-w-[110px] group-hover:text-amber-300 transition">${displayName}</span>
              <span class="text-[9px] text-slate-400 group-hover:text-amber-400 transition">▾</span>
            </div>
            <span class="text-[10px] ${badgeRoleColor} font-mono truncate max-w-[110px]">${rankTitle}</span>
          </div>
        </div>

        <!-- User Profile Dropdown Popover -->
        <div id="user-profile-dropdown" class="hidden absolute right-0 top-full mt-2 w-72 sm:w-80 max-w-[calc(100vw-20px)] bg-slate-900/95 border border-tactical-border/90 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop-blur-xl p-4 z-[100] text-slate-200 font-sans transition-all duration-200">
          
          <!-- Header Profile Info -->
          <div class="flex items-center gap-3 pb-3 border-b border-tactical-border/70">
            <div class="relative flex-shrink-0">
              <img src="${avatarUrl}" alt="${displayName}" class="w-12 h-12 rounded-full border-2 ${badgeBorderColor} object-cover shadow-lg" onerror="this.src='/assets/logo.png'">
              <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full ${dotColor} border-2 border-slate-900"></span>
            </div>
            <div class="min-w-0 flex-1 text-left">
              <div class="font-bold text-sm text-slate-100 truncate">${displayName}</div>
              <div class="text-xs text-amber-300/90 font-medium truncate">${user.nickname ? `ชื่อเล่น: ${user.nickname}` : ''} ${user.dutyId ? `<span class="font-mono text-amber-400">[${user.dutyId}]</span>` : ''}</div>
              <div class="mt-1 flex items-center gap-1.5 flex-wrap">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${isSysAdmin ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : (isTeacher ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-blue-500/20 text-blue-300 border border-blue-500/40')}">
                  ${rankTitle}
                </span>
              </div>
            </div>
          </div>

          <!-- Quick Info Grid -->
          <div class="grid grid-cols-2 gap-2 py-3 text-xs border-b border-tactical-border/70 text-slate-300">
            <div class="p-2 rounded-lg bg-tactical-950/70 border border-tactical-border/60">
              <div class="text-[10px] text-slate-400 font-mono">ชั้น / ห้อง</div>
              <div class="font-bold text-slate-200 truncate">${user.gradeClass ? `ม.${user.gradeClass}` : (isTeacher ? 'ครูที่ปรึกษา' : '-')} ${user.studentNo ? `(#${user.studentNo})` : ''}</div>
            </div>
            <div class="p-2 rounded-lg bg-tactical-950/70 border border-tactical-border/60">
              <div class="text-[10px] text-slate-400 font-mono">ผลัดเวร</div>
              <div class="font-bold text-slate-200 truncate">${user.dutyDay || (isTeacher ? 'ทุกวัน' : '-')}</div>
            </div>
            <div class="col-span-2 p-2 rounded-lg bg-tactical-950/70 border border-tactical-border/60 flex items-center justify-between">
              <span class="text-[10px] text-slate-400 font-mono">เบอร์โทรศัพท์:</span>
              <span class="font-mono font-bold text-slate-200">${user.phoneNumber || '-'}</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="pt-3 flex flex-col gap-2">
            <button onclick="window.handleOpenMyProfileEdit(event)" class="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-98 transition">
              <span>✏️</span> แก้ไขข้อมูลของฉัน
            </button>

            <button onclick="window.handleOpenMyCard(event)" class="w-full py-2 px-3 rounded-xl bg-tactical-850 hover:bg-tactical-800 border border-tactical-border text-slate-200 text-xs flex items-center justify-center gap-1.5 active:scale-98 transition">
              <span>🪪</span> เปิดดูบัตรประจำตัวสารวัตร
            </button>

            <a href="/logout" class="w-full py-1.5 px-3 rounded-lg text-center text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition mt-1">
              🚪 ออกจากระบบ
            </a>
          </div>
        </div>
      `;

      // Insert before mobile hamburger button
      const hamburger = headerActions.querySelector('button[onclick*="toggleMobileNav"]');
      if (hamburger) {
        headerActions.insertBefore(profileBadge, hamburger);
      } else {
        headerActions.appendChild(profileBadge);
      }
    } catch (e) {
      console.warn('[GLOBAL-LAYOUT] Profile load error:', e);
    }
  }

  // Toggle User Profile Dropdown
  window.toggleUserProfileDropdown = function (e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('user-profile-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  };

  // Close User Profile Dropdown when clicking outside or pressing Escape
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('user-profile-dropdown');
    const badge = document.getElementById('nav-user-profile-badge');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      if (!dropdown.contains(e.target) && !badge.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const dropdown = document.getElementById('user-profile-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
      }
    }
  });

  // Action: Open Self Edit Modal
  window.handleOpenMyProfileEdit = function (e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('user-profile-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    const u = window.currentUser;
    if (!u) return;

    // ถ้าอยู่ในหน้าหลักที่มี openCardModal อยู่แล้ว
    if (typeof window.openCardModal === 'function') {
      const targetId = u.memberId || (window.allMembers && window.allMembers.find(m => m.discord_id === u.id || m.duty_id === u.dutyId)?.id);
      if (targetId) {
        window.openCardModal(targetId);
        setTimeout(() => {
          if (typeof window.toggleMemberEditMode === 'function') {
            window.toggleMemberEditMode(true);
          }
        }, 150);
        return;
      }
    }

    // ถ้าอยู่หน้าอื่น ให้ย้ายไปหน้าหลักพร้อมคำสั่งเปิดโหมดแก้ไขทันที
    const memberParam = u.memberId ? `&memberId=${u.memberId}` : '';
    window.location.href = `/?edit=self${memberParam}`;
  };

  // Action: Open Official ID Card
  window.handleOpenMyCard = function (e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('user-profile-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    const u = window.currentUser;
    if (!u) return;

    if (typeof window.openCardModal === 'function') {
      const targetId = u.memberId || (window.allMembers && window.allMembers.find(m => m.discord_id === u.id || m.duty_id === u.dutyId)?.id);
      if (targetId) {
        window.openCardModal(targetId);
        return;
      }
    }

    const cardId = u.memberId || u.id;
    window.open(`/card?id=${cardId}`, '_blank');
  };

  // Universal UI Helpers Object
  window.SarawatUI = {
    toast: function (message, type = 'info', duration = 3500) {
      const container = document.getElementById('sarawat-toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'sarawat-toast-item';

      let icon = 'ℹ️';
      let borderClass = 'border-tactical-border';
      if (type === 'success') {
        icon = '✅';
        borderClass = 'border-emerald-500/50 text-emerald-300';
      } else if (type === 'error') {
        icon = '🚨';
        borderClass = 'border-rose-500/50 text-rose-300';
      } else if (type === 'warning') {
        icon = '⚠️';
        borderClass = 'border-amber-500/50 text-amber-300';
      }

      toast.classList.add(borderClass);
      toast.innerHTML = `<span class="text-base">${icon}</span><span class="flex-1">${message}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(0.5rem) scale(0.95)';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    },

    modal: function ({ title, bodyHtml, confirmText = 'ตกลง', cancelText = 'ยกเลิก', onConfirm }) {
      const existing = document.getElementById('sarawat-universal-modal');
      if (existing) existing.remove();

      const modalEl = document.createElement('div');
      modalEl.id = 'sarawat-universal-modal';
      modalEl.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4';
      modalEl.innerHTML = `
        <div class="bg-tactical-900 border border-tactical-border rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-tactical-border pb-3 mb-4">
            <h3 class="font-bold text-slate-100 text-sm sm:text-base flex items-center gap-2">
              <span class="text-amber-400">🛡️</span> ${title}
            </h3>
            <button onclick="document.getElementById('sarawat-universal-modal').remove()" class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
          </div>
          <div class="text-slate-300 text-xs sm:text-sm space-y-3 leading-relaxed mb-5">
            ${bodyHtml}
          </div>
          <div class="flex justify-end gap-2 pt-3 border-t border-tactical-border">
            ${cancelText ? `<button onclick="document.getElementById('sarawat-universal-modal').remove()" class="btn-tactical btn-tactical-subtle">${cancelText}</button>` : ''}
            <button id="sarawat-modal-confirm-btn" class="btn-tactical btn-tactical-primary">${confirmText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);
      const confirmBtn = document.getElementById('sarawat-modal-confirm-btn');
      if (confirmBtn) {
        confirmBtn.onclick = () => {
          modalEl.remove();
          if (typeof onConfirm === 'function') onConfirm();
        };
      }
    },

    openFeatureGuideModal: function () {
      this.modal({
        title: 'แนะนำฟังก์ชันศูนย์บัญชาการสารวัตรนักเรียน',
        bodyHtml: `
          <div class="space-y-3 text-xs sm:text-sm">
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-amber-300">🛡️ หน้าหลัก (Central Command):</span>
              <p class="text-slate-400 text-xs mt-1">มอนิเตอร์กำลังพลสารวัตร, คดีเหตุการณ์เร่งด่วน, ตารางเวรปฏิบัติหน้าที่ และสถานะบอท Discord 24 ชั่วโมง</p>
            </div>
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-emerald-300">⚡ สแกนเช็คชื่อ (Multi-Shot):</span>
              <p class="text-slate-400 text-xs mt-1">ใช้กล้องสแกนตรวจใบตารางเช็คชื่อ A4 ดึง QR Anchor อัตโนมัติและส่งข้อมูลขึ้นระบบทันที</p>
            </div>
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-cyan-300">📊 สถิติ & คลังข้อมูล (Analytics):</span>
              <p class="text-slate-400 text-xs mt-1">วิเคราะห์แนวโน้มการลาเวร สถิติการตรวจตรา รายงานสรุปผลไตรมาส</p>
            </div>
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-indigo-300">🎨 ทำบัตร (Card Studio):</span>
              <p class="text-slate-400 text-xs mt-1">ออกแบบและพิมพ์บัตรประจำตัวสารวัตรนักเรียนมาตรฐานสากล CR80 Vertical</p>
            </div>
          </div>
        `,
        confirmText: 'รับทราบ',
        cancelText: null
      });
    }
  };

  // Backward compatibility aliases
  window.openFeatureGuideModal = function () {
    window.SarawatUI.openFeatureGuideModal();
  };

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountGlobalHeader();
      loadUserProfile();
    });
  } else {
    mountGlobalHeader();
    loadUserProfile();
  }

})();
