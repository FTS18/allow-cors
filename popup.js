document.addEventListener("DOMContentLoaded", () => {
  const toggleBypass = document.getElementById("toggleBypass");
  const statusVal = document.getElementById("statusVal");
  const counterVal = document.getElementById("counterVal");
  const resetCounter = document.getElementById("resetCounter");

  const chkCredentials = document.getElementById("chkCredentials");
  const chkCsp = document.getElementById("chkCsp");
  const chkXFrame = document.getElementById("chkXFrame");

  const btnBlocklist = document.getElementById("btnBlocklist");
  const btnAllowlist = document.getElementById("btnAllowlist");
  const btnQuickToggle = document.getElementById("btnQuickToggle");
  const btnAddDomain = document.getElementById("btnAddDomain");
  const txtDomain = document.getElementById("txtDomain");

  const selTimer = document.getElementById("selTimer");
  const countdownRow = document.getElementById("countdownRow");
  const countdownVal = document.getElementById("countdownVal");

  const txtRedirFrom = document.getElementById("txtRedirFrom");
  const txtRedirTo = document.getElementById("txtRedirTo");
  const btnAddRedir = document.getElementById("btnAddRedir");
  const redirectsList = document.getElementById("redirectsList");

  let countdownInterval = null;

  const chkSharedArray = document.getElementById("chkSharedArray");
  const chkStripHeaders = document.getElementById("chkStripHeaders");

  // Load and apply initial state from local storage
  chrome.storage.local.get(
    ["enabled", "requestCount", "allowCredentials", "stripCsp", "stripXFrame", "mode", "customDomains", "redirects", "timerMinutes", "alarmEndTime", "stripSharedArray", "stripRefererOrigin"],
    (res) => {
      const enabled = res.enabled !== false;
      toggleBypass.checked = enabled;
      updateStatusUI(enabled);

      counterVal.textContent = res.requestCount || 0;

      chkCredentials.checked = res.allowCredentials !== false;
      chkCsp.checked = res.stripCsp === true;
      chkXFrame.checked = res.stripXFrame === true;
      chkSharedArray.checked = res.stripSharedArray === true;
      chkStripHeaders.checked = res.stripRefererOrigin === true;

      const mode = res.mode || "blocklist";
      updateModeUI(mode);

      renderDomains(res.customDomains || []);
      renderRedirects(res.redirects || []);

      selTimer.value = res.timerMinutes || "never";
      
      if (enabled && res.alarmEndTime > Date.now()) {
        startCountdown(res.alarmEndTime);
      } else {
        countdownRow.style.display = "none";
      }
    }
  );

  // Sync state changes in real-time when popup is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.requestCount) {
        counterVal.textContent = changes.requestCount.newValue;
      }
      if (changes.enabled) {
        const isEnabled = changes.enabled.newValue;
        toggleBypass.checked = isEnabled;
        updateStatusUI(isEnabled);
        if (!isEnabled) {
          stopCountdown();
        }
      }
      if (changes.alarmEndTime) {
        const end = changes.alarmEndTime.newValue;
        if (end > Date.now()) {
          startCountdown(end);
        } else {
          stopCountdown();
        }
      }
    }
  });

  // Global bypass toggle handler
  toggleBypass.addEventListener("change", (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ enabled: isEnabled }, () => {
      updateStatusUI(isEnabled);
      if (!isEnabled) {
        chrome.alarms.clear("autoDisableAlarm");
        chrome.storage.local.set({ alarmEndTime: 0, timerMinutes: "never" });
        selTimer.value = "never";
        stopCountdown();
      }
    });
  });

  // Timer dropdown selection handler
  selTimer.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "never") {
      chrome.alarms.clear("autoDisableAlarm");
      chrome.storage.local.set({ timerMinutes: "never", alarmEndTime: 0 }, () => {
        stopCountdown();
      });
    } else {
      const minutes = parseInt(val);
      const endTime = Date.now() + minutes * 60 * 1000;
      
      // Save state and configure alarms trigger
      chrome.storage.local.set({ timerMinutes: val, alarmEndTime: endTime }, () => {
        chrome.alarms.create("autoDisableAlarm", { delayInMinutes: minutes });
        startCountdown(endTime);
      });
    }
  });

  // Counter reset handler
  resetCounter.addEventListener("click", () => {
    chrome.storage.local.set({ requestCount: 0 }, () => {
      counterVal.textContent = "0";
    });
  });

  // Advanced toggles
  chkCredentials.addEventListener("change", (e) => {
    chrome.storage.local.set({ allowCredentials: e.target.checked });
  });

  chkCsp.addEventListener("change", (e) => {
    chrome.storage.local.set({ stripCsp: e.target.checked });
  });

  chkXFrame.addEventListener("change", (e) => {
    chrome.storage.local.set({ stripXFrame: e.target.checked });
  });

  chkSharedArray.addEventListener("change", (e) => {
    chrome.storage.local.set({ stripSharedArray: e.target.checked });
  });

  chkStripHeaders.addEventListener("change", (e) => {
    chrome.storage.local.set({ stripRefererOrigin: e.target.checked });
  });

  // Mode select buttons
  btnBlocklist.addEventListener("click", () => {
    chrome.storage.local.set({ mode: "blocklist" }, () => {
      updateModeUI("blocklist");
    });
  });

  btnAllowlist.addEventListener("click", () => {
    chrome.storage.local.set({ mode: "allowlist" }, () => {
      updateModeUI("allowlist");
    });
  });

  // Add domain manually
  btnAddDomain.addEventListener("click", () => {
    const val = txtDomain.value.trim().toLowerCase();
    if (val && val.includes(".")) {
      chrome.storage.local.get(["customDomains"], (res) => {
        const list = res.customDomains || [];
        if (!list.includes(val)) {
          list.push(val);
          chrome.storage.local.set({ customDomains: list }, () => {
            renderDomains(list);
            txtDomain.value = "";
          });
        }
      });
    }
  });

  // Quick toggle current active tab domain
  btnQuickToggle.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          const host = url.hostname;
          if (host && host.includes(".")) {
            chrome.storage.local.get(["customDomains"], (res) => {
              let list = res.customDomains || [];
              if (list.includes(host)) {
                list = list.filter(d => d !== host);
              } else {
                list.push(host);
              }
              chrome.storage.local.set({ customDomains: list }, () => {
                renderDomains(list);
              });
            });
          }
        } catch (e) {
          console.error(e);
        }
      }
    });
  });

  // Add redirect pattern
  btnAddRedir.addEventListener("click", () => {
    const fromVal = txtRedirFrom.value.trim();
    const toVal = txtRedirTo.value.trim();
    if (fromVal && toVal) {
      chrome.storage.local.get(["redirects"], (res) => {
        const list = res.redirects || [];
        list.push({ id: Date.now(), from: fromVal, to: toVal });
        chrome.storage.local.set({ redirects: list }, () => {
          renderRedirects(list);
          txtRedirFrom.value = "";
          txtRedirTo.value = "";
        });
      });
    }
  });

  // Helper UI functions
  function updateStatusUI(isEnabled) {
    if (isEnabled) {
      statusVal.textContent = "active";
      statusVal.classList.add("active");
    } else {
      statusVal.textContent = "disabled";
      statusVal.classList.remove("active");
    }
  }

  function updateModeUI(mode) {
    if (mode === "blocklist") {
      btnBlocklist.classList.add("active");
      btnAllowlist.classList.remove("active");
    } else {
      btnAllowlist.classList.add("active");
      btnBlocklist.classList.remove("active");
    }
  }

  function renderDomains(list) {
    const container = document.getElementById("domainsList");
    container.innerHTML = "";
    
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-text">no custom domains</div>';
      return;
    }

    list.forEach((domain) => {
      const item = document.createElement("div");
      item.className = "domain-item";
      item.innerHTML = `
        <span>${domain}</span>
        <button class="remove-domain-btn" data-domain="${domain}">[x]</button>
      `;
      container.appendChild(item);
    });

    // Attach deletion handlers
    container.querySelectorAll(".remove-domain-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const domToRemove = e.target.getAttribute("data-domain");
        chrome.storage.local.get(["customDomains"], (res) => {
          const newList = (res.customDomains || []).filter(d => d !== domToRemove);
          chrome.storage.local.set({ customDomains: newList }, () => {
            renderDomains(newList);
          });
        });
      });
    });
  }

  function renderRedirects(list) {
    const container = document.getElementById("redirectsList");
    container.innerHTML = "";

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-text">no redirects configured</div>';
      return;
    }

    list.forEach((r) => {
      const item = document.createElement("div");
      item.className = "redirect-item";
      item.innerHTML = `
        <span style="color: #ff453a;">from: ${r.from}</span>
        <span style="color: #30d158; margin-top: 2px;">to: ${r.to}</span>
        <button class="remove-redir-btn" data-id="${r.id}">[x]</button>
      `;
      container.appendChild(item);
    });

    // Attach redirect deletion handlers
    container.querySelectorAll(".remove-redir-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idToRemove = parseInt(e.target.getAttribute("data-id"));
        chrome.storage.local.get(["redirects"], (res) => {
          const newList = (res.redirects || []).filter(r => r.id !== idToRemove);
          chrome.storage.local.set({ redirects: newList }, () => {
            renderRedirects(newList);
          });
        });
      });
    });
  }

  // Timer countdown handling
  function startCountdown(endTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      if (remaining === 0) {
        countdownRow.style.display = "none";
        clearInterval(countdownInterval);
        return;
      }
      
      countdownRow.style.display = "flex";
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      countdownVal.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownRow.style.display = "none";
  }
});
