async function copyLink() {
  var url = new URL(location.href);
  var params = new URLSearchParams(url.search);
  copyRichText(params.get("text"), params.get("html"));
  document.body.innerHTML = params.get("html");
}


async function copyRichText(text, html) {
  try {
    const item = new ClipboardItem({
      'text/plain': new Blob([text], {type: 'text/plain'}),
      'text/html': new Blob([html], {type: 'text/html'})
    });
    await navigator.clipboard.write([item]);
    console.log('Copied to clipboard', text, html);
    document.title = "✔ Copied";
    let tabs = await chrome.tabs.query({highlighted: true, currentWindow: true});
    document.body.classList.add("flash")
    window.addEventListener('blur', () => {
      chrome.windows.remove(tabs[0].windowId);
    });
    
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
}

window.addEventListener('DOMContentLoaded', copyLink);
