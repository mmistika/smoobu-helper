// ==UserScript==
// @name         Smoobu Helper Script
// @description  Summarizes the number of mensual check-outs per property
// @version      2.0
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
    const langMatch = location.pathname.match(/^\/([a-z]{2})\//);
    const lang = langMatch ? langMatch[1] : 'en';

    const pageURL = `https://login.smoobu.com/${lang}/cockpit/calendar`;

    const buttonGroupXPath = '//*[@id="root"]/div/div[1]/div[2]';
    const filterBtnCaptionXPath = '//*[@id="root"]/div/div[1]/div[2]/button[2]/span[2]';
    const monthSelectXPath = '//*[@id="menu-button-:r0:"]/div/text()';

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

    function getElementByXPath(xpath) {
        return document.evaluate(xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null)
            .singleNodeValue;
    }

    function waitForElement(xpath, callback) {
        const observer = new MutationObserver(() => {
            const element = getElementByXPath(xpath);
            if (element) {
                observer.disconnect();
                callback(element);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function insertButton(targetParent, caption, callback) {
        const button = document.createElement('button');
        button.innerHTML = `<span>${caption}</span>`;

        // Button styles
        const existingButton = targetParent.querySelector('button:last-child');
        button.className = [...existingButton.classList].at(-1);

        // Caption styles
        const existingCaption = existingButton.querySelector('span:nth-child(2)');
        button.querySelector('span').classList = [...existingCaption.classList].at(-1);

        button.addEventListener('click', callback);
        targetParent.appendChild(button);
    }

    function start() {
        waitForElement(filterBtnCaptionXPath, () => {
            const buttonGroup = getElementByXPath(buttonGroupXPath);
            if (!buttonGroup) return;

            insertButton(buttonGroup, 'Count check-outs', () => {
                const message = 'Failed to count or no check-outs!'

                const checkOutCounts = countCheckOuts();
                if (!checkOutCounts) {
                    showResultTable(null, message);
                    return;
                }

                const ordered = Object.keys(checkOutCounts).sort().reduce(
                    (obj, key) => {
                        obj[key] = checkOutCounts[key];
                        return obj;
                    },
                    {}
                );

                if (Object.keys(ordered).length === 0) {
                    showResultTable(null, message);
                    return;
                }

                showResultTable(ordered)
            });
        });
    }

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

    async function fetchProperties(userId) {
        const propertiesUrl = `https://login.smoobu.com/api/v2/users/${userId}/properties?sort=sortingPosition%2Cname`;
        const propertiesData = await fetchJson(propertiesUrl);

        if (!propertiesData || !propertiesData.data) return null;

        return propertiesData.data.reduce((map, prop) => {
            map[prop.id] = prop.attributes?.name;
            return map;
        }, {});
    }

    async function fetchAllBookings(userId, from, to) {
        let allBookings = [];
        let page = 1;
        let totalPages = 1;

        do {
            const bookingsUrl = `https://login.smoobu.com/api/v1/users/${userId}/bookings?page%5Bsize%5D=25&page%5Bnumber%5D=${page}&filter%5Bfrom%5D=${from}&filter%5Bto%5D=${to}`;
            const data = await fetchJson(bookingsUrl);

            if (data && data.data) {
                allBookings = allBookings.concat(data.data);
                totalPages = data.meta?.totalPages || 1;
            } else {
                console.error("No booking data received.");
                return null;
            }

            ++page;
        } while (page <= totalPages);

        return allBookings;
    }

    function getUserId() {
        const sessionData = localStorage.getItem("userpilot:session_id");
        if (!sessionData) {
            console.error('userpilot:session_id not found')
            return null;
        }

        try {
            const parsedData = JSON.parse(sessionData);
            return Object.keys(parsedData)[0];
        } catch (error) {
            return null;
        }
    }

    async function countCheckOuts() {
        const userId = getUserId();
        if (!userId) {
            console.error("Failed to parse user session data");
            return null;
        }

        const properties = await fetchProperties(userId);
        if (!properties || Object.keys(properties).length === 0) {
            console.error("No properties found.");
            return null;
        }

        const { from, to } = getTimePeriod();
        if (!from || !to) {
            console.error('Failed to parse selected time period');
            return null;
        }

        const bookings = await fetchAllBookings(userId, from, to);
        if (!bookings || Object.keys(bookings).length === 0) {
            console.error("No bookings found.");
            return null;
        }

        // Init counters for each property
        const checkOutCounts = {};
        for (const [id, name] of Object.entries(properties)) {
            checkOutCounts[name] = 0;
        }

        // Process bookings
        for (const booking of bookings) {
            const departureDate = booking.attributes?.departureDate;
            const guestName = booking.attributes?.guestName;
            const propertyId = booking.relationships?.property?.data?.id;

            if (departureDate && propertyId && properties[propertyId]) {
                const departure = departureDate.split("T")[0];;

                if (from <= departure && departure <= to && guestName) {
                    ++checkOutCounts[properties[propertyId]];
                }
            } else {
                console.error('Failed to process booking:', booking);
                return null;
            }
        }

        return checkOutCounts;
    }

    function getTimePeriod() {
        const text = getElementByXPath(monthSelectXPath);
        if (!text) return { from: null, to: null };

        const [monthName, yearStr] = text.textContent.trim().split(" ");
        const month = new Date(Date.parse(monthName + " 1")).getMonth() + 1;
        const year = parseInt(yearStr);

        if (isNaN(month) || isNaN(year)) return { from: null, to: null };

        const from = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const to = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

        return { from, to };
    }

    window.addEventListener('load', function () {
        observeUrlChange(start);
        start();
    })

})();