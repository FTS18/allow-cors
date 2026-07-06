// Background Service Worker for Allow CORS

let requestCount = 0;

// Load counter from storage on startup
chrome.storage.local.get(["requestCount"], (result) => {
  requestCount = result.requestCount || 0;
});

// Function to update the extension icon badge
function updateBadge(isEnabled) {
  const text = isEnabled ? "on" : "off";
  const color = isEnabled ? "#30d158" : "#3a3a3c"; // Flat Green vs Flat Gray
  
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Helper to normalize wildcards to base domain string
function extractBaseDomain(str) {
  let clean = str.replace(/^\*+\.?/, "").replace(/^https?:\/\//, "");
  const slashIdx = clean.indexOf("/");
  if (slashIdx !== -1) clean = clean.substring(0, slashIdx);
  const colonIdx = clean.indexOf(":");
  if (colonIdx !== -1) clean = clean.substring(0, colonIdx);
  return clean.trim();
}

// Function to rebuild declarativeNetRequest rules dynamically based on storage settings
function rebuildRules() {
  chrome.storage.local.get(
    ["enabled", "mode", "customDomains", "stripCsp", "stripXFrame", "allowCredentials", "activeTabOrigin", "redirects", "stripSharedArray", "stripRefererOrigin"],
    (res) => {
      const enabled = res.enabled !== false;
      const mode = res.mode || "blocklist";
      const customDomains = res.customDomains || [];
      const stripCsp = res.stripCsp === true;
      const stripXFrame = res.stripXFrame === true;
      const allowCredentials = res.allowCredentials !== false;
      const activeTabOrigin = res.activeTabOrigin || "";
      const redirects = res.redirects || [];
      const stripSharedArray = res.stripSharedArray === true;
      const stripRefererOrigin = res.stripRefererOrigin === true;

      // If disabled, remove all rules
      if (!enabled) {
        chrome.declarativeNetRequest.getDynamicRules((rules) => {
          const ruleIds = rules.map(r => r.id);
          chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ruleIds
          });
        });
        return;
      }

      const defaultExclusions = [
        "firestore.googleapis.com",
        "identitytoolkit.googleapis.com",
        "securetoken.googleapis.com",
        "googleapis.com",
        "localhost",
        "vercel.com"
      ];

      // Normalize all custom domains (e.g. remove leading *.)
      const normalizedDomains = customDomains.map(d => extractBaseDomain(d)).filter(Boolean);

      // Define request/exclusion condition
      const condition = {
        resourceTypes: ["xmlhttprequest", "media"]
      };

      if (mode === "blocklist") {
        condition.excludedRequestDomains = [...defaultExclusions, ...normalizedDomains];
      } else {
        if (normalizedDomains.length > 0) {
          condition.requestDomains = normalizedDomains;
        } else {
          condition.requestDomains = ["invalid-placeholder-domain-non-existent.xyz"];
        }
      }

      // Build Rule 1: CORS bypass
      const corsHeaders = [
        { header: "Access-Control-Allow-Methods", operation: "set", value: "GET, PUT, POST, DELETE, HEAD, OPTIONS, PATCH" },
        { header: "Access-Control-Allow-Headers", operation: "set", value: "*" },
        { header: "Access-Control-Expose-Headers", operation: "set", value: "*" },
        { header: "Cross-Origin-Resource-Policy", operation: "set", value: "cross-origin" },
        { header: "Timing-Allow-Origin", operation: "set", value: "*" }
      ];

      if (allowCredentials && activeTabOrigin && activeTabOrigin.startsWith("http")) {
        corsHeaders.push({ header: "Access-Control-Allow-Origin", operation: "set", value: activeTabOrigin });
        corsHeaders.push({ header: "Access-Control-Allow-Credentials", operation: "set", value: "true" });
      } else {
        corsHeaders.push({ header: "Access-Control-Allow-Origin", operation: "set", value: "*" });
      }

      const rule1 = {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: corsHeaders
        },
        condition: condition
      };

      // Strip referer and origin request headers if enabled
      if (stripRefererOrigin) {
        rule1.action.requestHeaders = [
          { header: "referer", operation: "remove" },
          { header: "origin", operation: "remove" }
        ];
      }

      const rulesToRegister = [rule1];

      // Build Rule 2: Strip Content Security Policy (CSP - including legacy/webkit variants)
      if (stripCsp) {
        const rule2 = {
          id: 2,
          priority: 1,
          action: {
            type: "modifyHeaders",
            responseHeaders: [
              { header: "content-security-policy", operation: "remove" },
              { header: "content-security-policy-report-only", operation: "remove" },
              { header: "x-webkit-csp", operation: "remove" },
              { header: "x-content-security-policy", operation: "remove" }
            ]
          },
          condition: {
            ...condition,
            resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "media"]
          }
        };
        rulesToRegister.push(rule2);
      }

      // Build Rule 3: Strip X-Frame-Options
      if (stripXFrame) {
        const rule3 = {
          id: 3,
          priority: 1,
          action: {
            type: "modifyHeaders",
            responseHeaders: [
              { header: "x-frame-options", operation: "remove" },
              { header: "frame-options", operation: "remove" }
            ]
          },
          condition: {
            ...condition,
            resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
          }
        };
        rulesToRegister.push(rule3);
      }

      // Build Rule 4: SharedArrayBuffer support (COOP / COEP)
      if (stripSharedArray) {
        const rule4 = {
          id: 4,
          priority: 1,
          action: {
            type: "modifyHeaders",
            responseHeaders: [
              { header: "Cross-Origin-Opener-Policy", operation: "set", value: "same-origin" },
              { header: "Cross-Origin-Embedder-Policy", operation: "set", value: "require-corp" }
            ]
          },
          condition: {
            ...condition,
            resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "media"]
          }
        };
        rulesToRegister.push(rule4);
      }

      // Build Redirect Rules (Rule IDs starting from 1000)
      let redirectRuleId = 1000;
      redirects.forEach((r) => {
        if (r.from && r.to) {
          const rule = {
            id: redirectRuleId++,
            priority: 3, // Redirect rules take priority over header modification rules
            action: {
              type: "redirect",
              redirect: { url: r.to }
            },
            condition: {
              urlFilter: r.from,
              resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "media"]
            }
          };
          rulesToRegister.push(rule);
        }
      });

      // Query current rules and update
      chrome.declarativeNetRequest.getDynamicRules((rules) => {
        const ruleIds = rules.map(r => r.id);
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: ruleIds,
          addRules: rulesToRegister
        }).catch(err => console.error("Error setting dynamic rules:", err));
      });
    }
  );
}

