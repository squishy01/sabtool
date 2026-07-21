// ==UserScript==
// @name         Kings of Chaos - Sab & Time Tracker
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Tracks server time, report ID, sab details, weapon count/type, success, and alerts via persistent toast showing clean target name (no 's) if <10 entries stored.
// @match        https://www.kingsofchaos.com/*
// @match        https://*.kingsofchaos.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    if (!document.body) return;

    /**
     * Cleans trailing possessive 's or ' from target names.
     * @param {string} name
     * @returns {string}
     */
    function cleanTargetName(name) {
        if (!name) return "";
        return name.replace(/'s$/i, '').replace(/'$/, '').trim();
    }

    /**
     * Renders a persistent on-screen toast notification with a manual close button.
     * @param {string} message
     */
    function showToast(message) {
        let container = document.getElementById('koc-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'koc-toast-container';
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                font-family: Arial, sans-serif;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: #222;
            color: #fff;
            border-left: 4px solid #ff9800;
            padding: 12px 18px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 13px;
            min-width: 240px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
        `;

        const textSpan = document.createElement('span');
        textSpan.innerText = message;

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #aaa;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
        `;
        closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
        closeBtn.onmouseout = () => closeBtn.style.color = '#aaa';
        closeBtn.onclick = () => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        };

        toast.appendChild(textSpan);
        toast.appendChild(closeBtn);
        container.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
    }

    /**
     * Checks if current report ID is higher than stored max report ID.
     * Updates storage if higher and returns boolean result.
     * @param {number|string} currentId
     * @returns {boolean} true if higher, false if less than or equal
     */
    function checkAndUpdateReportId(currentId) {
        if (!currentId) return false;

        const currentNum = parseInt(currentId, 10);
        if (isNaN(currentNum)) return false;

        const storedId = GM_getValue("last_report_id", 0);

        if (currentNum > storedId) {
            GM_setValue("last_report_id", currentNum);
            console.log(`%c[Report ID Update] True: ${currentNum} is higher than previous max (${storedId}). Storage updated.`, "color: green; font-weight: bold;");
            return true;
        } else {
            console.log(`[Report ID Update] False: ${currentNum} is less than or equal to stored max (${storedId}).`);
            return false;
        }
    }

    /**
     * Records a new sabotage entry under the target's Stats ID.
     * Prevents duplicate report IDs and keeps only the latest 10 entries.
     * @param {string} targetStatsId
     * @param {string} targetName
     * @param {string} currentTimestamp
     * @param {string} currentReportId
     */
    function recordSabEntry(targetStatsId, targetName, currentTimestamp, currentReportId) {
        if (!targetStatsId || !currentReportId) return;

        const sabHistory = GM_getValue("sab_history_by_stats_id", {});

        if (!sabHistory[targetStatsId]) {
            sabHistory[targetStatsId] = [];
        }

        const exists = sabHistory[targetStatsId].some(entry => entry.reportId === currentReportId);
        if (exists) {
            console.log(`%c[Duplicate Ignored] Report ID ${currentReportId} already exists for Target ID ${targetStatsId}. Skipping.`, "color: orange; font-weight: bold;");
            return;
        }

        const cleanedName = cleanTargetName(targetName) || "Unknown Target";

        const newEntry = {
            timestamp: currentTimestamp,
            reportId: currentReportId,
            targetId: targetStatsId,
            targetName: cleanedName
        };
        sabHistory[targetStatsId].push(newEntry);

        if (sabHistory[targetStatsId].length > 10) {
            sabHistory[targetStatsId] = sabHistory[targetStatsId].slice(-10);
        }

        GM_setValue("sab_history_by_stats_id", sabHistory);

        console.log(`%c[Sab Recorded] Stored entry for Target "${cleanedName}" (ID: ${targetStatsId}) - (${sabHistory[targetStatsId].length}/10 entries):`, "color: cyan; font-weight: bold;", newEntry);
    }

    // 1. Extract Timestamp
    const textContent = document.body.innerText;
    const timeMatch = textContent.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
    const timestamp = timeMatch ? timeMatch[0] : "Timestamp not found";

    // 2. Extract URL Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('report_id');

    // Check if on target stats page directly or extract link from intel report
    const statsLinkOnPage = document.querySelector('a[href*="stats.php?id="]');
    let currentTargetId = urlParams.get('id');
    let rawTargetName = null;

    if (statsLinkOnPage) {
        rawTargetName = statsLinkOnPage.innerText.trim();
        if (!currentTargetId) {
            const href = statsLinkOnPage.getAttribute('href');
            const idMatch = href ? href.match(/[?&]id=(\d+)/) : null;
            currentTargetId = idMatch ? idMatch[1] : null;
        }
    }

    const cleanedTargetName = cleanTargetName(rawTargetName);

    // 3. Check for Sabotage Log Text
    const targetPhrase = "Your Chief of Intelligence dispatches 15 spies to attempt to sabotage";
    const isSab = textContent.includes(targetPhrase);

    let isNewHigherReport = false;
    let weaponCount = null;
    let weaponType = null;
    let isSuccess = false;

    if (isSab) {
        // Match line containing targetPhrase, capture trailing number and item name
        const sabLineRegex = new RegExp(targetPhrase + ".*?(\\d+)\\s+([^\\n\\r.]+)", "i");
        const sabMatch = textContent.match(sabLineRegex);

        if (sabMatch) {
            weaponCount = sabMatch[1];
            weaponType = sabMatch[2].trim();
        }

        // Check for success line
        const lines = textContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const phraseIndex = lines.findIndex(line => line.includes(targetPhrase));

        if (phraseIndex !== -1 && phraseIndex + 1 < lines.length) {
            const nextLine = lines[phraseIndex + 1];
            isSuccess = nextLine.toLowerCase().startsWith("while inside");
        }

        // Check report ID and record entry
        if (reportId) {
            isNewHigherReport = checkAndUpdateReportId(reportId);
            if (isNewHigherReport && currentTargetId) {
                recordSabEntry(currentTargetId, cleanedTargetName, timestamp, reportId);
            }
        }
    }

    // 4. PERSISTENT TOAST CHECK: Alert if stored entries for the target < 10
    if (currentTargetId) {
        const sabHistory = GM_getValue("sab_history_by_stats_id", {});
        const targetEntries = sabHistory[currentTargetId] || [];
        const count = targetEntries.length;

        // Try to get the clean name from active page or stored history
        let displayName = cleanedTargetName;
        if (!displayName && targetEntries.length > 0 && targetEntries[targetEntries.length - 1].targetName) {
            displayName = targetEntries[targetEntries.length - 1].targetName;
        }
        if (!displayName) {
            displayName = `ID: ${currentTargetId}`;
        }

        if (count < 10) {
            showToast(`⚠️ Target "${displayName}" has ${count} / 10 recorded sab entries.`);
        }
    }

    // 5. Consolidated single console log block
    console.group("=== Kings of Chaos Page Info ===");
    console.log("Timestamp:", timestamp);
    if (reportId) {
        console.log("Report ID:", reportId);
    }
    if (isSab) {
        console.log("Sab Detected:", true);
        console.log("Is Higher Report ID?:", isNewHigherReport);
        console.log("Target Name (Cleaned):", cleanedTargetName);
        console.log("Target ID:", currentTargetId);
        console.log("Weapon/Tool Count:", weaponCount);
        console.log("Weapon/Tool Type:", weaponType);
        console.log("Success (Starts with 'While inside'):", isSuccess);
    }
    console.groupEnd();
})();
