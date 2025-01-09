// ==UserScript==
// @name         Smoobu Helper Script
// @description  Smoobu Helper Script
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://login.smoobu.com/es/cockpit
// @match        https://login.smoobu.com/es/cockpit?dateMulti=*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function observePageChange(callback) {
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                callback();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }

    function waitForElement(selector, callback) {
        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                callback(element);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function injectButton(container, buttonHTML, onClickHandler) {
        const div = document.createElement('div');
        div.innerHTML = buttonHTML;
        const button = div.firstChild;
        button.addEventListener('click', onClickHandler);
        container.appendChild(button);
        container.classList.add('row');
    }

    function handlePage1() {
        waitForElement('#multi-calendar > div > div.card-header > div > div:last-child', (targetContainer) => {
            const buttonHTML = `<div class="text-left text-sm-right pl-1"><button id="dLabel" type="button" data-offset="" aria-expanded="false" class="btn btn-secondary btn btn-small"><span>Open normalized</span></button></div>`;

            injectButton(targetContainer, buttonHTML, () => {
                const selectBox = targetContainer.querySelector('select');
                const selectedOption = selectBox?.querySelector('option[selected]');
                if (selectedOption) {
                    const monthValue = selectedOption.value;
                    window.location.href = `https://login.smoobu.com/es/cockpit?dateMulti=${monthValue}`;
                }
            });
        });
    }

    function handlePage2() {
        waitForElement('#multi-calendar > div > div.card-header > div > div:last-child', (targetContainer) => {
            const buttonHTML = `<div class="text-left text-sm-right pl-1"><button id="dLabel" type="button" data-offset="" aria-expanded="false" class="btn btn-secondary btn btn-small"><span>Count check-outs</span></button></div>`;

            injectButton(targetContainer, buttonHTML, () => {
                const tableRows = document.querySelectorAll('#multipleCalendarTable > tbody > tr');
                const results = {};

                tableRows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 2) return;

                    const apartmentName = cells[0].getAttribute('title');
                    if (!apartmentName) return;

                    let count = 0;
                    let date='';
                    for (let i = 1; i < cells.length; i++) {
                        let cellDate = cells[i].getAttribute('data-date').slice(0, 7);
                        if (date === '') date = cellDate;
                        if (date != cellDate) break;
                        if (cells[i].hasAttribute('data-booking-end')) {
                            const polygon = cells[i].querySelector('svg polygon');
                            if (polygon) {
                                const color = polygon.getAttribute('fill');
                                if (color === '#7C7C7C') continue;
                            }
                            count++;
                        }
                    }
                    results[apartmentName] = count;
                });

                showResultsPopup(results);
            });
        });
    }

    function showResultsPopup(data) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '9999';

        const popup = document.createElement('div');
        popup.style.position = 'fixed';
        popup.style.top = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.backgroundColor = 'white';
        popup.style.padding = '20px';
        popup.style.border = '1px solid black';
        popup.style.zIndex = '10000';
        popup.style.maxHeight = '80%';
        popup.style.overflowY = 'auto';

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.style.marginBottom = '10px';
        closeButton.addEventListener('click', () => {
            popup.remove();
            overlay.remove();
        });

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `<th style="border: 1px solid black; padding: 5px;">Apartment</th><th style="border: 1px solid black; padding: 5px;">Mensual check-outs</th>`;
        table.appendChild(headerRow);

        for (const [apartment, count] of Object.entries(data)) {
            const row = document.createElement('tr');
            row.innerHTML = `<td style="border: 1px solid black; padding: 5px;">${apartment}</td><td style="border: 1px solid black; padding: 5px;">${count}</td>`;
            table.appendChild(row);
        }

        popup.appendChild(closeButton);
        popup.appendChild(table);

        document.body.appendChild(overlay);
        document.body.appendChild(popup);
    }

    function start() {
        const isPage1 = location.href === 'https://login.smoobu.com/es/cockpit';
        const isPage2 = location.href.startsWith('https://login.smoobu.com/es/cockpit?dateMulti=');

        if (isPage1) {
            handlePage1();
        } else if (isPage2) {
            handlePage2();
        }
    }

    window.addEventListener('load', function () {
        observePageChange(start);
        start();
    })

})();
