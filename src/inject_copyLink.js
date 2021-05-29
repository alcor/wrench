(async () => {
  let title = document.title;
  let url = location.href;
  
  try {
    const text = new Blob([`${title} \n${url}`], {type: 'text/plain'});
    const html = new Blob([`<a href="${url}">${title}</a>`], {type: 'text/html'});
    const item = new ClipboardItem({
      'text/plain': text,
      'text/html': html
    });
    await navigator.clipboard.write([item]);
    console.log('Copied to clipboard', title, url);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
})();
