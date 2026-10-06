window.addEventListener('DOMContentLoaded', () => {
  const frame = document.getElementById('page-frame');
  const page  = new URLSearchParams(window.location.search).get('page');

  if (!page) {
    frame.srcdoc = `
      <html><body style="font-family:sans-serif;padding:40px;color:#888">
        <h2>No page selected</h2>
        <p>Add <code>?page=filename</code> to the URL (without .html)</p>
      </body></html>`;
    return;
  }

  frame.src = `pages/${page}.html`;
  document.title = page;
});
