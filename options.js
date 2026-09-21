function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = kind ? `status ${kind}` : "status";
}

async function render() {
  const { domains } = await send({ type: "LIST_DOMAINS" });
  const list = document.getElementById("list");
  list.innerHTML = domains.length
    ? domains.map((d) => `<li>${d} <button data-remove="${d}">Xoá</button></li>`).join("")
    : `<li style="color:#666;">Chưa có domain nào.</li>`;

  list.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const domain = btn.dataset.remove;
      await send({ type: "REMOVE_DOMAIN", domain });
      render();
    })
  );
}

async function addDomain(domain) {
  const addBtn = document.getElementById("addBtn");
  addBtn.disabled = true;
  try {
    const res = await send({ type: "ADD_DOMAIN", domain });
    if (res?.error) {
      setStatus(`Lỗi khi thêm domain: ${res.error}`, "error");
      return;
    }
    document.getElementById("domainInput").value = "";
    setStatus(`Đã thêm ${domain}. Mở tab tới domain đó, bấm icon extension để tạo profile.`, "ok");
    render();
  } catch (err) {
    setStatus(`Lỗi: ${err?.message || err}`, "error");
  } finally {
    addBtn.disabled = false;
  }
}

document.getElementById("addBtn").addEventListener("click", () => {
  const raw = document.getElementById("domainInput").value.trim();
  const domain = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain) return;
  addDomain(domain);
});

render();