// Function to update the current active tab origin in storage
function updateActiveTabOrigin(urlStr) {
  if (!urlStr) return;
  try {
    const url = new URL(urlStr);
    const origin = url.origin;
    if (origin.startsWith("http")) {
      chrome.storage.local.set({ activeTabOrigin: origin }, () => {
        rebuildRules();
      });
    }
  } catch (e) {
    // Ignore invalid formats
  }
}

// Helper to check active tab on demand
function triggerActiveTabUpdate() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      updateActiveTabOrigin(tabs[0].url);
    }
  });
}

// Tab event listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab) {
      updateActiveTabOrigin(tab.url);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    updateActiveTabOrigin(tab.url);
  }
});

// Alarm Listener for Auto-Disable Timer
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autoDisableAlarm") {
    chrome.storage.local.set({
      enabled: false,
      timerMinutes: "never",
      alarmEndTime: 0
    });
  }
});

// React to state updates from storage (sync and rebuild)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.enabled) {
      const isEnabled = changes.enabled.newValue;
      updateBadge(isEnabled);
      
      // If disabled, clear alarm
      if (!isEnabled) {
        chrome.alarms.clear("autoDisableAlarm");
        chrome.storage.local.set({ alarmEndTime: 0 });
      }
    }
    // Rebuild rules for any relevant setting update
    if (
      changes.enabled ||
      changes.mode ||
      changes.customDomains ||
      changes.stripCsp ||
      changes.stripXFrame ||
      changes.allowCredentials ||
      changes.redirects ||
      changes.stripSharedArray ||
      changes.stripRefererOrigin
    ) {
      rebuildRules();
    }
  }
});

// Non-blocking Request Counter
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    chrome.storage.local.get(["enabled", "mode", "customDomains"], (res) => {
      const enabled = res.enabled !== false;
      if (!enabled) return;

      try {
        const url = new URL(details.url);
        const host = url.hostname;
        const mode = res.mode || "blocklist";
        const customDomains = res.customDomains || [];
        const defaultExclusions = [
          "firestore.googleapis.com",
          "identitytoolkit.googleapis.com",
          "securetoken.googleapis.com",
          "googleapis.com",
          "localhost",
          "vercel.com"
        ];

        const normalizedDomains = customDomains.map(d => extractBaseDomain(d)).filter(Boolean);

        let isMatched = false;
        if (mode === "blocklist") {
          const isExcluded = defaultExclusions.some(d => host.endsWith(d)) || normalizedDomains.some(d => host.endsWith(d));
          isMatched = !isExcluded;
        } else {
          isMatched = normalizedDomains.some(d => host.endsWith(d));
        }

        if (isMatched) {
          requestCount++;
          chrome.storage.local.set({ requestCount });
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });
  },
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media"] }
);

// Initialization hooks
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }

  chrome.storage.local.get(
    ["enabled", "mode", "customDomains", "stripCsp", "stripXFrame", "allowCredentials", "requestCount", "redirects", "timerMinutes", "stripSharedArray", "stripRefererOrigin"],
    (result) => {
      const isEnabled = result.enabled !== false;
      chrome.storage.local.set({
        enabled: isEnabled,
        mode: result.mode || "blocklist",
        customDomains: result.customDomains || [],
        stripCsp: result.stripCsp === true,
        stripXFrame: result.stripXFrame === true,
        allowCredentials: result.allowCredentials !== false,
        requestCount: result.requestCount || 0,
        redirects: result.redirects || [],
        timerMinutes: result.timerMinutes || "never",
        stripSharedArray: result.stripSharedArray === true,
        stripRefererOrigin: result.stripRefererOrigin === true,
        alarmEndTime: 0
      }, () => {
        updateBadge(isEnabled);
        triggerActiveTabUpdate();
      });
    }
  );
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(["enabled"], (result) => {
    const isEnabled = result.enabled !== false;
    updateBadge(isEnabled);
    triggerActiveTabUpdate();
  });
});
