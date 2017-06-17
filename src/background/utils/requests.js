import { getUniqId, request, i18n } from 'src/common';
import cache from './cache';
import { isUserScript } from './script';

const requests = {};

export function getRequestId() {
  const id = getUniqId();
  requests[id] = {
    id,
    xhr: new XMLHttpRequest(),
  };
  return id;
}

function xhrCallbackWrapper(req) {
  let lastPromise = Promise.resolve();
  const { xhr } = req;
  return evt => {
    const res = {
      id: req.id,
      type: evt.type,
      resType: xhr.responseType,
    };
    const data = {
      finalUrl: xhr.responseURL,
      readyState: xhr.readyState,
      responseHeaders: xhr.getAllResponseHeaders(),
      status: xhr.status,
      statusText: xhr.statusText,
    };
    res.data = data;
    try {
      data.responseText = xhr.responseText;
    } catch (e) {
      // ignore if responseText is unreachable
    }
    if (evt.type === 'loadend') clearRequest(req);
    lastPromise = lastPromise.then(() => new Promise(resolve => {
      if (xhr.response && xhr.responseType === 'blob') {
        const reader = new FileReader();
        reader.onload = () => {
          data.response = reader.result;
          resolve();
        };
        reader.readAsDataURL(xhr.response);
      } else {
        // default `null` for blob and '' for text
        data.response = xhr.response;
        resolve();
      }
    }))
    .then(() => {
      if (req.cb) req.cb(res);
    });
  };
}

export function httpRequest(details, cb) {
  const req = requests[details.id];
  if (!req || req.cb) return;
  req.cb = cb;
  const { xhr } = req;
  try {
    xhr.open(details.method, details.url, true, details.user, details.password);
    xhr.setRequestHeader('VM-Verify', details.id);
    if (details.headers) {
      Object.keys(details.headers).forEach(key => {
        xhr.setRequestHeader(key, details.headers[key]);
      });
    }
    if (details.responseType) xhr.responseType = 'blob';
    if (details.overrideMimeType) xhr.overrideMimeType(details.overrideMimeType);
    const callback = xhrCallbackWrapper(req);
    [
      'abort',
      'error',
      'load',
      'loadend',
      'progress',
      'readystatechange',
      'timeout',
    ]
    .forEach(evt => { xhr[`on${evt}`] = callback; });
    // req.finalUrl = details.url;
    xhr.send(details.data);
  } catch (e) {
    console.warn(e);
  }
}

function clearRequest(req) {
  delete requests[req.id];
}

export function abortRequest(id) {
  const req = requests[id];
  if (req) {
    req.xhr.abort();
    clearRequest(req);
  }
}

// tasks are not necessary now, turned off
// Stop redirects
// browser.webRequest.onHeadersReceived.addListener(details => {
//   const task = tasks[details.requestId];
//   if (task) {
//     delete tasks[details.requestId];
//     if (task === 'Get-Location' && [301, 302, 303].includes(details.statusCode)) {
//       const locationHeader = details.responseHeaders.find(
//         header => header.name.toLowerCase() === 'location');
//       const base64 = locationHeader && locationHeader.value;
//       return {
//         redirectUrl: `data:text/plain;charset=utf-8,${base64 || ''}`,
//       };
//     }
//   }
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// }, ['blocking', 'responseHeaders']);
// browser.webRequest.onCompleted.addListener(details => {
//   delete tasks[details.requestId];
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// });
// browser.webRequest.onErrorOccurred.addListener(details => {
//   delete tasks[details.requestId];
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// });

export function confirmInstall(info) {
  return (info.code
    ? Promise.resolve(info.code)
    : request(info.url).then(({ data }) => {
      if (!isUserScript(data)) return Promise.reject(i18n('msgInvalidScript'));
      return data;
    })
  )
  .then(code => {
    cache.put(info.url, code, 3000);
    const confirmKey = getUniqId();
    cache.put(`confirm-${confirmKey}`, {
      url: info.url,
      from: info.from,
    });
    const optionsURL = browser.runtime.getURL(browser.runtime.getManifest().config);
    browser.tabs.create({ url: `${optionsURL}#confirm?id=${confirmKey}` });
  });
}