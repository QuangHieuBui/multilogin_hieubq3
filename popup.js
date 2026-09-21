const content = document.getElementById("content");

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// "New session": opens a fresh tab that the background watches for its first real navigation —
// whatever site the user goes to there gets auto-added and a brand-new profile auto-created,
// no manual "Thêm domain" step needed. See background.js's tabs.onUpdated listener.
document.getElementById("newSessionBtn").addEventListener("click", async () => {
  await send({ type: "START_AUTO_SESSION" });
  window.close();
});

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function render() {
  const tab = await currentTab();
  const domain = tab?.url ? domainOf(tab.url) : null;

  if (!domain || !tab.url.startsWith("http")) {
    content.innerHTML = `<p class="muted">Mở một trang web (http/https) để dùng extension này.</p>`;
    return;
  }

  const { domains } = await send({ type: "LIST_DOMAINS" });
  const managed = domains.find((d) => domain === d || domain.endsWith("." + d));

  if (!managed) {
    content.innerHTML = `
      <div class="domain">${domain}</div>
      <p class="muted">Domain này chưa được quản lý multi-profile.</p>
      <button id="addDomainBtn">Thêm domain này</button>
      <p class="warn">
        Lưu ý: kỹ thuật này chỉ tráo <b>cookie</b>. Nếu site lưu token đăng nhập trong
        localStorage/IndexedDB, các tab vẫn sẽ tự dùng chung một tài khoản dù bạn thêm domain
        và tạo nhiều profile. Kiểm tra bằng DevTools → Application trước khi tin tưởng vào site đó.
      </p>
    `;
    // Extension đã có quyền host cho mọi site ngay từ lúc cài (xem manifest), nên ở đây không
    // còn phải xin quyền qua chrome.permissions.request nữa — chỉ cần đăng ký domain.
    document.getElementById("addDomainBtn").addEventListener("click", async () => {
      await send({ type: "ADD_DOMAIN", domain });
      render();
    });
    return;
  }

  const { profiles } = await send({ type: "LIST_PROFILES", domain: managed });
  const { profile: activeTabProfile } = await send({ type: "GET_TAB_PROFILE", tabId: tab.id });

  const rows = Object.entries(profiles)
    .map(([id, p]) => {
      const isActive = activeTabProfile?.profileId === id;
      const badge = isActive && activeTabProfile.tag ? ` (đang dùng · #${activeTabProfile.tag})` : isActive ? " (đang dùng)" : "";
      return `
        <div class="profile-row">
          <span class="${isActive ? "active" : ""}">${p.name}${badge}</span>
          <span>
            <button data-use="${id}" ${isActive ? "disabled" : ""}>Dùng</button>
            <button data-del="${id}">Xoá</button>
          </span>
        </div>`;
    })
    .join("");

  content.innerHTML = `
    <div class="domain">${domain}</div>
    <div>${rows || '<p class="muted">Chưa có profile nào cho domain này.</p>'}</div>
    <div class="new-profile">
      <input id="newName" placeholder="Tên profile mới (vd: acc1)" />
      <button id="createBtn">Tạo</button>
    </div>
  `;

  content.querySelectorAll("[data-use]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await send({ type: "SWITCH_TAB_PROFILE", tabId: tab.id, domain: managed, profileId: btn.dataset.use });
      window.close();
    })
  );
  content.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await send({ type: "DELETE_PROFILE", domain: managed, profileId: btn.dataset.del });
      render();
    })
  );
  document.getElementById("createBtn").addEventListener("click", async () => {
    const name = document.getElementById("newName").value.trim();
    if (!name) return;
    const { id } = await send({ type: "CREATE_PROFILE", domain: managed, name });
    // Switch this tab to the fresh (empty) profile and reload so the user can log in from scratch.
    await send({ type: "SWITCH_TAB_PROFILE", tabId: tab.id, domain: managed, profileId: id });
    window.close();
  });
}

render().catch((err) => {
  content.innerHTML = `<p style="color:#c02626;font-size:12px;">Lỗi: ${err?.message || err}</p>`;
});
