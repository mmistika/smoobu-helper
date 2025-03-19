// ==UserScript==
// @name         Smoobu Helper Script
// @description  Summarizes the number of monthly check-outs per property
// @version      2.1
// @author       mmistika (https://github.com/mmistika)
// @namespace    https://github.com/mmistika/smoobu-helper/
// @supportURL   https://github.com/mmistika/smoobu-helper/issues
// @match        https://login.smoobu.com/*/cockpit/calendar*
// @license      MIT
// @grant        none
// @run-at       document-end
// @icon         https://cdn.brandfetch.io/idkPuacoqc/w/518/h/518/theme/dark/icon.jpeg?c=1dxbfHSJFAPEGdCLU4o5B
// ==/UserScript==

(function () {
    'use strict';

    // Extract language from URL
    const langMatch = location.pathname.match(/^\/([a-z]{2})\//);
    const lang = langMatch ? langMatch[1] : 'en';

    // XPath selectors
    const buttonGroupXPath = '//*[@id="root"]/div/div[1]/div[2]';
    const filterBtnCaptionXPath = '//*[@id="root"]/div/div[1]/div[2]/button[2]/span[2]';
    const monthSelectXPath = '//*[@id="menu-button-:r0:"]/div/text()';

    // Variables for UI elements
    let overlay = null;
    let popup = null;

    /**
     * Observes URL changes and triggers callback
     */
    function observeUrlChange(callback) {
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                callback();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }

    /**
     * Gets element by XPath
     */
    function getElementByXPath(xpath) {
        try {
            return document.evaluate(xpath,
                                     document,
                                     null,
                                     XPathResult.FIRST_ORDERED_NODE_TYPE,
                                     null)
                .singleNodeValue;
        } catch (error) {
            console.error("XPath error:", error);
            return null;
        }
    }

    /**
     * Waits for element to appear in DOM
     */
    function waitForElement(xpath, callback) {
        // Check if element already exists
        const element = getElementByXPath(xpath);
        if (element) {
            callback(element);
            return;
        }

        const observer = new MutationObserver(() => {
            const element = getElementByXPath(xpath);
            if (element) {
                observer.disconnect();
                callback(element);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Inserts button into UI
     */
    function insertButton(targetParent, caption, callback) {
        // Check if button already exists
        const buttons = targetParent.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent.includes(caption)) {
                return; // Button already exists
            }
        }

        const button = document.createElement('button');
        button.innerHTML = `<span>${caption}</span>`;

        // Copy styles from existing button
        const existingButton = targetParent.querySelector('button:last-child');
        if (existingButton) {
            button.className = [...existingButton.classList].at(-1);

            // Copy caption styles
            const existingCaption = existingButton.querySelector('span:nth-child(2)');
            if (existingCaption) {
                button.querySelector('span').className = [...existingCaption.classList].at(-1);
            }
        }

        button.addEventListener('click', callback);
        targetParent.appendChild(button);
    }

    /**
     * Fetches JSON from URL
     */
    async function fetchJson(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("Error fetching data:", error);
            return null;
        }
    }

    /**
     * Fetches properties for the user
     */
    async function fetchProperties(userId) {
        const propertiesUrl = `https://login.smoobu.com/api/v2/users/${userId}/properties?sort=sortingPosition%2Cname`;
        const propertiesData = await fetchJson(propertiesUrl);

        if (!propertiesData || !propertiesData.data) {
            return null;
        }

        return propertiesData.data.reduce((map, prop) => {
            if (prop.id && prop.attributes?.name) {
                map[prop.id] = prop.attributes.name;
            }
            return map;
        }, {});
    }

    /**
     * Fetches all bookings with pagination
     */
    async function fetchAllBookings(userId, from, to) {
        let allBookings = [];
        let page = 1;
        let totalPages = 1;

        try {
            do {
                const bookingsUrl = `https://login.smoobu.com/api/v1/users/${userId}/bookings?page%5Bsize%5D=25&page%5Bnumber%5D=${page}&filter%5Bfrom%5D=${from}&filter%5Bto%5D=${to}`;
                const data = await fetchJson(bookingsUrl);

                if (data && data.data) {
                    allBookings = allBookings.concat(data.data);
                    totalPages = data.meta?.totalPages || 1;
                } else {
                    throw new Error("No booking data received");
                }

                page++;
            } while (page <= totalPages);

            return allBookings;
        } catch (error) {
            console.error("Error fetching bookings:", error);
            return null;
        }
    }

    /**
     * Gets user ID from localStorage
     */
    function getUserId() {
        try {
            const sessionData = localStorage.getItem("userpilot:session_id");
            if (!sessionData) {
                throw new Error('User session data not found');
            }

            const parsedData = JSON.parse(sessionData);
            const userId = Object.keys(parsedData)[0];

            if (!userId) {
                throw new Error('User ID not found in session data');
            }

            return userId;
        } catch (error) {
            console.error("Error getting user ID:", error);
            return null;
        }
    }

    /**
     * Gets time period (month) from UI
     */
    function getTimePeriod() {
        const text = getElementByXPath(monthSelectXPath);
        if (!text || !text.textContent) {
            return { from: null, to: null };
        }

        const [monthName, yearStr] = text.textContent.trim().split(" ");

        // Parse month name to number
        const monthDate = new Date(Date.parse(monthName + " 1"));
        if (isNaN(monthDate.getTime())) {
            return { from: null, to: null };
        }

        const month = monthDate.getMonth() + 1;
        const year = parseInt(yearStr);

        if (isNaN(month) || isNaN(year)) {
            return { from: null, to: null };
        }

        const from = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const to = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

        return { from, to };
    }

    /**
     * Counts check-outs for properties
     */
    async function countCheckOuts() {
        try {
            const userId = getUserId();
            if (!userId) {
                throw new Error("Could not determine user ID");
            }

            const propertiesPromise = fetchProperties(userId);

            const { from, to } = getTimePeriod();
            if (!from || !to) {
                throw new Error("Could not determine selected time period");
            }

            const bookingsPromise = fetchAllBookings(userId, from, to);

            const properties = await propertiesPromise;
            if (!properties || Object.keys(properties).length === 0) {
                throw new Error("No properties found");
            }

            // Initialize counters
            const checkOutCounts = {};
            for (const [id, name] of Object.entries(properties)) {
                checkOutCounts[name] = 0;
            }

            const bookings = await bookingsPromise;
            if (!bookings) {
                throw new Error("Failed to fetch bookings");
            }

            // Count check-outs
            for (const booking of bookings) {
                const departureDate = booking.attributes?.departureDate;
                const guestName = booking.attributes?.guestName;
                const propertyId = booking.relationships?.property?.data?.id;

                if (departureDate && propertyId && properties[propertyId]) {
                    const departure = departureDate.split("T")[0];

                    if (from <= departure && departure <= to && guestName) {
                        checkOutCounts[properties[propertyId]]++;
                    }
                }
            }

            // Sort alphabetically
            return Object.fromEntries(
                Object.entries(checkOutCounts)
                .sort(([a], [b]) => a.localeCompare(b))
            );
        } catch (error) {
            console.error("Error counting check-outs:", error);
            return null;
        }
    }

    /**
     * Shows result table in popup
     */
    function showResultTable(data, message) {
        // Remove existing popup if any
        if (overlay) overlay.remove();
        if (popup) popup.remove();

        // Create overlay
        overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '9999';

        // Create popup
        popup = document.createElement('div');
        popup.style.position = 'fixed';
        popup.style.top = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.backgroundColor = 'white';
        popup.style.padding = '20px';
        popup.style.border = '1px solid #ccc';
        popup.style.borderRadius = '5px';
        popup.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
        popup.style.zIndex = '10000';
        popup.style.maxHeight = '80%';
        popup.style.overflowY = 'auto';
        popup.style.minWidth = '300px';

        // Add title
        const title = document.createElement('h3');
        title.textContent = 'Monthly Check-outs';
        title.style.marginTop = '0';
        title.style.marginBottom = '15px';
        popup.appendChild(title);

        // Add close button
        const closeButton = document.createElement('button');
        closeButton.textContent = '✕';
        closeButton.style.position = 'absolute';
        closeButton.style.top = '20px';
        closeButton.style.right = '20px';
        closeButton.style.cursor = 'pointer';
        closeButton.addEventListener('click', () => {
            popup.remove();
            overlay.remove();
        });
        popup.appendChild(closeButton);

        // Show data or message
        if (data && Object.keys(data).length > 0) {
            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';

            // Header
            const headerRow = document.createElement('tr');
            headerRow.innerHTML = `
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left; background-color: #f2f2f2;">Apartment</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: center; background-color: #f2f2f2;">Monthly check-outs</th>
            `;
            table.appendChild(headerRow);

            // Data rows
            let i = 0;
            for (const [apartment, count] of Object.entries(data)) {
                const row = document.createElement('tr');
                row.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f9f9f9';

                // Escape HTML in apartment name
                const escapedName = apartment
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

                row.innerHTML = `
                    <td style="border: 1px solid #ddd; padding: 8px;">${escapedName}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${count}</td>
                `;
                table.appendChild(row);
                i++;
            }

            popup.appendChild(table);
        } else {
            const messageElem = document.createElement('p');
            messageElem.textContent = message || 'No check-outs found for this period.';
            messageElem.style.textAlign = 'center';
            popup.appendChild(messageElem);
        }

        // Add to document
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        // Close on ESC key
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                popup.remove();
                overlay.remove();
                document.removeEventListener('keydown', keyHandler);
            }
        };
        document.addEventListener('keydown', keyHandler);

        return closeButton;
    }

    /**
     * Initialize the script
     */
    function start() {
        waitForElement(filterBtnCaptionXPath, () => {
            const buttonGroup = getElementByXPath(buttonGroupXPath);
            if (!buttonGroup) return;

            insertButton(buttonGroup, 'Count check-outs', async () => {
                const loadingMessage = 'Counting check-outs...';
                const failMessage = 'Failed to count check-outs. Please try again.';
                const closeBtn = showResultTable(null, loadingMessage);

                try {
                    const checkOutCounts = await countCheckOuts();
                    closeBtn.click(); // Close loading message

                    if (checkOutCounts && Object.keys(checkOutCounts).length > 0) {
                        showResultTable(checkOutCounts);
                    } else {
                        showResultTable(null, 'No check-outs found for this period.');
                    }
                } catch (error) {
                    closeBtn.click(); // Close loading message
                    showResultTable(null, failMessage);
                }
            });
        });
    }

    // Initialize script
    window.addEventListener('load', function() {
        observeUrlChange(start);
        start();
    });
})();