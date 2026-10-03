export function buildErrorPage(msg) {
	const m = String(msg || 'Unknown error').replace(/[<>"'&]/g, (c) => '&#x' + c.charCodeAt(0).toString(16).toUpperCase() + ';');
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Error</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0f2f5;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh}.error-box{background:#fff;border-radius:8px;padding:40px 60px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:500px}.error-box h2{color:#e74c3c;margin-bottom:10px;font-size:20px}.error-box p{color:#999;font-size:14px}</style></head><body><div class="error-box"><h2>Error</h2><p>${m}</p></div></body></html>`;
}

export function buildMailboxHTML(email, emailList, r2Domain) {
	const escHtml = (str) => { if (!str) return ''; return str.replace(/[<>"'&]/g, (c) => '&#x' + c.charCodeAt(0).toString(16).toUpperCase() + ';'); };

	const rows = emailList.map((item) => {
		const subject = escHtml(item.subject || '(No subject)');
		const sender = escHtml(item.name || item.sendEmail || 'Unknown');
		const date = item.createTime
			? new Intl.DateTimeFormat('default', {
					year: 'numeric', month: 'numeric', day: 'numeric',
					hour: 'numeric', minute: 'numeric', second: 'numeric',
					hour12: false,
					timeZone: 'Asia/Shanghai'
				}).format(new Date(item.createTime))
			: '';
		const emailContent = item.content || '';
		const textContent = item.text || '';
		let bodyHtml = '';
		if (emailContent) {
			const safeContent = emailContent.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
			bodyHtml = `<iframe srcdoc="${safeContent}" class="email-iframe" sandbox="" style="min-height:300px"></iframe>`;
		} else if (textContent) {
			bodyHtml = `<pre class="email-text">${escHtml(textContent)}</pre>`;
		}
		return `<div class="email-item">
      <div class="email-header" onclick="toggleEmail(this)">
        <span class="email-subject">${subject}</span>
        <span class="email-sender">${sender}</span>
        <span class="email-date">${date}</span>
      </div>
      <div class="email-body">${bodyHtml}</div>
    </div>`;
	}).join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailbox - ${escHtml(email)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f0f2f5; color: #333; padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 20px; color: #1a1a1a; word-break: break-all; }
    .email-item {
      background: #fff; border-radius: 8px; margin-bottom: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden;
    }
    .email-header {
      display: flex; justify-content: space-between; padding: 14px 18px;
      cursor: pointer; gap: 12px; align-items: center;
      transition: background 0.15s;
    }
    .email-header:hover { background: #f7f8fa; }
    .email-subject { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .email-sender { color: #666; font-size: 13px; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
    .email-date { color: #999; font-size: 12px; white-space: nowrap; }
    .email-body { display: none; }
    .email-body.open { display: block; }
    .email-iframe { width: 100%; border: none; }
    .email-text { white-space: pre-wrap; word-break: break-word; padding: 16px; font-size: 14px; line-height: 1.6; }
    .no-emails { text-align: center; color: #999; padding: 60px 20px; background: #fff; border-radius: 8px; font-size: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📬 ${escHtml(email)}</h1>
    ${rows.length ? rows : '<div class="no-emails">No emails yet</div>'}
  </div>
  <script>
    function toggleEmail(header) {
      const body = header.nextElementSibling;
      if (!body) return;
      const isOpen = body.classList.contains("open");
      document.querySelectorAll(".email-body.open").forEach(el => {
        el.classList.remove("open");
      });
      if (!isOpen) {
        body.classList.add("open");
      }
    }
  </script>
</body>
</html>`;
}
