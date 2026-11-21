(() => {
  if (window.KHStudocuExport) return;

  const SUPPORTED_HOSTS = new Set([
    "www.studocu.com",
    "studocu.vn",
    "www.studeersnel.nl",
    "www.studocu.id",
    "www.studocu.vn",
  ]);

  let activeTask = null;

  function cleanText(str) {
    return String(str || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendProgress(options, payload) {
    const message = {
      tabId: Number(options?.tabId || 0),
      ...payload,
    };
    chrome.runtime.sendMessage({
      type: "KH_STUDOCU_EXPORT_PROGRESS",
      ...message,
    }).catch(() => {});
    chrome.runtime.sendMessage({
      type: "PDF_PAGE_PROGRESS",
      ...message,
    }).catch(() => {});
  }

  async function waitForImages(container) {
    if (!container) return;
    const promises = Array.from(container.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(done, 4000);
            function done() {
              clearTimeout(timer);
              img.removeEventListener("load", done);
              img.removeEventListener("error", done);
              resolve();
            }
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }),
    );
    await Promise.all(promises);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  /**
   * Phát hiện và vô hiệu hóa thuộc tính CSS filter / backdrop-filter chứa blur
   * mà không xóa node trang gốc.
   */
  function disableCssBlurFilters(rootEl, referenceWin = window, styleSnapshots = null) {
    if (!rootEl || typeof rootEl.querySelectorAll !== "function") return 0;
    let unblurredCount = 0;

    const candidates = [rootEl, ...Array.from(rootEl.querySelectorAll("*"))];
    candidates.forEach((el) => {
      if (!el || !el.style) return;

      let hasBlur = false;
      const inlineFilter = `${el.style.filter || ""} ${el.style.backdropFilter || ""} ${el.getAttribute("style") || ""}`;
      if (/blur\s*\(/i.test(inlineFilter)) {
        hasBlur = true;
      } else {
        try {
          const computed = referenceWin.getComputedStyle(el);
          if (
            (computed.filter && computed.filter !== "none" && /blur/i.test(computed.filter)) ||
            (computed.backdropFilter &&
              computed.backdropFilter !== "none" &&
              /blur/i.test(computed.backdropFilter))
          ) {
            hasBlur = true;
          }
        } catch (_) {}
      }

      if (hasBlur || el.classList.contains("oGQxBa_blurredImageWrapper")) {
        if (styleSnapshots && !styleSnapshots.has(el)) {
          styleSnapshots.set(el, el.getAttribute("style"));
        }
        el.style.setProperty("filter", "none", "important");
        el.style.setProperty("-webkit-filter", "none", "important");
        el.style.setProperty("backdrop-filter", "none", "important");
        el.style.setProperty("-webkit-backdrop-filter", "none", "important");
        el.style.setProperty("user-select", "auto", "important");
        el.style.setProperty("opacity", "1", "important");
        unblurredCount += 1;
      }
    });

    return unblurredCount;
  }

  function removeOverlays(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== "function") return;
    [
      '[class*="banner-wrapper"]',
      '[class*="PremiumBanner"]',
      ".vHt8Pq_previewBanner",
      "._5XZx7G_container",
      "#upgrade-overlay",
      "#modal-overlay",
      ".download-button-1",
      ".download-button-2",
      ".github-button",
      ".tooltip-bottom",
    ].forEach((selector) => {
      rootEl.querySelectorAll(selector).forEach((el) => {
        try {
          el?.remove?.();
        } catch (_) {}
      });
    });
  }

  window.KHStudocuExport = Object.freeze({
    run: async function (rawOptions) {
      const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
      const requestedDelay = Number(options.scrollDelayMs);
      const scrollDelayMs =
        Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 250;

      if (activeTask) return { ok: false, reason: "busy" };

      activeTask = (async () => {
        const pageInfo = (() => {
          const url = cleanText(window.location.href);
          let host = "";
          try {
            host = new URL(url).hostname;
          } catch (_) {}
          return {
            url,
            host,
            title: cleanText(document.title || ""),
            isSupported: SUPPORTED_HOSTS.has(host),
          };
        })();

        if (!pageInfo.isSupported) {
          sendProgress(options, { stage: "error", reason: "not_supported" });
          return { ok: false, reason: "not_supported" };
        }

        const pageContainer = document.getElementById("page-container");
        if (!pageContainer) {
          sendProgress(options, { stage: "error", reason: "page_container_missing" });
          return { ok: false, reason: "page_container_missing" };
        }

        const pageNodes = Array.from(pageContainer.querySelectorAll(".pf"));
        if (pageNodes.length === 0) {
          pageNodes.push(
            ...Array.from(pageContainer.children || []).filter(
              (el) => el && el.nodeType === 1,
            ),
          );
        }
        const totalPages = pageNodes.length;
        const initialScrollY = window.scrollY;
        const initialScrollX = window.scrollX;

        const toast = ((total) => {
          const box = document.createElement("div");
          box.style.cssText = `
            position: fixed; top: 18px; right: 18px; z-index: 2147483647;
            min-width: 240px; max-width: 300px; padding: 12px 14px;
            border-radius: 14px; border: 1px solid rgba(59, 130, 246, 0.18);
            background: rgba(15, 23, 42, 0.96); box-shadow: 0 16px 36px rgba(15, 23, 42, 0.24);
            color: #f8fafc; font-family: 'Be Vietnam Pro', 'Segoe UI', sans-serif; pointer-events: none;
          `;
          box.innerHTML = `
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">Smart Study</div>
            <div style="margin-top:4px;font-size:12px;font-weight:700;color:#e2e8f0;">Chuẩn bị bản in PDF</div>
            <div id="khStudocuToastText" style="margin-top:6px;font-size:13px;font-weight:700;line-height:1.45;">Đang xử lý...</div>
          `;
          document.body.appendChild(box);
          const textEl = box.querySelector("#khStudocuToastText");

          return {
            setStage(msg) {
              if (textEl) textEl.textContent = cleanText(msg) || "Đang xử lý...";
            },
            setProgress(idx) {
              const n = Math.max(0, Number(idx || 0));
              if (textEl) {
                textEl.textContent =
                  total > 0 ? `Đang quét ${n}/${total} trang...` : "Đang quét tài liệu...";
              }
            },
            remove() {
              try {
                box.remove();
              } catch (_) {}
            },
          };
        })(totalPages);

        let printRoot = null;
        let printStyle = null;
        let printStarted = false;
        let cleanupTimerId = null;
        let cleanupCompleted = false;
        const unblurredPages = [];
        const cleanupAfterPrint = () => {
          if (cleanupCompleted) return;
          cleanupCompleted = true;
          if (cleanupTimerId) {
            clearTimeout(cleanupTimerId);
            cleanupTimerId = null;
          }
          window.removeEventListener("afterprint", cleanupAfterPrint);
          printRoot?.remove();
          printStyle?.remove();
          try {
            window.scrollTo({
              top: initialScrollY,
              left: initialScrollX,
              behavior: "auto",
            });
          } catch (_) {}
        };

        try {
          document.getElementById("smart-study-print-root")?.remove();
          document.getElementById("smart-study-print-style")?.remove();

          if (!totalPages) {
            sendProgress(options, { stage: "error", reason: "no_pages" });
            return { ok: false, reason: "no_pages" };
          }

          sendProgress(options, { stage: "preparing" });
          toast.setStage("Đang quét và gỡ bỏ hiệu ứng làm mờ CSS...");
          const pageCache = new Map();
          const getPageIndex = (pageEl, fallbackIndex) => {
            const indexEl = pageEl.matches("[data-page-index]")
              ? pageEl
              : pageEl.querySelector("[data-page-index]");
            const rawIndex = indexEl?.getAttribute("data-page-index");
            const pageIndex = rawIndex === null || rawIndex === undefined ? NaN : Number(rawIndex);
            return Number.isInteger(pageIndex) ? pageIndex : fallbackIndex;
          };
          const getPageContent = (pageEl) => {
            const content = pageEl.querySelector(".pc");
            if (!content) return null;
            const hasContent =
              Boolean(content.textContent.trim()) ||
              Boolean(content.querySelector(".bi, img, svg, canvas"));
            return hasContent ? content : null;
          };
          const waitForPageContent = (pageEl, timeoutMs = 3000) => {
            const currentContent = getPageContent(pageEl);
            if (currentContent) return Promise.resolve(currentContent);

            return new Promise((resolve) => {
              const observer = new MutationObserver(() => {
                const content = getPageContent(pageEl);
                if (content) finish(content);
              });
              const timeoutId = setTimeout(
                () => finish(pageEl.querySelector(".pc")),
                timeoutMs,
              );
              function finish(content) {
                observer.disconnect();
                clearTimeout(timeoutId);
                resolve(content);
              }
              observer.observe(pageEl, {
                childList: true,
                characterData: true,
                subtree: true,
              });
              const content = getPageContent(pageEl);
              if (content) finish(content);
            });
          };

          // Quét từng trang, gỡ bỏ filter blur và đợi ảnh load
          for (let idx = 0; idx < pageNodes.length; idx += 1) {
            const pageEl = pageNodes[idx];
            try {
              pageEl.scrollIntoView({ behavior: "auto", block: "start" });
            } catch (_) {}

            toast.setProgress(idx + 1);
            sendProgress(options, { stage: "scanning", done: idx + 1, total: totalPages });

            const pageContent = await waitForPageContent(pageEl);
            if (pageContent) {
              await waitForImages(pageContent);
            }
            await sleep(scrollDelayMs);

            const pageIndex = getPageIndex(pageEl, idx);
            const styleSnapshots = new Map();
            const fixedInPage = disableCssBlurFilters(pageEl, window, styleSnapshots);
            if (fixedInPage > 0) {
              unblurredPages.push(pageIndex + 1);
            }

            let cachedPage;
            try {
              cachedPage = pageEl.cloneNode(true);
              removeOverlays(cachedPage);
            } finally {
              styleSnapshots.forEach((styleText, element) => {
                if (styleText === null) {
                  element.removeAttribute("style");
                } else {
                  element.setAttribute("style", styleText);
                }
              });
            }

            cachedPage.querySelectorAll(".pc").forEach((cachedContent) => {
              cachedContent.style.setProperty("display", "block", "important");
              cachedContent.style.setProperty("visibility", "visible", "important");
              cachedContent.style.setProperty("opacity", "1", "important");
            });
            cachedPage.querySelectorAll(".page-content").forEach((pageContentEl) => {
              pageContentEl.style.setProperty("display", "block", "important");
              pageContentEl.style.setProperty("visibility", "visible", "important");
              pageContentEl.style.setProperty("opacity", "1", "important");
            });

            const cachedContent = cachedPage.querySelector(".pc");
            const hasCachedContent = Boolean(
              cachedContent &&
                (cachedContent.textContent.trim() ||
                  cachedContent.querySelector(".bi, img, svg, canvas")),
            );
            if (!pageCache.has(pageIndex) || hasCachedContent) {
              pageCache.set(pageIndex, cachedPage);
            }
          }

          sendProgress(options, { stage: "building" });
          toast.setStage("Đang dựng vùng in trên trang hiện tại...");
          const docTitle = (() => {
            const raw = cleanText(pageInfo.title);
            return raw
              ? cleanText(raw.replace(/\s*[\-|–|—|•|·|:]\s*(studocu|studeersnel).*$/i, "")) || raw
              : "Tài liệu Studocu";
          })();

          if (pageCache.size === 0) {
            sendProgress(options, { stage: "error", reason: "no_pages" });
            return { ok: false, reason: "no_pages" };
          }

          const orderedPageEntries = Array.from(pageCache.entries()).sort(
            ([indexA], [indexB]) => indexA - indexB,
          );
          const orderedPages = orderedPageEntries.map(([, pageEl]) => pageEl);
          const sampleEntry =
            orderedPageEntries.find(([, pageEl]) => {
              const content = pageEl.querySelector(".pc");
              return Boolean(
                content &&
                  (content.textContent.trim() ||
                    content.querySelector(".bi, img, svg, canvas")),
              );
            }) || orderedPageEntries[0];
          const firstPageIndex = sampleEntry[0];
          const samplePage =
            pageNodes.find(
              (pageEl, index) => getPageIndex(pageEl, index) === firstPageIndex,
            ) || sampleEntry[1];
          const sampleRect = samplePage.getBoundingClientRect();
          const sampleStyle = window.getComputedStyle(samplePage);
          const pageWidth = Math.ceil(
            samplePage.offsetWidth ||
              parseFloat(sampleStyle.width) ||
              sampleRect.width ||
              892,
          );
          const pageHeight = Math.ceil(
            samplePage.offsetHeight ||
              parseFloat(sampleStyle.height) ||
              sampleRect.height ||
              1262,
          );

          printRoot = document.createElement("div");
          printRoot.id = "smart-study-print-root";
          const cloneWrapper = (id, original) => {
            const source = original || document.getElementById(id);
            const clone = source
              ? source.cloneNode(false)
              : document.createElement("div");
            clone.id = id;
            return clone;
          };
          const printPageContainerWrapper = cloneWrapper(
            "page-container-wrapper",
          );
          const printDocumentWrapper = cloneWrapper("document-wrapper");
          const printViewerWrapper = cloneWrapper("viewer-wrapper");
          const printPageContainer = cloneWrapper("page-container", pageContainer);
          [
            printPageContainerWrapper,
            printDocumentWrapper,
            printViewerWrapper,
            printPageContainer,
          ].forEach((wrapper) => {
            wrapper.style.setProperty("display", "block", "important");
            wrapper.style.setProperty("position", "static", "important");
            wrapper.style.setProperty("width", `${pageWidth}px`, "important");
            wrapper.style.setProperty("max-width", "none", "important");
            wrapper.style.setProperty("height", "auto", "important");
            wrapper.style.setProperty("overflow", "visible", "important");
            wrapper.style.setProperty("transform", "none", "important");
            wrapper.style.setProperty("margin", "0 auto", "important");
            wrapper.style.setProperty("padding", "0", "important");
            wrapper.style.setProperty("visibility", "visible", "important");
            wrapper.style.setProperty("opacity", "1", "important");
          });
          printPageContainer.style.setProperty("display", "block", "important");
          orderedPages.forEach((pageEl) => {
            printPageContainer.appendChild(pageEl);
          });
          printViewerWrapper.appendChild(printPageContainer);
          printDocumentWrapper.appendChild(printViewerWrapper);
          printPageContainerWrapper.appendChild(printDocumentWrapper);
          printRoot.appendChild(printPageContainerWrapper);

          printStyle = document.createElement("style");
          printStyle.id = "smart-study-print-style";
          printStyle.textContent = `
            @media screen {
              #smart-study-print-root {
                display: none !important;
              }
            }

            @page {
              size: ${pageWidth}px ${pageHeight}px;
              margin: 0 !important;
            }

            @media print {
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
                height: auto !important;
                overflow: visible !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }

              body > *:not(#smart-study-print-root) {
                display: none !important;
              }

              #smart-study-print-root {
                display: block !important;
                position: static !important;
                width: ${pageWidth}px !important;
                margin: 0 !important;
                padding: 0 !important;
              }

              #smart-study-print-root > #page-container-wrapper,
              #smart-study-print-root #document-wrapper,
              #smart-study-print-root #viewer-wrapper,
              #smart-study-print-root #page-container {
                display: block !important;
                position: static !important;
                width: ${pageWidth}px !important;
                max-width: none !important;
                height: auto !important;
                overflow: visible !important;
                transform: none !important;
                margin: 0 auto !important;
                padding: 0 !important;
              }

              #smart-study-print-root .pf {
                display: block !important;
                position: relative !important;
                width: ${pageWidth}px !important;
                height: ${pageHeight}px !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                margin: 0 auto !important;
                padding: 0 !important;
                transform: none !important;
                box-shadow: none !important;
                border: none !important;
              }

              #smart-study-print-root .pf:not(:last-child) {
                page-break-after: always !important;
                break-after: page !important;
              }

              #smart-study-print-root .pf:last-child {
                page-break-after: auto !important;
                break-after: auto !important;
              }

              #smart-study-print-root .page-content,
              #smart-study-print-root .pc {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                transform: none !important;
                margin: 0 !important;
                padding: 0 !important;
                top: 0 !important;
                left: 0 !important;
              }
            }
          `;
          document.head.appendChild(printStyle);
          document.body.appendChild(printRoot);

          const printPages = Array.from(printRoot.querySelectorAll(".pf"));
          printPages.forEach((page) => {
            page.style.setProperty("display", "block", "important");
            page.style.setProperty("position", "relative", "important");
            page.style.setProperty("width", `${pageWidth}px`, "important");
            page.style.setProperty("height", `${pageHeight}px`, "important");
            page.style.setProperty("box-sizing", "border-box", "important");
            page.style.setProperty("overflow", "hidden", "important");
            page.style.setProperty("margin", "0 auto", "important");
            page.style.setProperty("padding", "0", "important");
            page.style.setProperty("transform", "none", "important");
            page.style.setProperty("box-shadow", "none", "important");
            page.style.setProperty("border", "none", "important");
            page.style.removeProperty("page-break-after");
            page.style.removeProperty("break-after");
            page.style.setProperty("visibility", "visible", "important");
            page.style.setProperty("opacity", "1", "important");
            page.querySelectorAll(".page-content, .pc").forEach((content) => {
              content.style.setProperty("display", "block", "important");
              content.style.setProperty("visibility", "visible", "important");
              content.style.setProperty("opacity", "1", "important");
              content.style.setProperty("transform", "none", "important");
              content.style.setProperty("margin", "0", "important");
              content.style.setProperty("padding", "0", "important");
              content.style.setProperty("top", "0", "important");
              content.style.setProperty("left", "0", "important");
            });
            page.querySelectorAll(".pc").forEach((content) => {
              content.style.setProperty("transform-origin", "0 0", "important");
            });
          });

          sendProgress(options, { stage: "printing" });
          toast.setStage("Đang mở hộp thoại In / Lưu PDF...");

          await waitForImages(printRoot);
          if (document.fonts?.ready) {
            await document.fonts.ready;
          }
          await sleep(300);

          window.addEventListener("afterprint", cleanupAfterPrint, { once: true });
          cleanupTimerId = setTimeout(cleanupAfterPrint, 60000);
          printStarted = true;
          try {
            window.focus();
            window.print();
          } catch (error) {
            printStarted = false;
            cleanupAfterPrint();
            throw error;
          }

          toast.remove();
          sendProgress(options, { stage: "done" });

          return {
            ok: true,
            title: docTitle,
            pageCount: pageCache.size,
            validPageCount: pageCache.size,
            unblurredPagesCount: unblurredPages.length,
            unblurredPages,
          };
        } catch (err) {
          cleanupAfterPrint();
          const errMsg = cleanText(err?.message || err || "print_failed");
          sendProgress(options, { stage: "error", reason: "print_failed", error: errMsg });
          return { ok: false, reason: "print_failed", error: errMsg };
        } finally {
          if (!printStarted) {
            cleanupAfterPrint();
          }
          toast.remove();
        }
      })();

      try {
        return await activeTask;
      } finally {
        activeTask = null;
      }
    },
  });
})();