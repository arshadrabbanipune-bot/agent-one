import { session, setSession } from '../../_auth.js';
import { disconnectStoredNotion } from '../../_store.js';

export default async function handler(req, res) {
  const current = session(req);

  // Keep the Google session but intentionally remove only the Notion grant.
  // This makes reconnecting a deliberate user action and prevents a stale token
  // from being used by the live map after Disconnect is clicked.
  if (current?.user) {
    await disconnectStoredNotion(req,res).catch(()=>false);
    setSession(res, current.user, null, current.auth);
  }

  res.setHeader('cache-control', 'no-store');
  // This is a fetch-driven action in the app. A JSON response avoids a
  // redirect-to-HTML parsing failure and lets the UI move straight back to
  // the Notion connection screen.
  if (req.method === 'POST') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(303, { Location: '/?notion_disconnected=1' });
  res.end();
}
