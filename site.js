/* Помощник Навигатора — страница продажи: живые данные из манифеста обновлений.
 *
 * Зачем это: версия, размер, дата и контрольная сумма на странице продажи быстро
 * становятся неправдой — «последняя версия 1.3.1» живёт до первого выпуска. Здесь
 * они берутся из **того же подписанного `latest.json`**, по которому обновляется
 * программа, поэтому страница и программа всегда говорят одно и то же, а правок
 * руками после выпуска не нужно.
 *
 * Подпись проверяется в браузере (WebCrypto, Ed25519), если браузер это умеет:
 * «мы показали цифру» и «эта цифра действительно наша» — разные утверждения, и
 * второе лучше доказать, чем попросить поверить. Если браузер не умеет Ed25519 —
 * так и сказано, без зелёной галочки на слово.
 *
 * Никаких внешних библиотек и CDN: страница должна работать и там, где внешние
 * адреса закрыты.
 */
(function () {
  "use strict";

  const cfg = window.SITE || {};
  const state = document.getElementById("manifest-state");
  const signatureState = document.getElementById("signature-state");

  function setState(text, kind) {
    if (!state) return;
    state.hidden = false;
    state.textContent = text;
    state.className = "state" + (kind ? " " + kind : "");
  }

  /* Размер — как в программе (`make_manifest.human_size`): до 1 КБ целые байты,
   * дальше одна цифра после запятой. */
  function humanSize(bytes) {
    const number = Number(bytes || 0);
    if (!number || number < 0) return "";
    const units = ["Б", "КБ", "МБ", "ГБ"];
    let size = number;
    for (let i = 0; i < units.length; i += 1) {
      if (size < 1024 || i === units.length - 1) {
        return i === 0 ? Math.round(size) + " " + units[i]
                       : size.toFixed(1) + " " + units[i];
      }
      size /= 1024;
    }
    return "";
  }

  function fill(selector, value) {
    document.querySelectorAll(selector).forEach(function (node) {
      if (value) node.textContent = value;
    });
  }

  /* Манифест — JSON, подписанный продавцом. Канонический вид обязан совпадать с
   * `navigator/update.py` (`canonical`): ключи по алфавиту, без пробелов, без
   * экранирования кириллицы. Иначе подпись «не сойдётся» на ровном месте. */
  function canonicalJson(value) {
    if (Array.isArray(value)) {
      return "[" + value.map(canonicalJson).join(",") + "]";
    }
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ":" + canonicalJson(value[key]);
      }).join(",") + "}";
    }
    return JSON.stringify(value);
  }

  function hexBytes(hex) {
    const clean = String(hex || "").trim();
    if (!clean || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
      return null;
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }

  function base64Bytes(text) {
    try {
      const raw = atob(String(text || ""));
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
      return out;
    } catch (e) {
      return null;
    }
  }

  /* Проверка подписи: true — подпись верна, false — неверна,
   * null — браузер этого не умеет (тогда ничего не утверждаем). */
  function verifySignature(manifest) {
    const subtle = window.crypto && window.crypto.subtle;
    const key = hexBytes(cfg.pubkey);
    const signature = base64Bytes(manifest.sig);
    if (!subtle || !key || !signature || !manifest.payload) {
      return Promise.resolve(null);
    }
    const body = new TextEncoder().encode(canonicalJson(manifest.payload));
    return subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"])
      .then(function (imported) {
        return subtle.verify({ name: "Ed25519" }, imported, signature, body);
      })
      .catch(function () { return null; });
  }

  async function readManifest() {
    const urls = cfg.manifestUrls || ["latest.json"];
    for (const url of urls) {
      try {
        const answer = await fetch(url, { cache: "no-store" });
        if (!answer.ok) continue;
        const data = await answer.json();
        if (data && data.payload && data.sig) return data;
      } catch (e) { /* нет сети или адрес недоступен — пробуем следующий */ }
    }
    return null;
  }

  function showBuy() {
    const price = document.getElementById("price");
    const note = document.getElementById("price-note");
    const button = document.getElementById("buy-button");
    const support = document.getElementById("support-link");
    const missing = document.getElementById("buy-missing");
    if (price) price.textContent = cfg.price || "цена — по запросу";
    if (note) note.textContent = cfg.priceNote || "";
    if (button && cfg.buyUrl) {
      button.href = cfg.buyUrl;
      button.textContent = cfg.buyLabel || "Разблокировать все функции программы";
      button.hidden = false;
    } else if (missing) {
      missing.hidden = false;
    }
    if (support && cfg.supportUrl) {
      support.href = cfg.supportUrl;
      support.textContent = cfg.supportLabel || "Связаться с продавцом";
      support.hidden = false;
    }
    if (cfg.videoUrl) {
      const block = document.getElementById("video-block");
      const link = document.getElementById("video-link");
      const videoNote = document.getElementById("video-note");
      if (link) link.href = cfg.videoUrl;
      if (videoNote) videoNote.textContent = cfg.videoNote || "";
      if (block) block.hidden = false;
    }
    // Ссылки на скачивание. Три кнопки одного блока: архив (адрес приходит из
    // манифеста), страница со всеми версиями и установщиком, и — только если
    // зеркало когда-нибудь настроят — вторая дорога для сетей без GitHub.
    // Пока `mirrorUrl` пуст, кнопка зеркала в разметке скрыта: обещать «скачать
    // без GitHub» там, где зеркала нет, — хуже, чем молчать.
    const releases = document.getElementById("foot-releases");
    if (releases && cfg.releasesUrl) releases.href = cfg.releasesUrl;
    const allFiles = document.getElementById("dl-releases");
    if (allFiles && cfg.releasesUrl) allFiles.href = cfg.releasesUrl;
    const mirror = document.getElementById("dl-mirror");
    if (mirror && cfg.mirrorUrl) {
      mirror.href = cfg.mirrorUrl;
      mirror.hidden = false;
    }
  }

  function showLinks(payload) {
    const url = (payload && (payload.url || (payload.urls || [])[0])) || "";
    const size = humanSize(payload && payload.size);
    const main = document.getElementById("dl-main");
    if (main) {
      main.href = url || (cfg.releasesUrl || "#");
      // Размер прямо в кнопке: человек заранее видит, сколько качать (72 МБ по
      // школьному интернету — это заметное время, и лучше знать об этом заранее).
      main.textContent = url
        ? "скачать архив" + (size ? " (" + size + ")" : "")
        : "страница загрузки";
    }
    const techMain = document.getElementById("tech-main");
    if (techMain) {
      techMain.textContent = url || "адрес указан в манифесте обновлений";
    }
    // Строка «Зеркало» не пустует: пустая клетка читается как «не догрузилось»,
    // а честное «нет» — как ответ на вопрос ИТ-службы.
    const mirror = (payload && (payload.urls || [])[0]) || cfg.mirrorUrl || "";
    const techMirror = document.getElementById("tech-mirror");
    if (techMirror) {
      techMirror.textContent = mirror || "нет — обновления идут только через GitHub";
    }
  }

  async function main() {
    showBuy();
    const manifest = await readManifest();
    if (!manifest) {
      setState("Не удалось прочитать манифест обновлений — похоже, страница " +
               "открыта без доступа к сети. Версия и размер файла есть в разделе " +
               "загрузки; программа всё равно проверит обновления сама.",
               "warn");
      return;
    }
    const payload = manifest.payload;
    const version = payload.latest || "";
    const size = humanSize(payload.size);
    fill("[data-fact=version]", version);
    fill("[data-fact=size]", size);
    fill("[data-fact=updated]", payload.updated || "");
    fill("[data-tech=version]", version);
    fill("[data-tech=updated]", payload.updated || "—");
    fill("[data-tech=size]",
         size + (payload.size ? " (" + payload.size + " байт)" : ""));
    fill("[data-tech=sha256]", payload.sha256 || "—");
    fill("[data-tech=note]", payload.note || "—");
    fill("#foot-version", version || "—");
    showLinks(payload);

    if (signatureState) {
      const verdict = await verifySignature(manifest);
      signatureState.hidden = false;
      if (verdict === true) {
        signatureState.textContent =
          "Подпись манифеста проверена в этом браузере открытым ключом " +
          String(cfg.pubkey || "").slice(0, 16) + " — данные выше подписаны " +
          "продавцом.";
      } else if (verdict === false) {
        signatureState.textContent =
          "ВНИМАНИЕ: подпись манифеста не подошла. Файл по адресам выше лучше " +
          "не скачивать и сказать продавцу — возможно, страницу подменили.";
        signatureState.className = "state warn";
      } else {
        signatureState.textContent =
          "Этот браузер не умеет проверять подпись Ed25519 — подпись проверит " +
          "сама программа при обновлении: манифест без верной подписи она " +
          "отбрасывает целиком.";
      }
    }
    setState("Данные выше — из подписанного манифеста обновлений: " +
             (version || "версия не указана") + ", от " +
             (payload.updated || "дата не указана") + ".", "ok");
  }

  main();

  /* Наружу отдаём три функции — не «для красоты»: их вызывает проверка
   * `tests/v102_site.py` (в Node, где есть тот же WebCrypto), чтобы убедиться,
   * что страница считает канонический вид манифеста и проверяет подпись **так
   * же**, как программа. Иначе обещание «подпись проверена в браузере» было бы
   * словами. Заодно это удобно в консоли браузера при разборе. */
  window.NAV_SITE = {
    canonicalJson: canonicalJson,
    humanSize: humanSize,
    verifySignature: verifySignature,
    hexBytes: hexBytes,
    base64Bytes: base64Bytes,
    readManifest: readManifest
  };
})();

