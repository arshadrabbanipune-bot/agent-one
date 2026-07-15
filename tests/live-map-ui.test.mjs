import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../app.js', import.meta.url), 'utf8');

assert.match(html, /<script src="\/app\.js" defer><\/script>/, 'the production page must load the one clean client script');
assert.doesNotThrow(() => new Function(client), 'the browser client must parse before deployment');
assert.match(client, /function databaseTable\(node,className='node-table'\)/, 'database tables must render live Notion rows');
assert.match(client, /link\.href=row\.url/, 'database rows must keep their real Notion destination');
assert.match(html, /class="map-stage"|\.map-stage/, 'the map must retain its spatial canvas');
assert.match(client, /function subtreeHasMatch/, 'search must preserve matching descendants');
assert.match(client, /requestJSON\('\/api\/notion\/map'\)/, 'map data must come only from the live Notion route');
assert.match(client, /openDatabaseTables=new Set\(\)/, 'multiple real database tables may remain open');
assert.match(html, /id="googleButton"/, 'real Supabase Google sign-in must remain');
assert.match(html, /id="notionButton"/, 'real Notion OAuth must remain');
assert.match(html, /id="assistantFab"/, 'the native assistant entry point must exist');
assert.match(html, /id="micButton"/, 'the assistant must include microphone input');
assert.match(html, /id="commandInput"/, 'the assistant must include typed fallback');
assert.match(client, /api\/assistant\?action=transcribe/, 'voice must use the protected transcription endpoint');
assert.match(client, /api\/assistant\?action=realtime/, 'voice must prefer the protected OpenAI WebRTC session endpoint');
assert.match(client, /conversation\.item\.input_audio_transcription\.delta/, 'live transcript deltas must reach the command field');
assert.match(client, /SpeechRecognition\|\|window\.webkitSpeechRecognition/, 'voice must retain a browser fallback when realtime service is temporarily unavailable');
assert.match(client, /api\/assistant\?action=undo/, 'completed writes must expose real undo');
assert.match(client, /confirmation_required/, 'risky edits must render a confirmation flow');
assert.match(client, /text\/event-stream/, 'agent progress must stream to the UI');

console.log('live map and assistant UI contract passed');
